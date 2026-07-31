/**
 * Near-real-time Earth views from geostationary weather satellites.
 *
 * Two things this is careful about.
 *
 * First, it is imagery, not video. Full-disk scans complete every ten minutes,
 * so the newest frame is typically ten to twenty minutes old. Calling that
 * "live" would be a small lie that makes the feature sound better than it is.
 *
 * Second, the app only ever offers a source it has actually reached. The
 * public image paths for these satellites are not a specification — they are a
 * convention that moves when an operator retires a spacecraft or reorganises a
 * CDN. Rather than shipping a URL and hoping, each candidate is probed and
 * only working ones are returned. A wrong guess in the table below shows up as
 * that satellite being unavailable, never as a broken image.
 */

export interface GeostationarySatellite {
  id: string;
  name: string;
  operator: string;
  /** Sub-satellite longitude, degrees east. */
  longitudeDeg: number;
  /**
   * Candidate image URLs, best first. Several are listed per satellite because
   * the naming differs between NOAA's own spacecraft and the partner imagery
   * it rehosts, and the probe settles which is right.
   */
  candidates: string[];
  /** What the picture actually is, for the caption. */
  product: string;
}

/**
 * A geostationary satellite usefully images roughly this far either side of
 * its sub-satellite longitude. Beyond it the limb is so foreshortened that the
 * observer's own region is a smear at the edge of the disk.
 */
const USEFUL_LONGITUDE_REACH_DEG = 75;

export const GEOSTATIONARY_SATELLITES: GeostationarySatellite[] = [
  {
    id: "goes-east",
    name: "GOES-19 (GOES-East)",
    operator: "NOAA",
    longitudeDeg: -75.2,
    product: "GeoColor — true colour by day, multispectral infrared at night",
    candidates: [
      // Verified reachable from production, serving image/jpeg with a real
      // Last-Modified. GOES16 is the previous East spacecraft and answers with
      // the same frame, so it is kept only as a fallback.
      "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/FD/GEOCOLOR/latest.jpg",
      "https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/GEOCOLOR/latest.jpg",
    ],
  },
  {
    id: "goes-west",
    name: "GOES-18 (GOES-West)",
    operator: "NOAA",
    longitudeDeg: -137.2,
    product: "GeoColor — true colour by day, multispectral infrared at night",
    candidates: [
      "https://cdn.star.nesdis.noaa.gov/GOES18/ABI/FD/GEOCOLOR/latest.jpg",
      "https://cdn.star.nesdis.noaa.gov/GOES17/ABI/FD/GEOCOLOR/latest.jpg",
    ],
  },
  {
    id: "himawari",
    name: "Himawari-9",
    operator: "JMA, rehosted by NOAA",
    longitudeDeg: 140.7,
    product: "GeoColor — true colour by day, multispectral infrared at night",
    candidates: [
      // NICT has published this path for Himawari for many years.
      "https://himawari8.nict.go.jp/img/D531106/thumbnail/550/latest.jpg",
      "https://himawari8-dl.nict.go.jp/himawari8/img/D531106/thumbnail/550/latest.jpg",
      "https://cdn.star.nesdis.noaa.gov/HIMAWARI9/FULL_DISK/GEOCOLOR/latest.jpg",
    ],
  },
  {
    id: "meteosat-0",
    name: "Meteosat (0°)",
    operator: "EUMETSAT, rehosted by NOAA",
    longitudeDeg: 0,
    product: "GeoColor — true colour by day, multispectral infrared at night",
    candidates: [
      "https://eumetview.eumetsat.int/static-images/latestImages/EUMETSAT_MSG_RGBNatColourEnhncd_FullResolution.jpg",
      "https://eumetview.eumetsat.int/static-images/latestImages/EUMETSAT_MSG_RGBNatColour_FullResolution.jpg",
      "https://cdn.star.nesdis.noaa.gov/METEOSAT0DEG/FULL_DISK/GEOCOLOR/latest.jpg",
    ],
  },
  {
    id: "meteosat-iodc",
    name: "Meteosat (Indian Ocean)",
    operator: "EUMETSAT, rehosted by NOAA",
    longitudeDeg: 45.5,
    product: "GeoColor — true colour by day, multispectral infrared at night",
    candidates: [
      "https://eumetview.eumetsat.int/static-images/latestImages/EUMETSAT_MSGIODC_RGBNatColourEnhncd_FullResolution.jpg",
      "https://eumetview.eumetsat.int/static-images/latestImages/EUMETSAT_MSGIODC_RGBNatColour_FullResolution.jpg",
    ],
  },
];

