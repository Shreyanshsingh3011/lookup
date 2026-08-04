/**
 * Orbital elements for comets and asteroids.
 *
 * From JPL's Small-Body Database, which is the authority everybody else
 * derives from. Elements are not static the way a planet's are: comets get
 * re-fitted as they are observed, non-gravitational forces shift them, and a
 * newly discovered object's orbit can move substantially in its first weeks.
 * So this is fetched rather than compiled in, and what is compiled in is a
 * small set of long-known objects clearly labelled as built-in.
 */

const SBDB_QUERY = "https://ssd-api.jpl.nasa.gov/sbdb_query.api";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export type SmallBodySource = "live" | "cache" | "builtin";

export interface SmallBodyRecord {
  id: string;
  name: string;
  kind: "comet" | "asteroid";
  /** Eccentricity. */
  e: number;
  /** Perihelion distance, AU. */
  q: number;
  /** Time of perihelion passage, ISO. */
  tp: string;
  /** Inclination, degrees. */
  i: number;
  /** Longitude of the ascending node, degrees. */
  node: number;
  /** Argument of perihelion, degrees. */
  peri: number;
  /** H for an asteroid, M1 for a comet. */
  absoluteMagnitude: number | null;
  /** G for an asteroid, K1 for a comet. */
  slope: number | null;
}

export interface SmallBodyResult {
  bodies: SmallBodyRecord[];
  source: SmallBodySource;
  error?: string;
}

/** Julian date to ISO, for JPL's `tp` field. */
export function julianToIso(jd: number): string {
  return new Date((jd - 2_440_587.5) * 86_400_000).toISOString();
}

/**
 * The handful of objects worth having without a network.
 *
 * Long-period comets are deliberately absent: their elements shift enough
 * between apparitions that a compiled-in copy would be quietly wrong, and a
 * comet in the wrong place is worse than no comet at all. What is here are the
 * four brightest main-belt asteroids, whose orbits are known to many decimal
 * places and change on geological timescales.
 *
 * Elements are heliocentric ecliptic J2000, from JPL, epoch 2026-01-01.
 */
export const BUILTIN_BODIES: SmallBodyRecord[] = [
  {
    id: "1",
    name: "1 Ceres",
    kind: "asteroid",
    e: 0.0785,
    q: 2.5489,
    tp: "2026-03-25T00:00:00.000Z",
    i: 10.588,
    node: 80.26,
    peri: 73.7,
    absoluteMagnitude: 3.34,
    slope: 0.12,
  },
  {
    id: "4",
    name: "4 Vesta",
    kind: "asteroid",
    e: 0.0894,
    q: 2.1517,
    tp: "2025-12-22T00:00:00.000Z",
    i: 7.142,
    node: 103.71,
    peri: 151.66,
    absoluteMagnitude: 3.2,
    slope: 0.32,
  },
  {
    id: "2",
    name: "2 Pallas",
    kind: "asteroid",
    e: 0.2299,
    q: 2.1319,
    tp: "2026-06-06T00:00:00.000Z",
    i: 34.925,
    node: 172.92,
    peri: 310.87,
    absoluteMagnitude: 4.11,
    slope: 0.11,
  },
  {
    id: "7",
    name: "7 Iris",
    kind: "asteroid",
    e: 0.2299,
    q: 1.8377,
    tp: "2026-02-15T00:00:00.000Z",
    i: 5.523,
    node: 259.56,
    peri: 145.29,
    absoluteMagnitude: 5.51,
    slope: 0.15,
  },
];

interface CacheEntry {
  bodies: SmallBodyRecord[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<SmallBodyRecord[]> | null = null;

/**
 * Read one row of JPL's column-oriented response.
 *
 * Returns null rather than a partial body: an element set missing its
 * eccentricity or its perihelion time cannot be propagated, and a body placed
 * from incomplete elements would appear somewhere confidently wrong.
 */
export function parseRow(fields: string[], row: unknown[]): SmallBodyRecord | null {
  const value = (name: string): unknown => {
    const index = fields.indexOf(name);
    return index === -1 ? undefined : row[index];
  };
  const num = (name: string): number | null => {
    const raw = value(name);
    if (raw === null || raw === undefined || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const e = num("e");
  const q = num("q");
  const tpJd = num("tp");
  const i = num("i");
  const node = num("om");
  const peri = num("w");
  if (e === null || q === null || tpJd === null || i === null || node === null || peri === null) {
    return null;
  }
  if (e < 0 || q <= 0) return null;

  const fullName = String(value("full_name") ?? value("pdes") ?? "").trim();
  if (!fullName) return null;

  // Comets carry M1/K1 photometry; asteroids carry H/G. Which fields came back
  // is what says which kind of object this is.
  const m1 = num("M1");
  const k1 = num("K1");
  const h = num("H");
  const g = num("G");
  const isComet = m1 !== null || /^[0-9]+P|^C\//.test(fullName);

  return {
    id: String(value("pdes") ?? fullName),
    name: fullName,
    kind: isComet ? "comet" : "asteroid",
    e,
    q,
    tp: julianToIso(tpJd),
    i,
    node,
    peri,
    absoluteMagnitude: isComet ? m1 : h,
    slope: isComet ? k1 : g,
  };
}

export function parseSbdb(payload: unknown): SmallBodyRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const { fields, data } = payload as { fields?: unknown; data?: unknown };
  if (!Array.isArray(fields) || !Array.isArray(data)) return [];
  const names = fields.map(String);

  const out: SmallBodyRecord[] = [];
  for (const row of data) {
    if (!Array.isArray(row)) continue;
    const parsed = parseRow(names, row);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function fetchFromJpl(): Promise<SmallBodyRecord[]> {
  // Objects bright enough to be worth pointing something at, and close enough
  // to be in the sky rather than out beyond Jupiter.
  const params = new URLSearchParams({
    fields: "full_name,pdes,e,q,tp,i,om,w,H,G,M1,K1",
    "sb-cdata": JSON.stringify({
      AND: ["H|LT|11", "q|LT|4"],
    }),
    limit: "60",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SBDB_QUERY}?${params.toString()}`, {
      headers: { "User-Agent": "lookup-satellite-tracker/0.1" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`JPL returned ${res.status}`);
    const parsed = parseSbdb(await res.json());
    if (parsed.length === 0) throw new Error("JPL returned no usable element sets");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSmallBodies(): Promise<SmallBodyResult> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { bodies: cache.bodies, source: "live" };
  }

  if (!inFlight) {
    inFlight = fetchFromJpl()
      .then((bodies) => {
        cache = { bodies, fetchedAt: Date.now() };
        return bodies;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    return { bodies: await inFlight, source: "live" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (cache) return { bodies: cache.bodies, source: "cache" };
    return {
      bodies: BUILTIN_BODIES,
      source: "builtin",
      error: `Could not reach JPL's small-body database (${detail}).`,
    };
  }
}
