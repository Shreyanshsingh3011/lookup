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
  stepSeconds?: number;
  thresholdKm?: number;
}

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_STEP_SECONDS = 90;
export const DEFAULT_THRESHOLD_KM = 25;

/**
 * Two orbits can never come closer than the gap between their altitude
 * bands, so pairs whose perigee/apogee ranges don't overlap (with a margin,
 * since this is a cheap pre-filter, not the real distance check) are skipped
 * before ever propagating either one — this is what keeps an all-pairs scan
 * tractable, the same first-pass filter real screening pipelines use.
 */
export function altitudeBandsOverlap(a: OrbitalElements, b: OrbitalElements, marginKm = 100): boolean {
  return a.perigeeAltitudeKm - marginKm <= b.apogeeAltitudeKm && b.perigeeAltitudeKm - marginKm <= a.apogeeAltitudeKm;
}

function distanceKm(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Scans every pair of tracked satellites for their closest approach within
 * the given window, sampling both trajectories at a fixed resolution — a
 * crossing that fully happens and reverses between two samples could still
 * be missed, which is an inherent tradeoff against scanning dozens of
 * objects in the browser rather than a limitation worth hiding.
 */
export function findCloseApproaches(tles: TleRecord[], fromDate: Date, opts: ConjunctionScanOptions = {}): CloseApproach[] {
  const windowHours = opts.windowHours ?? DEFAULT_WINDOW_HOURS;
  const stepSeconds = opts.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const thresholdKm = opts.thresholdKm ?? DEFAULT_THRESHOLD_KM;

  const entries = tles
    .map((tle) => {
      const satrec = parseSatrec(tle);
      if (!satrec) return null;
      return { tle, satrec, elements: orbitalElementsFromTle(tle) };
    })
    .filter((e): e is { tle: TleRecord; satrec: satellite.SatRec; elements: OrbitalElements } => e !== null);

  const results: CloseApproach[] = [];
  const totalSteps = Math.floor((windowHours * 3600) / stepSeconds);

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.tle.satnum === b.tle.satnum) continue;
      if (!altitudeBandsOverlap(a.elements, b.elements)) continue;

      let bestDistanceKm = Infinity;
      let bestTime: Date | null = null;
      for (let step = 0; step <= totalSteps; step++) {
        const date = new Date(fromDate.getTime() + step * stepSeconds * 1000);
        const pvA = satellite.propagate(a.satrec, date);
        const pvB = satellite.propagate(b.satrec, date);
        if (!pvA || !pvB) continue;
        const d = distanceKm(pvA.position, pvB.position);
        if (d < bestDistanceKm) {
          bestDistanceKm = d;
          bestTime = date;
        }
      }

      if (bestTime && bestDistanceKm <= thresholdKm) {
        results.push({
          satnumA: a.tle.satnum,
          nameA: a.tle.name,
          satnumB: b.tle.satnum,
          nameB: b.tle.name,
          minDistanceKm: Math.round(bestDistanceKm * 10) / 10,
          timeOfClosestApproach: bestTime.toISOString(),
        });
      }
    }
  }

  return results.sort((x, y) => x.minDistanceKm - y.minDistanceKm);
}
