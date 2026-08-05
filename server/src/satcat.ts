import { TLE_GROUPS } from "./celestrak.js";

/**
 * Operational status, which element sets do not carry.
 *
 * A TLE says where an object is, never whether anything aboard still works.
 * That gap is why the sky dome classifies objects by name: a name containing
 * "R/B" proves a spent stage, but nothing in "ENVISAT" says the satellite died
 * in 2012. Envisat, ERS-1, Seasat and Hitomi are all derelict and all drew as
 * working spacecraft, and a test pins that limitation deliberately.
 *
 * CelesTrak's SATCAT is the piece that closes it. Unlike the GP element sets it
 * carries OBJECT_TYPE and an operational status code per catalogue number, so
 * a dead payload can be identified as dead rather than assumed alive.
 *
 * Fetched per group rather than as the whole catalogue. The full SATCAT is tens
 * of thousands of rows and several megabytes; the groups this app actually
 * draws are a few hundred, and pulling the rest would be paying for data
 * nothing displays.
 *
 * Degrades the way everything else here does: unreachable SATCAT means
 * name-based classification carries on exactly as before, and the response says
 * so, rather than the app silently losing a distinction it was making.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Status changes rarely; elements do not.

/**
 * Where SATCAT lives, in order of preference.
 *
 * CelesTrak has reorganised these paths more than once, and this sandbox
 * cannot reach celestrak.org to check which is current — the first guess
 * here, /pub/satcat.php, returned 404 from production. Rather than guess
 * again per deploy, the fetcher tries each in turn and reports which one
 * answered, so the live service says what works instead of a comment
 * claiming it.
 *
 * Group-scoped forms come first because they return a few hundred rows
 * instead of tens of thousands. The unscoped full catalogue is last: it is
 * the most likely to exist at a stable path, and is filtered down to the
 * requested group's catalogue numbers after parsing.
 */
interface SatcatEndpoint {
  label: string;
  url: (celestrakGroup: string) => string;
  /** Whether the response covers the whole catalogue and needs narrowing. */
  wholeCatalogue: boolean;
}

export const SATCAT_ENDPOINTS: SatcatEndpoint[] = [
  {
    label: "satcat/records.php?GROUP",
    url: (g) => `https://celestrak.org/satcat/records.php?GROUP=${encodeURIComponent(g)}&FORMAT=csv`,
    wholeCatalogue: false,
  },
  {
    label: "pub/satcat.php?GROUP",
    url: (g) => `https://celestrak.org/pub/satcat.php?GROUP=${encodeURIComponent(g)}&FORMAT=csv`,
    wholeCatalogue: false,
  },
  {
    label: "pub/satcat.csv",
    url: () => "https://celestrak.org/pub/satcat.csv",
    wholeCatalogue: true,
  },
];

export type OpsStatus =
  | "operational"
  | "nonoperational"
  | "partially-operational"
  | "backup"
  | "spare"
  | "extended-mission"
  | "decayed"
  | "unknown";

export interface SatcatEntry {
  satnum: string;
  name: string;
  /** As SATCAT declares it, not inferred from the name. */
  objectType: "PAYLOAD" | "ROCKET BODY" | "DEBRIS" | "UNKNOWN";
  opsStatus: OpsStatus;
  /** Radar cross-section in square metres, where measured. */
  rcsSquareMetres: number | null;
  launchDate: string | null;
  decayDate: string | null;
}

/**
 * SATCAT's single-letter operational status codes.
 *
 * Documented by CelesTrak; mapped here rather than surfaced raw so the client
 * never has to know the encoding. An unrecognised code becomes "unknown"
 * instead of throwing — a new code appearing upstream should cost this app a
 * distinction, not an outage.
 */
function parseOpsStatus(raw: string): OpsStatus {
  switch (raw.trim().toUpperCase()) {
    case "+":
      return "operational";
    case "-":
      return "nonoperational";
    case "P":
      return "partially-operational";
    case "B":
      return "backup";
    case "S":
      return "spare";
    case "X":
      return "extended-mission";
    case "D":
      return "decayed";
    default:
      return "unknown";
  }
}

function parseObjectType(raw: string): SatcatEntry["objectType"] {
  const value = raw.trim().toUpperCase();
  if (value === "PAY" || value === "PAYLOAD") return "PAYLOAD";
  if (value === "R/B" || value === "ROCKET BODY") return "ROCKET BODY";
  if (value === "DEB" || value === "DEBRIS") return "DEBRIS";
  return "UNKNOWN";
}

/**
 * A CSV line splitter that respects quoted fields.
 *
 * Object names contain commas often enough to matter — "COSMOS 2251 DEB" is
 * fine but plenty are of the form "FOO 1, 2 & 3" — and a naive split on comma
 * would shift every subsequent column, silently mislabelling types and
 * statuses rather than failing.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/**
 * Parse SATCAT CSV by column name, never by position.
 *
 * CelesTrak has added columns to this file before. Reading by index would mean
 * a new column silently shifting OBJECT_TYPE into OPS_STATUS_CODE and vice
 * versa — wrong answers rather than an error, which is the worst failure this
 * app can have. Missing an expected column raises instead.
 */