/** Smallest separation between two longitudes, degrees. */
export function longitudeSeparation(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Satellites that can see a given longitude, closest sub-satellite point
 * first. Returning the whole ordered list rather than one choice lets the
 * caller fall through when the best-placed spacecraft's imagery is unreachable.
 */
export function satellitesFor(longitudeDeg: number): GeostationarySatellite[] {
  return GEOSTATIONARY_SATELLITES.map((satellite) => ({
    satellite,
    separation: longitudeSeparation(satellite.longitudeDeg, longitudeDeg),
  }))
    .filter(({ separation }) => separation <= USEFUL_LONGITUDE_REACH_DEG)
    .sort((a, b) => a.separation - b.separation)
    .map(({ satellite }) => satellite);
}

export interface EarthImage {
  satelliteId: string;
  name: string;
  operator: string;
  product: string;
  longitudeDeg: number;
  url: string;
  /** Server time when the URL was last confirmed reachable. */
  checkedAt: string;
  /** Last-Modified from the image host, when it sends one — the frame's real age. */
  frameTime: string | null;
}

export interface EarthImageryResult {
  image: EarthImage | null;
  status: "live" | "cache" | "unavailable";
  error?: string;
  /** Satellites that see this longitude but whose imagery could not be reached. */
  unreachable: string[];
}

/**
 * Per-request budget for probing.
 *
 * Kept well inside the serverless function's own limit. The first version
 * walked the candidates one at a time on an eight-second timeout and blew the
 * limit outright, returning a gateway timeout instead of an answer — so the
 * probes now run together and the whole step is bounded by one timeout rather
 * than by their sum.
 */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Only the two best-placed satellites are probed. Anything further round the
 * belt is looking at the observer's region edge-on anyway, and each extra
 * satellite is more upstream requests on a request the user is waiting for.
 */
const MAX_SATELLITES_PROBED = 2;

/** Frames only change every ten minutes, so re-probing faster is pointless. */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  result: EarthImageryResult;
  at: number;
}

const cache = new Map<string, CacheEntry>();

export interface ProbeOutcome {
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  lastModified: string | null;
  error?: string;
}

async function probe(url: string): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // A one-byte ranged GET rather than HEAD: some image CDNs answer HEAD with
    // 403 or 405 even when the object is perfectly fetchable, which would have
    // this reporting a working feed as unavailable.
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });
    const contentType = res.headers.get("content-type");
    // 206 for an honoured range, 200 when the host ignores it.
    const ok = (res.status === 200 || res.status === 206) && (contentType ?? "").startsWith("image/");
    // Drain so the socket can be reused rather than left hanging.
    await res.arrayBuffer().catch(() => undefined);
    return {
      url,
      ok,
      status: res.status,
      contentType,
      lastModified: res.headers.get("last-modified"),
    };
  } catch (err) {
    return {
      url,
      ok: false,
      status: null,
      contentType: null,
      lastModified: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe every candidate for the best-placed satellites at once.
 *
 * Exported so the endpoint can report the raw outcomes: which of these paths
 * are actually correct is not something that can be verified from a
 * development sandbox with no route to the imagery hosts, so production has to
 * be able to say.
 */
export async function probeCandidates(longitudeDeg: number): Promise<ProbeOutcome[]> {
  const satellites = satellitesFor(longitudeDeg).slice(0, MAX_SATELLITES_PROBED);
  const urls = satellites.flatMap((s) => s.candidates);
  return Promise.all(urls.map(probe));
}

/**
 * The best reachable Earth view for an observer's longitude.
 *
 * Tries the best-placed satellite first and falls through to the next when a
 * candidate URL does not answer, so a retired spacecraft or a moved path
 * degrades to a different view rather than to nothing.
 */
export async function getEarthImagery(longitudeDeg: number): Promise<EarthImageryResult> {
  // One cache slot per 15 degrees: the choice of satellite cannot change
  // faster than that, and it keeps a busy region to a single probe.
  const key = String(Math.round(longitudeDeg / 15));
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...cached.result, status: cached.result.image ? "cache" : cached.result.status };
  }

  const satellites = satellitesFor(longitudeDeg).slice(0, MAX_SATELLITES_PROBED);
  const outcomes = await probeCandidates(longitudeDeg);
  const byUrl = new Map(outcomes.map((o) => [o.url, o]));
  const unreachable: string[] = [];

  // Satellites stay in preference order; within one, the first candidate that
  // answered wins. Probing was concurrent, so this is just picking a winner.
  for (const satellite of satellites) {
    const hit = satellite.candidates.map((url) => byUrl.get(url)).find((o) => o?.ok);
    if (!hit) {
      unreachable.push(satellite.name);
      continue;
    }

    const result: EarthImageryResult = {
      image: {
        satelliteId: satellite.id,
        name: satellite.name,
        operator: satellite.operator,
        product: satellite.product,
        longitudeDeg: satellite.longitudeDeg,
        url: hit.url,
        checkedAt: new Date().toISOString(),
        frameTime: hit.lastModified ? new Date(hit.lastModified).toISOString() : null,
      },
      status: "live",
      unreachable,
    };
    cache.set(key, { result, at: Date.now() });
    return result;
  }

  const result: EarthImageryResult = {
    image: null,
    status: "unavailable",
    error:
      satellites.length === 0
        ? "No geostationary satellite in this catalogue images your longitude."
        : "None of the imagery hosts for your region answered.",
    unreachable,
  };
  cache.set(key, { result, at: Date.now() });
  return result;
}
