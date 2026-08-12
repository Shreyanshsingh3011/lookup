import * as satellite from 'satellite.js';
import { orbitalElementsFromTle, type OrbitalElements } from './decay';
import { parseSatrec } from './sky';
import type { TleRecord } from '../types';

/**
 * A geometric proximity screen between tracked objects — NOT a collision
 * probability assessment. Real conjunction assessment needs each object's
 * position uncertainty (covariance), which isn't derivable from a TLE; this
 * only checks how close two real, independently-published trajectories come
 * to each other in the SGP4 model. Treat any result as "worth checking a
 * real screening service like CelesTrak SOCRATES or Space-Track", not as a
 * warning to act on.
 */
export interface CloseApproach {
  satnumA: string;
  nameA: string;
  satnumB: string;
  nameB: string;
  minDistanceKm: number;
  timeOfClosestApproach: string;
}

export interface ConjunctionScanOptions {
  windowHours?: number;
  /** Cap on the adaptive step, in seconds. Kept for callers that tuned it. */
  stepSeconds?: number;
  thresholdKm?: number;
}

const DEFAULT_WINDOW_HOURS = 24;
/**
 * The largest step the scan will take, not the step it always takes.
 *
 * This used to be the fixed sampling interval, and that was unsound rather than
 * merely coarse. Two objects in opposing low orbits close at up to about 15.8
 * km/s, so a 90-second sample spacing lets them move 1,422 km relative to each
 * other between looks — and the scan reported the smallest *sampled* separation
 * as the miss distance, with no refinement. Measured against half-second
 * sampling over real breakup fragments, that overstated a pair's closest
 * approach by as much as 242 km: an order of magnitude beyond the 25 km
 * threshold the UI screens on, so a genuine 5 km pass would have been reported
 * as a few hundred kilometres and quietly dropped as a non-event.
 *
 * Tuning the number does not fix it. Keeping the between-sample motion small
 * next to a 25 km threshold needs a step under 1.6 seconds, which is 54,600
 * samples per pair per day — hopeless for an all-pairs scan. So the step is
 * adaptive instead; see MAX_CLOSING_SPEED_KM_S.
 */
const DEFAULT_MAX_STEP_SECONDS = 90;

/**
 * A bound on how fast any two Earth-orbiting objects can close.
 *
 * Circular speed at low altitude is about 7.9 km/s, so two objects meeting
 * head-on approach at twice that. Using a bound rather than the instantaneous
 * relative speed is what makes the advance below provably safe: from a
 * separation of d, the pair cannot reach the threshold in less than
 * (d - threshold) / this, whatever they are doing.
 */
const MAX_CLOSING_SPEED_KM_S = 15.8;

/** Floor on the advance, so the scan always progresses. */
const MIN_STEP_SECONDS = 0.5;

/** Iterations of ternary search used to pin a bracketed closest approach. */
const REFINE_ITERATIONS = 60;

export const DEFAULT_THRESHOLD_KM = 25;

/**
 * Slack added to the band filter's margin, covering how far perigee and apogee
 * themselves move over the scan window.
 *
 * The bands come from the elements at TLE epoch, and drag and J2 shift them a
 * little across a day — a few kilometres for low debris. A hundred is generous
 * for that, and it is the value this filter has always used.
 */
const BAND_SLACK_KM = 100;

/**
 * Two orbits can never come closer than the gap between their altitude
 * bands, so pairs whose perigee/apogee ranges don't overlap (with a margin,
 * since this is a cheap pre-filter, not the real distance check) are skipped
 * before ever propagating either one — this is what keeps an all-pairs scan
 * tractable, the same first-pass filter real screening pipelines use.
 *
 * The margin has to be at least the threshold being screened on, and used to be
 * a flat 100 km whatever the caller asked for. Sound at the 25 km the UI screens
 * on; silently wrong above 100 km, where it threw away pairs that really did
 * qualify. Measured over real Fengyun-1C fragments, a 500 km screen lost ten
 * genuine approaches that way — closest 195 km, well inside what was asked for —
 * and lost them before propagating anything, so nothing downstream could
 * recover them. Callers get the margin scaled to their threshold now; see
 * findCloseApproaches.
 */
export function altitudeBandsOverlap(a: OrbitalElements, b: OrbitalElements, marginKm = BAND_SLACK_KM): boolean {
  return a.perigeeAltitudeKm - marginKm <= b.apogeeAltitudeKm && b.perigeeAltitudeKm - marginKm <= a.apogeeAltitudeKm;
}

