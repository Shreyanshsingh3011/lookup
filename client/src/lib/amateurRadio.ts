import * as satellite from 'satellite.js';
import { parseSatrec } from './sky';
import type { Observer, TleRecord } from '../types';

/**
 * Working satellites, rather than watching them.
 *
 * A radio pass is not a visual pass and the app had no notion of one. Visible
 * passes need the observer in darkness and the satellite in sunlight, which
 * between them throw away most of the day; a radio operator cares about none
 * of that, only whether the thing is above the horizon and how far its
 * frequency has been dragged by its own motion. So this computes its own
 * passes rather than filtering the optical ones, which would have hidden
 * almost every workable pass there is.
 *
 * Everything here is derived from the propagated state vector. No signal
 * strength is predicted and no link budget is modelled — those depend on the
 * antenna, the feedline and the operator, none of which this app knows.
 */

/** Speed of light, km/s. */
const C_KM_S = 299_792.458;
/** Earth's rotation rate, rad/s. */
const EARTH_ROTATION_RAD_S = 7.292_115_146_7e-5;

export interface RangeSample {
  /** Distance from observer to satellite, km. */
  rangeKm: number;
  /**
   * Rate of change of that distance, km/s. Negative while approaching, which
   * is when a signal arrives high and drops through its nominal frequency.
   */
  rangeRateKmS: number;
  elevationDeg: number;
  azimuthDeg: number;
}

/**
 * Range and range rate, including the observer's own motion.
 *
 * The ground station is not stationary: Earth's rotation carries it at up to
 * 465 m/s, which at 435 MHz is worth about 675 Hz — small against the
 * satellite's own ten kilohertz, but the same order as the tuning step of the
 * radios people use, so leaving it out would be a visible error rather than a
 * rounding one.
 */
export function rangeSample(
  satrec: satellite.SatRec,
  observer: Observer,
  date: Date
): RangeSample | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || !pv.velocity) return null;

  const gmst = satellite.gstime(date);
  const observerGd: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(observer.longitude),
    latitude: satellite.degreesToRadians(observer.latitude),
    height: observer.elevation / 1000,
  };

  const satEci = pv.position as satellite.EciVec3<number>;
  const satVel = pv.velocity as satellite.EciVec3<number>;
  const obsEcf = satellite.geodeticToEcf(observerGd);
  const obsEci = satellite.ecfToEci(obsEcf, gmst);

  // The station's inertial velocity is omega cross r, with omega along +z.
  const obsVel = {
    x: -EARTH_ROTATION_RAD_S * obsEci.y,
    y: EARTH_ROTATION_RAD_S * obsEci.x,
    z: 0,
  };

  const dx = satEci.x - obsEci.x;
  const dy = satEci.y - obsEci.y;
  const dz = satEci.z - obsEci.z;
  const rangeKm = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(rangeKm) || rangeKm === 0) return null;

  const dvx = satVel.x - obsVel.x;
  const dvy = satVel.y - obsVel.y;
  const dvz = satVel.z - obsVel.z;
  // Projection of relative velocity onto the line of sight.
  const rangeRateKmS = (dx * dvx + dy * dvy + dz * dvz) / rangeKm;

  const look = satellite.ecfToLookAngles(observerGd, satellite.eciToEcf(satEci, gmst));

  return {
    rangeKm,
    rangeRateKmS,
    elevationDeg: satellite.radiansToDegrees(look.elevation),
    azimuthDeg: satellite.radiansToDegrees(look.azimuth),
  };
}

/**
 * Frequency as heard on the ground, given the transmitted frequency.
 *
 * Classical first-order Doppler, which is all that is warranted: the
 * relativistic correction at eight kilometres a second is about one part in
 * ten to the ninth, four orders of magnitude below the tuning resolution of
 * any radio this would be read on.
 */
export function receivedFrequencyHz(transmittedHz: number, rangeRateKmS: number): number {
  return transmittedHz * (1 - rangeRateKmS / C_KM_S);
}

/**
 * What to transmit on so the satellite hears its nominal uplink frequency.
 *
 * The correction runs the other way from the downlink: as the satellite
 * approaches you must transmit low, because its motion toward you raises what
 * it receives. Getting this backwards is the classic way to be inaudible
 * through a transponder while hearing yourself perfectly.
 */
