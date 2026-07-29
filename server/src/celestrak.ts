import { FIXTURE_TLES, fixtureEnabled } from "./fixtures.js";

const CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php";

// How long a cached group is considered fresh before we re-fetch from Celestrak.
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface TleRecord {
  name: string;
  satnum: string;
  line1: string;
  line2: string;
}

interface CacheEntry {
  tles: TleRecord[];
  fetchedAt: number;
}

// Groups exposed to the frontend. Keys are our own route names, values are
// the Celestrak GROUP query param.
export const TLE_GROUPS: Record<string, string> = {
  stations: "stations", // ISS, Tiangong, other crewed stations
  visual: "visual", // ~100 brightest satellites by visual magnitude
  starlink: "starlink",
  brightest: "visual",
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<TleRecord[]>>();

function parseTle(raw: string): TleRecord[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const records: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length + 1 && i < lines.length; i += 3) {
    const name = lines[i]?.trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1 || !line2 || !line1.startsWith("1 ") || !line2.startsWith("2 ")) {
      continue;
    }
    const satnum = line1.slice(2, 7).trim();
    records.push({ name, satnum, line1, line2 });
  }
  return records;
}

async function fetchGroup(celestrakGroup: string): Promise<TleRecord[]> {
  const url = `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(celestrakGroup)}&FORMAT=tle`;
  const res = await fetch(url, { headers: { "User-Agent": "lookup-satellite-tracker/0.1" } });
  if (!res.ok) {
    throw new Error(`Celestrak fetch failed for group ${celestrakGroup}: ${res.status}`);
  }
  const text = await res.text();
  const records = parseTle(text);
  if (records.length === 0) {
    throw new Error(`Celestrak returned no parseable TLEs for group ${celestrakGroup}`);
  }
  return records;
}

/**
 * Where a TLE response came from:
 *  - "live"    fresh from Celestrak (or served from a still-fresh cache)
 *  - "cache"   Celestrak unreachable, serving a cache entry past its TTL
 *  - "fixture" Celestrak unreachable and nothing cached; bundled dev-only
 *              elements with a stale epoch. NOT usable for real predictions.
 */
export type TleSource = "live" | "cache" | "fixture";

export interface TleGroupResult {
  tles: TleRecord[];
  fetchedAt: number;
  source: TleSource;
}

/**
 * Get TLEs for a named group, serving from cache when fresh. Concurrent
 * requests for the same stale group are coalesced into a single upstream
 * fetch.
 */
export async function getTleGroup(groupKey: string): Promise<TleGroupResult> {
  const celestrakGroup = TLE_GROUPS[groupKey];
  if (!celestrakGroup) {
    throw new Error(`Unknown TLE group: ${groupKey}`);
  }

  const cached = cache.get(celestrakGroup);
  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (isFresh) {
    return { tles: cached.tles, fetchedAt: cached.fetchedAt, source: "live" };
  }

  let pending = inFlight.get(celestrakGroup);
  if (!pending) {
    pending = fetchGroup(celestrakGroup)
      .then((tles) => {
        cache.set(celestrakGroup, { tles, fetchedAt: Date.now() });
        return tles;
      })
      .finally(() => {
        inFlight.delete(celestrakGroup);
      });
    inFlight.set(celestrakGroup, pending);
  }

  try {
    const tles = await pending;
    return { tles, fetchedAt: Date.now(), source: "live" };
  } catch (err) {
    // Upstream failed — degrade rather than erroring out, most-accurate first.
    if (cached) {
      return { tles: cached.tles, fetchedAt: cached.fetchedAt, source: "cache" };
    }
    if (fixtureEnabled()) {
      console.warn(
        `[tle] Celestrak unreachable and no cache for '${groupKey}'; serving bundled dev fixture. ` +
          `Predictions from this data are NOT accurate.`
      );
      return { tles: FIXTURE_TLES, fetchedAt: 0, source: "fixture" };
    }
    throw err;
  }
}

export async function findSatelliteByNorad(satnum: string): Promise<TleRecord | undefined> {
  for (const groupKey of Object.keys(TLE_GROUPS)) {
    const { tles } = await getTleGroup(groupKey);
    const match = tles.find((t) => t.satnum === satnum);
    if (match) return match;
  }
  return undefined;
}