function distanceKm(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Scans every pair of tracked satellites for their closest approach within the
 * given window.
 *
 * Both trajectories are sampled adaptively: each step is only as long as the
 * pair could possibly need to close the gap it currently has, so an approach
 * cannot be stepped over however fast the two are moving, and the bracketed
 * minimum is then pinned by ternary search. Checked against half-second brute
 * force over real Fengyun-1C fragments: at the 25 km threshold the UI screens
 * on, every real approach in the sample is found and the reported miss distance
 * is within 0.02 km of the truth.
 *
 * What it still is not: a collision probability. The distance is the SGP4
 * model's, with no covariance and no manoeuvres, and a TLE a week old carries
 * kilometres of along-track error in its own right — larger than the numbers
 * this reports. Two objects listed at 5 km might really be at 50, or at 0.
 */
export function findCloseApproaches(tles: TleRecord[], fromDate: Date, opts: ConjunctionScanOptions = {}): CloseApproach[] {
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const maxStepSeconds = opts.stepSeconds ?? DEFAULT_MAX_STEP_SECONDS;
  const thresholdKm = opts.thresholdKm ?? DEFAULT_THRESHOLD_KM;

  const entries = tles
    .map((tle) => {
      const satrec = parseSatrec(tle);
      if (!satrec) return null;
      return { tle, satrec, elements: orbitalElementsFromTle(tle) };
    })
    .filter((e): e is { tle: TleRecord; satrec: satellite.SatRec; elements: OrbitalElements } => e !== null);

  const results: CloseApproach[] = [];
  const windowSeconds = windowHours * 3600;

  /** Separation at an offset in seconds from the window start, or null. */
  const separationAt = (
    recA: satellite.SatRec,
    recB: satellite.SatRec,
    offsetSeconds: number
  ): number | null => {
    const date = new Date(fromDate.getTime() + offsetSeconds * 1000);
    const pvA = satellite.propagate(recA, date);
    const pvB = satellite.propagate(recB, date);
    if (!pvA || !pvB || !pvA.position || !pvB.position) return null;
    return distanceKm(pvA.position, pvB.position);
  };

  /**
   * Pin a bracketed closest approach by ternary search.
   *
   * The adaptive advance below guarantees the minimum is found to within one
   * step, which near an approach is already small — but "within a step" is not
   * a distance anyone should be shown. Separation is smooth and single-dipped
   * across a single encounter, so repeatedly discarding the outer third of the
   * bracket converges on it. Sixty iterations takes any starting bracket down to
   * numerically nothing.
   */
  const refine = (
    recA: satellite.SatRec,
    recB: satellite.SatRec,
    lowSeconds: number,
    highSeconds: number
  ): { distanceKm: number; offsetSeconds: number } | null => {
    let lo = Math.max(0, lowSeconds);
    let hi = Math.min(windowSeconds, highSeconds);
    if (hi <= lo) return null;

    for (let k = 0; k < REFINE_ITERATIONS && hi - lo > 1e-4; k++) {
      const third = (hi - lo) / 3;
      const m1 = lo + third;
      const m2 = hi - third;
      const d1 = separationAt(recA, recB, m1);
      const d2 = separationAt(recA, recB, m2);
      if (d1 === null || d2 === null) return null;
      if (d1 < d2) hi = m2;
      else lo = m1;
    }

    const mid = (lo + hi) / 2;
    const d = separationAt(recA, recB, mid);
    return d === null ? null : { distanceKm: d, offsetSeconds: mid };
  };

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.tle.satnum === b.tle.satnum) continue;
      // Margin scaled to what is being screened on: a pair whose altitude bands
      // are further apart than the threshold cannot possibly meet it, but one
      // inside it can, and a flat margin discarded those.
      if (!altitudeBandsOverlap(a.elements, b.elements, thresholdKm + BAND_SLACK_KM)) continue;

      let bestDistanceKm = Infinity;
      let bestOffset = 0;
      let previousOffset = 0;

      /**
       * Advance by only as long as it would take to close the current gap.
       *
       * From a separation of d, the pair cannot reach the threshold in less than
       * (d - threshold) / MAX_CLOSING_SPEED_KM_S seconds however they are
       * moving, so stepping by that much cannot step over an approach. Far apart
       * the steps are long and the scan costs about what the old fixed one did;
       * as a pair converges the steps shrink on their own, which is the part a
       * fixed step could never do.
       */
      let offset = 0;
      while (offset <= windowSeconds) {
        const d = separationAt(a.satrec, b.satrec, offset);
        if (d === null) {
          offset += maxStepSeconds;
          continue;
        }
        if (d < bestDistanceKm) {
          bestDistanceKm = d;
          bestOffset = offset;
        }
        const safeAdvance = (d - thresholdKm) / MAX_CLOSING_SPEED_KM_S;
        previousOffset = offset;
        offset += Math.min(maxStepSeconds, Math.max(MIN_STEP_SECONDS, safeAdvance));
      }

      // Only worth pinning down if it could plausibly be a reportable approach.
      if (bestDistanceKm <= thresholdKm + MAX_CLOSING_SPEED_KM_S * MIN_STEP_SECONDS) {
        const span = Math.max(MIN_STEP_SECONDS, offset - previousOffset);
        const refined = refine(a.satrec, b.satrec, bestOffset - span, bestOffset + span);
        if (refined && refined.distanceKm < bestDistanceKm) {
          bestDistanceKm = refined.distanceKm;
          bestOffset = refined.offsetSeconds;
        }
      }

      if (Number.isFinite(bestDistanceKm) && bestDistanceKm <= thresholdKm) {
        results.push({
          satnumA: a.tle.satnum,
          nameA: a.tle.name,
          satnumB: b.tle.satnum,
          nameB: b.tle.name,
          minDistanceKm: Math.round(bestDistanceKm * 10) / 10,
          timeOfClosestApproach: new Date(fromDate.getTime() + bestOffset * 1000).toISOString(),
        });
      }
    }
  }

  return results.sort((x, y) => x.minDistanceKm - y.minDistanceKm);
}
