import * as satellite from 'satellite.js';
import type { Observer, TleRecord } from '../types';

/**
 * Radius of the sky dome in scene units. The camera sits essentially at the
 * centre (see CAMERA_DISTANCE), so this only needs to be large enough that the
 * tiny camera offset causes no visible parallax against the placed objects.
 */
export const DOME_RADIUS = 100;

/** Above this fraction of the Sun's disc covered by Earth, treat as eclipsed. */
const ECLIPSE_THRESHOLD = 0.99;

/**
 * Convert horizontal coordinates to a scene position.
 *
 * Scene convention: +Y is up (zenith), North is -Z, East is +X — so a compass
 * rose laid on the ground plane reads the same way a paper star chart does.
 */
export function azElToVec3(azDeg: number, elDeg: number, radius = DOME_RADIUS): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [radius * cosEl * Math.sin(az), radius * Math.sin(el), -radius * cosEl * Math.cos(az)];
}

export function observerToGeodetic(o: Observer): satellite.GeodeticLocation {
  return {
    longitude: satellite.degreesToRadians(o.longitude),
    latitude: satellite.degreesToRadians(o.latitude),
    height: o.elevation / 1000,
  };
}

export interface SkySample {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  altitudeKm: number;
  speedKmS: number;
  illuminated: boolean;
}

/** Parse a TLE into a satrec, returning null rather than throwing on bad input. */
export function parseSatrec(tle: TleRecord): satellite.SatRec | null {
  try {
    const rec = satellite.twoline2satrec(tle.line1, tle.line2);
    return rec.error ? null : rec;
  } catch {
    return null;
  }
}

/** Propagate one satellite to `date` and express it in the observer's sky. */
export function skySampleAt(
  satrec: satellite.SatRec,
  observerGd: satellite.GeodeticLocation,
  date: Date
): SkySample | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv) return null; // decayed, or SGP4 error

  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, ecf);
  const geo = satellite.eciToGeodetic(pv.position, gmst);

  const { x, y, z } = pv.velocity;
  const speedKmS = Math.sqrt(x * x + y * y + z * z);

  const sun = satellite.sunPos(satellite.jday(date));
  const shadowFrac = satellite.shadowFraction(sun.rsun, pv.position);

  return {
    azimuthDeg: satellite.radiansToDegrees(look.azimuth),
    elevationDeg: satellite.radiansToDegrees(look.elevation),
    rangeKm: look.rangeSat,
    altitudeKm: geo.height,
    speedKmS,
    illuminated: shadowFrac < ECLIPSE_THRESHOLD,
  };
}

/**
 * Points for a satellite's recent ground-relative track, newest last.
 *
 * Rather than accumulating a rolling buffer of observed samples, the trail is
 * re-derived analytically by propagating backwards from `date`. That keeps it
 * stateless, so it stays correct when the display time is scrubbed or played
 * back at speed instead of only advancing in real time.
 */
export function trailPoints(
  satrec: satellite.SatRec,
  observerGd: satellite.GeodeticLocation,
  date: Date,
  spanMinutes = 6,
  steps = 48
): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (let i = steps; i >= 0; i--) {
    const t = new Date(date.getTime() - (i / steps) * spanMinutes * 60_000);
    const sample = skySampleAt(satrec, observerGd, t);
    // Clip below the horizon: the trail should emerge from where the satellite
    // rose, not tunnel through the ground.
    if (!sample || sample.elevationDeg < 0) continue;
    points.push(azElToVec3(sample.azimuthDeg, sample.elevationDeg));
  }
  return points;
}

const COMPASS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function azToCompass(azDeg: number): string {
  const idx = Math.round((((azDeg % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS[idx];
}
