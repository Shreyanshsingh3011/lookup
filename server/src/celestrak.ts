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

export type GroupCategory = "Easy to see" | "Constellations" | "Navigation" | "Earth & science" | "Recent";

export interface CatalogueGroup {
  /** Our route key. Kept stable — it appears in shared permalinks. */
  id: string;
  /** Celestrak's GROUP query parameter. */
  celestrak: string;
  label: string;
  description: string;
  category: GroupCategory;
  /**
   * Rough object count. Not authoritative — Celestrak's groups grow and shrink
   * constantly — but enough to warn someone before they select eight thousand
   * satellites, and to sort the picker so the useful ones come first.
   */
  approximateSize: number;
}

/**
 * The slices of the catalogue this app will fetch.
 *
 * Celestrak publishes about a hundred groups. Most are of no use to someone
 * standing outside looking up — a group of decayed analyst objects tells you
 * nothing — so this is a curated set rather than a mirror, ordered by how
 * likely you are to actually see one of its members.
 *
 * The very large groups are included because people ask for them by name, not
 * because tracking eight thousand Starlinks is sensible; the pass search caps
 * what it will scan and says so.
 */
export const SATELLITE_GROUPS: CatalogueGroup[] = [
  {
    id: "stations",
    celestrak: "stations",
    label: "Space stations",
    description: "ISS, Tiangong and the vehicles visiting them",
    category: "Easy to see",
    approximateSize: 30,
  },
  {
    id: "visual",
    celestrak: "visual",
    label: "Brightest objects",
    description: "Celestrak's brightest ~150, mostly spent rocket bodies",
    category: "Easy to see",
    approximateSize: 160,
  },
  {
    id: "amateur",
    celestrak: "amateur",
    label: "Amateur radio",
    description: "Satellites you can work with a handheld and a bit of patience",
    category: "Easy to see",
    approximateSize: 100,
  },
  {
    id: "starlink",
    celestrak: "starlink",
    label: "Starlink",
    description: "The whole constellation — huge, and mostly too faint once on station",
    category: "Constellations",
    approximateSize: 8000,
  },
  {
    id: "oneweb",
    celestrak: "oneweb",
    label: "OneWeb",
    description: "Higher and dimmer than Starlink, but the trains are still visible",
    category: "Constellations",
    approximateSize: 650,
  },
  {
    id: "iridium-next",
    celestrak: "iridium-NEXT",
    label: "Iridium NEXT",
    description: "Successors to the flare-famous originals — these do not flare",
    category: "Constellations",
    approximateSize: 80,
  },
  {
    id: "planet",
    celestrak: "planet",
    label: "Planet Labs",
    description: "Small Earth-imaging craft in sun-synchronous orbits",
    category: "Constellations",
    approximateSize: 200,
  },
  {
    id: "globalstar",
    celestrak: "globalstar",
    label: "Globalstar",
    description: "Satellite phone and messaging relays",
    category: "Constellations",
    approximateSize: 50,
  },
  {
    id: "gps-ops",
    celestrak: "gps-ops",
    label: "GPS",
    description: "Operational US navigation satellites, 20,000 km up",
    category: "Navigation",
    approximateSize: 32,
  },
  {
    id: "galileo",
    celestrak: "galileo",
    label: "Galileo",
    description: "Europe's navigation constellation",
    category: "Navigation",
    approximateSize: 30,
  },
  {
    id: "glo-ops",
    celestrak: "glo-ops",
    label: "GLONASS",
    description: "Russia's navigation constellation",
    category: "Navigation",
    approximateSize: 25,
  },
  {
    id: "beidou",
    celestrak: "beidou",
    label: "BeiDou",
    description: "China's navigation constellation, part of it geostationary",
    category: "Navigation",
    approximateSize: 60,
  },
  {
    id: "weather",
    celestrak: "weather",
    label: "Weather",
    description: "Polar and geostationary meteorological satellites",
    category: "Earth & science",
    approximateSize: 70,
  },
  {
    id: "noaa",
    celestrak: "noaa",
    label: "NOAA",
    description: "The polar orbiters whose APT signals hobbyists decode",
    category: "Earth & science",
    approximateSize: 20,
  },
  {
    id: "goes",
    celestrak: "goes",
    label: "GOES",
    description: "Geostationary weather satellites — the Earth imagery source",
    category: "Earth & science",
    approximateSize: 30,
  },
  {
    id: "resource",
    celestrak: "resource",
    label: "Earth resources",
    description: "Landsat, Sentinel and other land-observation craft",
    category: "Earth & science",
    approximateSize: 60,
  },
  {
    id: "science",
    celestrak: "science",
    label: "Science",
    description: "Space telescopes and research spacecraft, Hubble among them",
    category: "Earth & science",
    approximateSize: 80,
  },
  {
    id: "geodetic",
    celestrak: "geodetic",
    label: "Geodetic",
    description: "Laser-ranged spheres used to measure the shape of the Earth",
    category: "Earth & science",
    approximateSize: 40,
  },
  {
    id: "cubesat",
    celestrak: "cubesat",
    label: "CubeSats",
    description: "Shoebox-sized craft — numerous, and almost all far too faint",
    category: "Earth & science",
    approximateSize: 1800,
  },
  {
    id: "tle-new",
    celestrak: "last-30-days",
    label: "Launched recently",
    description: "Everything catalogued in the last 30 days, still in early orbits",
    category: "Recent",
    approximateSize: 300,
  },
];

