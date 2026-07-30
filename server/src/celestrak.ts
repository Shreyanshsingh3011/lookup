import { FIXTURE_TLES, fixtureEnabled } from "./fixtures.js";
import { elementFilePath, epochSpan, readElementFile, type EpochSpan } from "./elements.js";

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

/**
 * Parse Celestrak's `FORMAT=tle` output: repeating triples of a name line and
 * the two element lines.
 *
 * Exported for testing. Celestrak serves CRLF line endings and pads name lines
 * with trailing spaces to 24 columns, so both are normalised here.
 */
export function parseTle(raw: string): TleRecord[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  const records: TleRecord[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
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
 *  - "file"    operator-supplied elements via TLE_FILE; overrides everything
 *  - "cache"   Celestrak unreachable, serving a cache entry past its TTL
 *  - "fixture" Celestrak unreachable and nothing cached; bundled dev-only
 *              elements with a stale epoch. NOT usable for real predictions.
 */
export type TleSource = "live" | "file" | "cache" | "fixture";

export interface TleGroupResult {
  tles: TleRecord[];
  fetchedAt: number;
  source: TleSource;
  /**
   * Age of the elements themselves, which matters independently of provenance:
   * SGP4 accuracy decays over days, so even a successful live fetch is worth
   * flagging if the upstream data turns out to be old.
   */
  epoch: EpochSpan | null;
}

function describe(tles: TleRecord[], fetchedAt: number, source: TleSource): TleGroupResult {
  return { tles, fetchedAt, source, epoch: epochSpan(tles.map((t) => t.line1)) };
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

  // An explicit operator-supplied file wins over the network: whoever set
  // TLE_FILE meant it. The response says so, rather than passing the elements
  // off as a live fetch.
  const overridePath = elementFilePath();
  if (overridePath) {
    const tles = parseTle(readElementFile(overridePath));
    if (tles.length === 0) {
      throw new Error(
        `TLE_FILE at '${overridePath}' contained no parseable elements. ` +
          `Expected Celestrak's format: repeating name / line 1 / line 2 triples.`
      );
    }
    return describe(tles, Date.now(), "file");
  }

  const cached = cache.get(celestrakGroup);
  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (isFresh) {
    return describe(cached.tles, cached.fetchedAt, "live");
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
    return describe(tles, Date.now(), "live");
  } catch (err) {
    // Upstream failed — degrade rather than erroring out, most-accurate first.
    if (cached) {
      return describe(cached.tles, cached.fetchedAt, "cache");
    }
    if (fixtureEnabled()) {
      console.warn(
        `[tle] Celestrak unreachable and no cache for '${groupKey}'; serving bundled dev fixture. ` +
          `Predictions from this data are NOT accurate. Set TLE_FILE to supply real elements offline.`
      );
      return describe(FIXTURE_TLES, 0, "fixture");
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

export interface SingleTleResult {
  tle: TleRecord;
  fetchedAt: number;
  /**
   * Unlike a group fetch, there's no sensible fixture to fall back to for an
   * arbitrary satellite the operator hasn't bundled — so this is either a
   * fresh fetch or a still-held cache entry, never a fixture.
   */
  source: "live" | "cache";
  epoch: EpochSpan | null;
}

const satelliteCache = new Map<string, CacheEntry>();
const satelliteInFlight = new Map<string, Promise<TleRecord[]>>();

async function fetchByCatnr(catnr: string): Promise<TleRecord[]> {
  const url = `${CELESTRAK_BASE}?CATNR=${encodeURIComponent(catnr)}&FORMAT=tle`;
  const res = await fetch(url, { headers: { "User-Agent": "lookup-satellite-tracker/0.1" } });
  if (!res.ok) {
    throw new Error(`Celestrak fetch failed for NORAD ID ${catnr}: ${res.status}`);
  }
  const records = parseTle(await res.text());
  if (records.length === 0) {
    throw new Error(`No satellite found for NORAD ID ${catnr}`);
  }
  return records;
}

/**
 * Look up a single satellite by its NORAD catalog number directly from
 * Celestrak, for tracking a satellite that isn't in any of the bundled
 * groups (e.g. a user's own spacecraft). Cached the same way as a group, but
 * with its own cache keyed by catalog number.
 */
export async function fetchSatelliteByCatnr(catnr: string): Promise<SingleTleResult> {
  const cached = satelliteCache.get(catnr);
  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (isFresh) {
    return { tle: cached.tles[0], fetchedAt: cached.fetchedAt, source: "live", epoch: epochSpan([cached.tles[0].line1]) };
  }

  let pending = satelliteInFlight.get(catnr);
  if (!pending) {
    pending = fetchByCatnr(catnr)
      .then((tles) => {
        satelliteCache.set(catnr, { tles, fetchedAt: Date.now() });
        return tles;
      })
      .finally(() => {
        satelliteInFlight.delete(catnr);
      });
    satelliteInFlight.set(catnr, pending);
  }

  try {
    const tles = await pending;
    return { tle: tles[0], fetchedAt: Date.now(), source: "live", epoch: epochSpan([tles[0].line1]) };
  } catch (err) {
    if (cached) {
      return { tle: cached.tles[0], fetchedAt: cached.fetchedAt, source: "cache", epoch: epochSpan([cached.tles[0].line1]) };
    }
    throw err;
  }
}
