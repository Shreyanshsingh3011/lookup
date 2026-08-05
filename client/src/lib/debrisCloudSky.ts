import { observerToGeodetic, parseSatrec, skySampleAt } from './sky';
import type { Observer, TleRecord } from '../types';

/**
 * Where a breakup cloud actually is, as a density field rather than as points.
 *
 * The four named clouds are around 2,600 catalogued fragments between them,
 * and a ten-centimetre piece of a solar panel is roughly magnitude 12 even
 * directly overhead — a thousand times fainter than the naked eye can reach.
 * Drawing them as points in a view whose whole premise is "this is what is
 * above you right now" would show a sky that does not exist. That is why the
 * dome has never plotted them.
 *
 * But "above you" is true, and the count is real. The way to say both things
 * at once is to stop drawing objects and start drawing a distribution: bin the
 * fragments that are genuinely above the horizon into patches of sky, and
 * shade each patch by how many landed in it.
 *
 * Nothing here is modelled or smoothed. Every fragment is propagated with the
 * same SGP4 the rest of the app uses, and a bin count is a count. The only
 * interpretation is the choice of bin size.
 */

/** Bin size in degrees. Coarse on purpose — see `binsFor`. */
export const AZIMUTH_BIN_DEG = 15;
export const ELEVATION_BIN_DEG = 10;

export interface DensityBin {
  /** Bin centre. */
  azimuthDeg: number;
  elevationDeg: number;
  /** Fragments propagated into this bin. */
  count: number;
  /** count / peak count, so a renderer can shade without knowing the maximum. */
  weight: number;
}

export interface CloudSkyDensity {
  bins: DensityBin[];
  /** Fragments above the horizon at this instant. */
  aboveHorizon: number;
  /** Fragments considered, including those below the horizon. */
  total: number;
  /** Element sets that would not propagate — usually long-decayed objects. */
  unreadable: number;
  /** Highest count in any one bin, for reporting rather than for shading. */
  peakBinCount: number;
}

const EMPTY: CloudSkyDensity = {
  bins: [],
  aboveHorizon: 0,
  total: 0,
  unreadable: 0,
  peakBinCount: 0,
};

/**
 * Bin sizes are deliberately coarse.
 *
 * A fifteen-by-ten degree patch is far larger than any positional uncertainty
 * in these element sets, which matters because fragment TLEs go stale fast:
 * high area-to-mass debris in a decaying orbit can be kilometres off within
 * days. Binning at a resolution the data cannot support would draw structure
 * that is not there — the same false precision as plotting the points, just
 * less obviously wrong.
 */
function binsFor(azimuthDeg: number, elevationDeg: number): { az: number; el: number } {
  return {
    az: Math.floor(azimuthDeg / AZIMUTH_BIN_DEG),
    el: Math.floor(elevationDeg / ELEVATION_BIN_DEG),
  };
}

export function cloudSkyDensity(
  tles: TleRecord[],
  observer: Observer,
  when: Date
): CloudSkyDensity {
  if (tles.length === 0) return EMPTY;

  const observerGd = observerToGeodetic(observer);
  const counts = new Map<string, number>();
  let aboveHorizon = 0;
  let unreadable = 0;

  for (const tle of tles) {
    const rec = parseSatrec(tle);
    if (!rec) {
      unreadable++;
      continue;
    }
    const sample = skySampleAt(rec, observerGd, when);
    if (!sample) {
      unreadable++;
      continue;
    }
    if (sample.elevationDeg < 0) continue;

    aboveHorizon++;
    const { az, el } = binsFor(sample.azimuthDeg, sample.elevationDeg);
    const key = `${az}:${el}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let peakBinCount = 0;
  for (const n of counts.values()) if (n > peakBinCount) peakBinCount = n;

  const bins: DensityBin[] = [];
  for (const [key, count] of counts) {
    const [az, el] = key.split(':').map(Number);
    bins.push({
      azimuthDeg: az * AZIMUTH_BIN_DEG + AZIMUTH_BIN_DEG / 2,
      elevationDeg: el * ELEVATION_BIN_DEG + ELEVATION_BIN_DEG / 2,
      count,
      weight: peakBinCount > 0 ? count / peakBinCount : 0,
    });
  }

  // Densest first, so a renderer that has to cap how much it draws keeps the
  // part that carries the signal.
  bins.sort((a, b) => b.count - a.count);

  return {
    bins,
    aboveHorizon,
    total: tles.length,
    unreadable,
    peakBinCount,
  };
}

/**
 * How faint these things are, said in a way that does not need a footnote.
 *
 * The number matters more than it looks. Someone reading "1,900 fragments
 * overhead" will reasonably assume they could see some of them, and the honest
 * answer is that a telescope would struggle. Naked-eye limit is about
 * magnitude 6 under a dark sky; magnitude 12 is roughly a thousand times
 * fainter, and a ten-centimetre fragment sits around there.
 */
export const FRAGMENT_TYPICAL_MAGNITUDE = 12;
export const NAKED_EYE_LIMIT_MAGNITUDE = 6;

/** How many times fainter than the eye can reach. */
export function timesFainterThanEye(magnitude = FRAGMENT_TYPICAL_MAGNITUDE): number {
  return 10 ** ((magnitude - NAKED_EYE_LIMIT_MAGNITUDE) / 2.5);
}
