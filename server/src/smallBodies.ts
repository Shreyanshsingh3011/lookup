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
/**
 * A last-resort list for when JPL cannot be reached.
 *
 * PERISHABLE. Every field here is stable for decades except `tp`, the time of
 * perihelion passage, which is the one that fixes where the body is *now*.
 * Get it wrong and the shape of the orbit is still right while the object is
 * drawn somewhere else entirely on it.
 *
 * That is not hypothetical. Checked against JPL through production on
 * 2026-08-05, the previous values here were wrong by:
 *
 *   Ceres   475 days out of a 1680-day orbit  -> 102 degrees of mean anomaly
 *   Pallas  497 days out of a 1684-day orbit  -> 106 degrees
 *   Iris    318 days out of a 1346-day orbit  ->  85 degrees
 *   Vesta   130 days out of a 1325-day orbit  ->  35 degrees
 *
 * Every other element matched JPL closely, so the numbers were not invented —
 * they simply aged, silently, because nothing checks them. A wrong tp does not
 * decay gracefully either: it is a fixed offset that stays wrong until someone
 * looks.
 *
 * Values below captured from JPL via production on 2026-08-05. When refreshing
 * them, take the whole record rather than only tp — and update the date in
 * smallBodies.test.ts, which pins these against that capture.
 */
export const BUILTIN_BODIES: SmallBodyRecord[] = [
  {
    id: "1",
    name: "1 Ceres",
    kind: "asteroid",
    e: 0.0797,
    q: 2.545,
    tp: "2027-07-13T08:09:35.999Z",
    i: 10.59,
    node: 80.25,
    peri: 73.29,
    absoluteMagnitude: 3.34,
    slope: 0.12,
  },
  {
    id: "4",
    name: "4 Vesta",
    kind: "asteroid",
    e: 0.0902,
    q: 2.148,
    tp: "2025-08-14T02:09:35.999Z",
    i: 7.14,
    node: 103.7,
    peri: 151.47,
    absoluteMagnitude: 3.25,
    slope: 0.32,
  },
  {
    id: "2",
    name: "2 Pallas",
    kind: "asteroid",
    e: 0.2307,
    q: 2.131,
    tp: "2027-10-16T12:43:11.999Z",
    i: 34.93,
    node: 172.89,
    peri: 310.97,
    absoluteMagnitude: 4.12,
    slope: 0.11,
  },
  {
    id: "7",
    name: "7 Iris",
    kind: "asteroid",
    e: 0.2303,
    q: 1.836,
    tp: "2025-04-03T22:48:00.000Z",
    i: 5.52,
    node: 259.49,
    peri: 145.41,
    absoluteMagnitude: 5.7,
    slope: null,
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