export function transmitFrequencyHz(nominalUplinkHz: number, rangeRateKmS: number): number {
  return nominalUplinkHz * (1 + rangeRateKmS / C_KM_S);
}

/** Doppler offset in hertz, positive when the signal arrives high. */
export function dopplerShiftHz(frequencyHz: number, rangeRateKmS: number): number {
  return -frequencyHz * (rangeRateKmS / C_KM_S);
}

export interface RadioPass {
  satnum: string;
  name: string;
  /** Acquisition of signal: the satellite clears the horizon. */
  aos: Date;
  /** Time of closest approach, where the Doppler crosses zero. */
  tca: Date;
  los: Date;
  maxElevationDeg: number;
  aosAzimuthDeg: number;
  losAzimuthDeg: number;
  durationSeconds: number;
  /** Closest the satellite gets, km. */
  minRangeKm: number;
}

const STEP_SECONDS = 30;
const REFINE_SECONDS = 1;

/**
 * Iterations of ternary search used to pin a pass's peak and closest approach.
 *
 * Enough to take a sixty-second bracket down to well under a second, which is
 * finer than any of these numbers is displayed.
 */
const EXTREMUM_ITERATIONS = 40;

/**
 * Pin the instant a pass quantity reaches its extreme, by ternary search.
 *
 * Over a single pass, elevation rises to one peak and range falls to one
 * minimum, so repeatedly discarding the outer third of a bracket converges on
 * it. Both brackets are allowed to extend past the pass's own samples: outside
 * the pass elevation is lower and range is greater, so the search cannot be
 * pulled away from the extremum by looking there.
 *
 * This exists because taking the best of the coarse samples is not good enough,
 * and measurably so. Over 259 real passes on a thirty-second grid, the reported
 * peak elevation ran up to 6.6 degrees below the truth — one near-overhead pass
 * came out as 81.6 degrees when it actually reached 88.2 — and the closest
 * approach was reported up to 15 seconds early or late, every single time
 * landing exactly on a thirty-second boundary. That last one is the expensive
 * one: the closest approach is where the Doppler crosses zero, and at 435 MHz
 * being 15 seconds out leaves the shift 1,490 Hz from zero, worst case, against
 * a mean of 319. The observer's own motion, which this file goes to the trouble
 * of including because it is worth about 675 Hz, is smaller than the error being
 * made by rounding the moment to half a minute.
 */
function refineExtremum(
  satrec: satellite.SatRec,
  observer: Observer,
  centreMs: number,
  measure: (sample: RangeSample) => number
): { at: number; sample: RangeSample } | null {
  let lo = centreMs - STEP_SECONDS * 1000;
  let hi = centreMs + STEP_SECONDS * 1000;

  for (let i = 0; i < EXTREMUM_ITERATIONS && hi - lo > 20; i++) {
    const third = (hi - lo) / 3;
    const m1 = lo + third;
    const m2 = hi - third;
    const s1 = rangeSample(satrec, observer, new Date(m1));
    const s2 = rangeSample(satrec, observer, new Date(m2));
    if (!s1 || !s2) return null;
    // Both quantities are minimised: elevation is passed in negated.
    if (measure(s1) < measure(s2)) hi = m2;
    else lo = m1;
  }

  const at = Math.round((lo + hi) / 2);
  const sample = rangeSample(satrec, observer, new Date(at));
  return sample ? { at, sample } : null;
}

/**
 * Passes usable for radio: above the horizon, in daylight or dark alike.
 *
 * The minimum elevation defaults to zero rather than the optical ten degrees.
 * Low passes are hard work — more path loss, more terrain in the way, more
 * local noise — but they are workable, and a station on a hill or with a beam
 * would be poorly served by an app that pretended they did not exist.
 */
export function radioPasses(
  satrec: satellite.SatRec,
  observer: Observer,
  from: Date,
  hours = 24,
  minElevationDeg = 0
): RadioPass[] {
  const passes: RadioPass[] = [];
  const stepMs = STEP_SECONDS * 1000;
  const endMs = from.getTime() + hours * 3_600_000;

  let inPass = false;
  let samples: Array<{ at: number; sample: RangeSample }> = [];

  for (let t = from.getTime(); t <= endMs; t += stepMs) {
    const sample = rangeSample(satrec, observer, new Date(t));
    if (!sample) break;
    const up = sample.elevationDeg > minElevationDeg;

    if (up) {
      inPass = true;
      samples.push({ at: t, sample });
    } else if (inPass) {
      const pass = finalise(samples, satrec, observer, minElevationDeg);
      if (pass) passes.push(pass);
      inPass = false;
      samples = [];
    }
  }
  // A pass still running when the search window closes is real; it is simply
  // reported as ending at the edge rather than dropped.
  if (inPass && samples.length > 0) {
    const pass = finalise(samples, satrec, observer, minElevationDeg);
    if (pass) passes.push(pass);
  }

  return passes;
}

