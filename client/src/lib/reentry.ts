import { estimateDecay, orbitalElementsFromTle, type DecayEstimate } from './decay';
import type { TleRecord } from '../types';

/**
 * Which tracked objects are coming down, soonest first.
 *
 * This is a watchlist assembled from element sets the app already has, not a
 * reentry forecast. estimateDecay forward-searches SGP4 for the point where the
 * current elements stop being physically representable, holding drag constant —
 * and drag is the one thing that does not hold constant. Atmospheric density
 * follows the eleven-year solar cycle and swings day to day with geomagnetic
 * activity, so a real prediction narrows as the object descends and is issued
 * hourly in the final days. Nothing derived from a single TLE can do that.
 *
 * So the ordering is meaningful and the dates are not promises. Anything
 * presenting this has to say so; see the caveat rendered alongside it.
 */

/**
 * Only orbits low enough for drag to matter get the expensive treatment.
 *
 * estimateDecay's forward search costs up to a hundred-odd propagations per
 * object. Across a few thousand fragments that is seconds of main thread, and
 * almost all of it wasted: perigee comes free from the TLE text, and above the
 * threshold decay.ts reports "stable" without propagating anyway. Sorting by
 * perigee first and searching only the lowest handful keeps this affordable
 * while still finding everything that could plausibly be near reentry — an
 * object cannot reenter soon while its perigee is high.
 */
export const SEARCH_LOWEST = 400;

/** Beyond this the estimate is not worth showing as an alert. */
export const WATCH_HORIZON_DAYS = 120;

export interface ReentryCandidate {
  tle: TleRecord;
  estimate: DecayEstimate;
  /** Days out, copied up for sorting and display convenience. */
  daysRemaining: number;
}

export interface ReentryWatch {
  /** Everything considered, before any filtering. */
  scanned: number;
  /** How many were close enough to the atmosphere to be forward-searched. */
  searched: number;
  candidates: ReentryCandidate[];
  /** Element sets that would not parse or propagate at all. */
  unusable: number;
}

export function reentryWatch(
  tles: TleRecord[],
  now: Date,
  opts: { searchLowest?: number; horizonDays?: number } = {}
): ReentryWatch {
  const searchLowest = opts.searchLowest ?? SEARCH_LOWEST;
  const horizonDays = opts.horizonDays ?? WATCH_HORIZON_DAYS;

  // Deduplicate: the same object can arrive from a tracked group and from the
  // debris field, and listing a reentry twice would read as two reentries.
  const seen = new Set<string>();
  const byPerigee: Array<{ tle: TleRecord; perigeeKm: number }> = [];
  let unusable = 0;

  for (const tle of tles) {
    if (seen.has(tle.satnum)) continue;
    seen.add(tle.satnum);
    try {
      const { perigeeAltitudeKm } = orbitalElementsFromTle(tle);
      if (!Number.isFinite(perigeeAltitudeKm)) {
        unusable++;
        continue;
      }
      byPerigee.push({ tle, perigeeKm: perigeeAltitudeKm });
    } catch {
      unusable++;
    }
  }

  byPerigee.sort((a, b) => a.perigeeKm - b.perigeeKm);
  const shortlist = byPerigee.slice(0, searchLowest);

  const candidates: ReentryCandidate[] = [];
  for (const { tle } of shortlist) {
    const estimate = estimateDecay(tle, now);
    if (!estimate) {
      unusable++;
      continue;
    }
    if (estimate.estimatedDaysRemaining === null) continue;
    if (estimate.estimatedDaysRemaining > horizonDays) continue;
    candidates.push({ tle, estimate, daysRemaining: estimate.estimatedDaysRemaining });
  }

  // Soonest first; ties broken by catalogue number so the order is stable
  // between renders rather than depending on input order.
  candidates.sort(
    (a, b) => a.daysRemaining - b.daysRemaining || a.tle.satnum.localeCompare(b.tle.satnum)
  );

  return { scanned: seen.size, searched: shortlist.length, candidates, unusable };
}

/** How to describe a wait, in the same voice the pass table uses. */
export function describeReentry(days: number): string {
  if (days <= 0) return 'already down per these elements';
  if (days === 1) return 'within a day';
  if (days <= 30) return `about ${days} days`;
  const months = Math.round(days / 30);
  return `about ${months} month${months === 1 ? '' : 's'}`;
}