/**
 * Groups exposed to the frontend, as route key to Celestrak group.
 *
 * Derived from the catalogue above so the two cannot drift. The `brightest`
 * alias predates the catalogue and is kept because it may sit in a bookmark.
 */
export const TLE_GROUPS: Record<string, string> = {
  ...Object.fromEntries(SATELLITE_GROUPS.map((g) => [g.id, g.celestrak])),
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

/**
 * Find satellites by name.
 *
 * Delegated to Celestrak's own `NAME=` substring query rather than downloading
 * groups and filtering them here. That matters: the alternative is pulling the
 * whole active catalogue — some eleven thousand objects — on every keystroke to
 * answer a question the upstream can answer directly, and it would still only
 * search the groups this app happens to know about rather than all of them.
 *
 * Results are capped because a query like "starlink" matches thousands, and a
 * search box that returns thousands has not answered anything.
 */
export const SEARCH_RESULT_LIMIT = 50;
export const MIN_SEARCH_LENGTH = 3;

export interface SearchResult {
  tles: TleRecord[];
  /** True when the upstream had more matches than were returned. */
  truncated: boolean;
  source: "live" | "cache" | "file";
  epoch: EpochSpan | null;
}

const searchCache = new Map<string, CacheEntry>();
const searchInFlight = new Map<string, Promise<TleRecord[]>>();

async function fetchByName(query: string): Promise<TleRecord[]> {
  const url = `${CELESTRAK_BASE}?NAME=${encodeURIComponent(query)}&FORMAT=tle`;
  const res = await fetch(url, { headers: { "User-Agent": "lookup-satellite-tracker/0.1" } });
  if (!res.ok) {
    throw new Error(`Celestrak search failed for '${query}': ${res.status}`);
  }
  // A search matching nothing is a legitimate answer, not a failure, so an
  // empty list is returned rather than thrown — unlike a group fetch, where
  // empty means the upstream gave us something unusable.
  return parseTle(await res.text());
}

export async function searchSatellitesByName(rawQuery: string): Promise<SearchResult> {
  const query = rawQuery.trim();
  const key = query.toLowerCase();

  // An operator-supplied element file wins here for the same reason it wins for
  // groups: whoever set TLE_FILE meant it, and an air-gapped deployment where
  // every other feature works offline should not have search be the one thing
  // that always fails.
  const overridePath = elementFilePath();
  if (overridePath) {
    const local = parseTle(readElementFile(overridePath)).filter((t) =>
      t.name.toLowerCase().includes(key)
    );
    return capSearch(local, "file");
  }

  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return capSearch(cached.tles, "live");
  }

  let pending = searchInFlight.get(key);
  if (!pending) {
    pending = fetchByName(query)
      .then((tles) => {
        searchCache.set(key, { tles, fetchedAt: Date.now() });
        return tles;
      })
      .finally(() => {
        searchInFlight.delete(key);
      });
    searchInFlight.set(key, pending);
  }

  try {
    return capSearch(await pending, "live");
  } catch (err) {
    // Serving a stale result beats serving an error: the catalogue barely
    // changes, and the name a satellite had four hours ago is still its name.
    if (cached) return capSearch(cached.tles, "cache");
    throw err;
  }
}

function capSearch(tles: TleRecord[], source: "live" | "cache" | "file"): SearchResult {
  const capped = tles.slice(0, SEARCH_RESULT_LIMIT);
  return {
    tles: capped,
    truncated: tles.length > capped.length,
    source,
    epoch: epochSpan(capped.map((t) => t.line1)),
  };
}