function finalise(
  samples: Array<{ at: number; sample: RangeSample }>,
  satrec: satellite.SatRec,
  observer: Observer,
  minElevationDeg: number
): RadioPass | null {
  if (samples.length === 0) return null;

  let peak = samples[0];
  let closest = samples[0];
  for (const entry of samples) {
    if (entry.sample.elevationDeg > peak.sample.elevationDeg) peak = entry;
    if (entry.sample.rangeKm < closest.sample.rangeKm) closest = entry;
  }

  // The coarse scan brackets both extremes; ternary search pins them. See
  // refineExtremum for what taking the grid's best sample was costing.
  const refinedPeak = refineExtremum(satrec, observer, peak.at, (s) => -s.elevationDeg);
  if (refinedPeak && refinedPeak.sample.elevationDeg > peak.sample.elevationDeg) peak = refinedPeak;
  const refinedClosest = refineExtremum(satrec, observer, closest.at, (s) => s.rangeKm);
  if (refinedClosest && refinedClosest.sample.rangeKm < closest.sample.rangeKm) closest = refinedClosest;

  // Refine the horizon crossings, which the thirty-second scan can only locate
  // to within half a minute — enough to matter when you are pointing an
  // antenna at where something is about to appear.
  const aosMs = refineCrossing(satrec, observer, samples[0].at, minElevationDeg, -1);
  const losMs = refineCrossing(satrec, observer, samples[samples.length - 1].at, minElevationDeg, +1);

  const aosSample = rangeSample(satrec, observer, new Date(aosMs));
  const losSample = rangeSample(satrec, observer, new Date(losMs));

  return {
    satnum: String(satrec.satnum),
    name: '',
    aos: new Date(aosMs),
    tca: new Date(closest.at),
    los: new Date(losMs),
    maxElevationDeg: peak.sample.elevationDeg,
    aosAzimuthDeg: aosSample?.azimuthDeg ?? samples[0].sample.azimuthDeg,
    losAzimuthDeg: losSample?.azimuthDeg ?? samples[samples.length - 1].sample.azimuthDeg,
    durationSeconds: Math.round((losMs - aosMs) / 1000),
    minRangeKm: closest.sample.rangeKm,
  };
}

/** Walk back or forward from a known in-pass sample to the horizon crossing. */
function refineCrossing(
  satrec: satellite.SatRec,
  observer: Observer,
  fromMs: number,
  minElevationDeg: number,
  direction: -1 | 1
): number {
  const stepMs = REFINE_SECONDS * 1000 * direction;
  let t = fromMs;
  for (let i = 0; i < STEP_SECONDS / REFINE_SECONDS; i++) {
    const next = t + stepMs;
    const sample = rangeSample(satrec, observer, new Date(next));
    if (!sample || sample.elevationDeg <= minElevationDeg) return t;
    t = next;
  }
  return t;
}

/** Attach names, and drop anything that will not propagate. */
export function radioPassesForTles(
  tles: TleRecord[],
  observer: Observer,
  from: Date,
  hours = 24,
  minElevationDeg = 0
): RadioPass[] {
  const out: RadioPass[] = [];
  for (const tle of tles) {
    const satrec = parseSatrec(tle);
    if (!satrec) continue;
    for (const pass of radioPasses(satrec, observer, from, hours, minElevationDeg)) {
      out.push({ ...pass, satnum: tle.satnum, name: tle.name });
    }
  }
  return out.sort((a, b) => a.aos.getTime() - b.aos.getTime());
}

/** Format a frequency for a radio's display. */
export function formatFrequency(hz: number): string {
  return `${(hz / 1e6).toFixed(4)} MHz`;
}

export function formatShift(hz: number): string {
  const rounded = Math.round(hz);
  return `${rounded >= 0 ? '+' : '−'}${Math.abs(rounded).toLocaleString()} Hz`;
}
