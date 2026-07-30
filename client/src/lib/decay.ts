import * as satellite from 'satellite.js';
import { parseSatrec } from './sky';
import type { TleRecord } from '../types';

const EARTH_RADIUS_KM = 6371;
/** Earth's standard gravitational parameter, km^3/s^2. */
const MU_EARTH = 398600.4418;

/**
 * Above this perigee altitude, atmospheric drag is negligible on any
 * practically relevant timescale (decades to centuries) — a well-established
 * rule of thumb, not something worth spending a forward propagation on.
 */
const STABLE_PERIGEE_KM = 600;

/** How far ahead to search before giving up and calling it "not soon". */
const MAX_HORIZON_DAYS = 730;
/** Coarse search step; refined to the exact day once a failure is bracketed. */
const COARSE_STEP_DAYS = 7;

export interface OrbitalElements {
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  eccentricity: number;
  meanMotionRevPerDay: number;
}

/**
 * Perigee/apogee altitude from the TLE's own eccentricity and mean-motion
 * fields via Kepler's third law — read directly off the raw text rather than
 * satellite.js's internal SatRec units, which have shifted across major
 * versions (see orbitalPeriodMinutes in groundTrack.ts for the same choice).
 */
export function orbitalElementsFromTle(tle: TleRecord): OrbitalElements {
  const eccentricity = Number(`0.${tle.line2.slice(26, 33).trim()}`);
  const meanMotionRevPerDay = Number(tle.line2.slice(52, 63));

  const n = (meanMotionRevPerDay * 2 * Math.PI) / 86_400; // rad/s
  const semiMajorAxisKm = Math.cbrt(MU_EARTH / (n * n));

  return {
    perigeeAltitudeKm: semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM,
    apogeeAltitudeKm: semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM,
    eccentricity,
    meanMotionRevPerDay,
  };
}

export type DecayStatus = 'stable' | 'monitor' | 'decaying-soon' | 'decayed';

export interface DecayEstimate {
  status: DecayStatus;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  /**
   * Set only for 'decaying-soon' or 'decayed': how many days out SGP4 itself
   * stops returning a valid position for these elements, holding current drag
   * conditions constant. Real atmospheric density varies with solar activity
   * on both an 11-year cycle and day to day, so this is a rough "if nothing
   * changes" estimate, not a forecast — and any deliberate reboost (as the
   * ISS receives periodically) isn't something a TLE snapshot can know about.
   */
  estimatedDaysRemaining: number | null;
}

/**
 * Whether SGP4 can still produce a position for these elements at `date`.
 * satellite.js returns either `false` or `null` (this has varied across
 * versions) rather than throwing once an orbit has decayed past what the
 * model can represent — the same falsy check skySampleAt in sky.ts uses
 * during normal propagation.
 */
function survivesTo(satrec: satellite.SatRec, date: Date): boolean {
  return Boolean(satellite.propagate(satrec, date));
}

/**
 * Estimate whether a satellite's orbit is decaying, and roughly how soon,
 * from its current elements alone. A perigee comfortably above the
 * atmosphere is reported stable outright; anything lower is forward-searched
 * with SGP4 itself for the point where these elements stop being physically
 * representable, which is the model's own signal of reentry.
 */
export function estimateDecay(tle: TleRecord, fromDate: Date): DecayEstimate | null {
  const satrec = parseSatrec(tle);
  if (!satrec) return null;

  const { perigeeAltitudeKm, apogeeAltitudeKm } = orbitalElementsFromTle(tle);

  if (perigeeAltitudeKm > STABLE_PERIGEE_KM) {
    return { status: 'stable', perigeeAltitudeKm, apogeeAltitudeKm, estimatedDaysRemaining: null };
  }

  if (!survivesTo(satrec, fromDate)) {
    return { status: 'decayed', perigeeAltitudeKm, apogeeAltitudeKm, estimatedDaysRemaining: 0 };
  }

  let bracketDay: number | null = null;
  for (let day = COARSE_STEP_DAYS; day <= MAX_HORIZON_DAYS; day += COARSE_STEP_DAYS) {
    if (!survivesTo(satrec, new Date(fromDate.getTime() + day * 86_400_000))) {
      bracketDay = day;
      break;
    }
  }

  if (bracketDay === null) {
    return { status: 'monitor', perigeeAltitudeKm, apogeeAltitudeKm, estimatedDaysRemaining: null };
  }

  let exactDay = bracketDay;
  for (let day = bracketDay - COARSE_STEP_DAYS + 1; day <= bracketDay; day++) {
    if (!survivesTo(satrec, new Date(fromDate.getTime() + day * 86_400_000))) {
      exactDay = day;
      break;
    }
  }

  return {
    status: exactDay <= 30 ? 'decaying-soon' : 'monitor',
    perigeeAltitudeKm,
    apogeeAltitudeKm,
    estimatedDaysRemaining: exactDay,
  };
}

/** Compact, one-line label for a decay estimate, shared by every place that shows one. */
export function decayLabel(estimate: DecayEstimate): string {
  switch (estimate.status) {
    case 'stable':
      return 'stable';
    case 'decayed':
      return 'already reentered per these elements';
    case 'decaying-soon':
      return `~${estimate.estimatedDaysRemaining}d (rough)`;
    case 'monitor':
      return estimate.estimatedDaysRemaining !== null
        ? `~${estimate.estimatedDaysRemaining}d (rough)`
        : 'gradual — worth monitoring';
  }
}