export function parseSatcatCsv(csv: string): SatcatEntry[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) {
      throw new Error(
        `SATCAT is missing the ${name} column. Columns present: ${header.join(", ")}. ` +
          `The format has changed upstream and this parser needs updating.`
      );
    }
    return i;
  };

  const iId = col("NORAD_CAT_ID");
  const iName = col("OBJECT_NAME");
  const iType = col("OBJECT_TYPE");
  const iStatus = col("OPS_STATUS_CODE");
  // Optional: present in current SATCAT but not load-bearing, so absence is
  // tolerated rather than fatal.
  const iRcs = header.indexOf("RCS");
  const iLaunch = header.indexOf("LAUNCH_DATE");
  const iDecay = header.indexOf("DECAY_DATE");

  const entries: SatcatEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.length <= iStatus) continue;

    const rawId = cells[iId]?.trim();
    if (!rawId) continue;

    const rcsRaw = iRcs >= 0 ? Number(cells[iRcs]) : NaN;

    entries.push({
      // Catalogue numbers are compared as strings elsewhere in this app, and
      // SATCAT writes them unpadded while TLEs pad to five. Normalise here so
      // the two can be matched at all.
      satnum: rawId.padStart(5, "0"),
      name: cells[iName]?.trim() ?? "",
      objectType: parseObjectType(cells[iType] ?? ""),
      opsStatus: parseOpsStatus(cells[iStatus] ?? ""),
      rcsSquareMetres: Number.isFinite(rcsRaw) && rcsRaw > 0 ? rcsRaw : null,
      launchDate: iLaunch >= 0 ? cells[iLaunch]?.trim() || null : null,
      decayDate: iDecay >= 0 ? cells[iDecay]?.trim() || null : null,
    });
  }
  return entries;
}

/**
 * Whether an object is derelict according to the catalogue rather than its name.
 *
 * Only "operational", "partially operational", "backup" and "spare" describe
 * something still working; a backup or spare is dormant but alive, and calling
 * it debris would be wrong. "Unknown" is deliberately not treated as derelict —
 * an absent status is an absent answer, and guessing from it would reintroduce
 * exactly the invention this whole layer exists to remove.
 */
export function isDerelictByStatus(entry: SatcatEntry): boolean {
  // Type settles it outright for anything that was never a spacecraft.
  if (entry.objectType === "ROCKET BODY" || entry.objectType === "DEBRIS") return true;

  // For payloads, only an explicit "nonoperational" is a claim the catalogue
  // actually makes. Backup and spare are dormant but alive; extended mission
  // means still working past its original span; unknown means the catalogue
  // does not say, and inferring death from silence is the invention this layer
  // exists to remove.
  return entry.opsStatus === "nonoperational";
}

interface CacheEntry {
  entries: SatcatEntry[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface SatcatResult {
  entries: SatcatEntry[];
  source: "live" | "cache" | "unavailable";
  fetchedAt: number | null;
  /** Which endpoint answered, so the live service reports what actually works. */
  endpoint?: string;
  error?: string;
  /** Every candidate tried and how it failed, when none of them answered. */
  attempts?: Array<{ label: string; error: string }>;
}

/**
 * SATCAT rows for one of the groups this app already draws.
 *
 * Never throws. An unreachable SATCAT returns an empty list with source
 * "unavailable" and the reason, because the caller's correct response is to
 * fall back to name-based classification, not to fail the request.
 */
export async function getSatcatForGroup(groupId: string): Promise<SatcatResult> {
  const celestrakGroup = TLE_GROUPS[groupId];
  if (!celestrakGroup) {
    return {
      entries: [],
      source: "unavailable",
      fetchedAt: null,
      error: `Unknown group '${groupId}'.`,
    };
  }

  const cached = cache.get(celestrakGroup);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { entries: cached.entries, source: "cache", fetchedAt: cached.fetchedAt };
  }

  const attempts: Array<{ label: string; error: string }> = [];

  for (const endpoint of SATCAT_ENDPOINTS) {
    try {
      const res = await fetch(endpoint.url(celestrakGroup), { headers: { accept: "text/csv" } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

      const csv = await res.text();
      let entries = parseSatcatCsv(csv);

      // The unscoped catalogue covers everything, so narrow it to the objects
      // this group actually contains. Doing that needs the group's catalogue
      // numbers, which only the caller's TLE fetch knows — so the narrowing is
      // left to the caller and the full set is cached here. Better to hold
      // more than to refetch tens of thousands of rows per group.
      if (entries.length === 0) throw new Error("no usable rows");

      const fetchedAt = Date.now();
      // Whole-catalogue responses are cached under a shared key, since one
      // fetch serves every group.
      cache.set(endpoint.wholeCatalogue ? "*" : celestrakGroup, { entries, fetchedAt });
      return { entries, source: "live", fetchedAt, endpoint: endpoint.label, attempts };
    } catch (err) {
      attempts.push({ label: endpoint.label, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // A stale cache still beats no answer: status changes on the scale of years,
  // so day-old rows are no less true than fresh ones.
  const fallback = cached ?? cache.get("*");
  if (fallback) {
    return {
      entries: fallback.entries,
      source: "cache",
      fetchedAt: fallback.fetchedAt,
      error: "No SATCAT endpoint answered; serving cached rows.",
      attempts,
    };
  }

  return {
    entries: [],
    source: "unavailable",
    fetchedAt: null,
    error: "No SATCAT endpoint answered.",
    attempts,
  };
}
