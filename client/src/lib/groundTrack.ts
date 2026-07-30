import * as satellite from 'satellite.js';
import { Astronomy } from './astronomy';
import type { TleRecord } from '../types';

export interface GroundPoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

const EARTH_RADIUS_KM = 6371;

function normalizeLon(lonDeg: number): number {
  return (((lonDeg + 180) % 360) + 360) % 360 - 180;
}

/** The point on the ground directly beneath the satellite, right now. */
export function subSatellitePoint(
  satrec: satellite.SatRec,
  date: Date
): (GroundPoint & { altitudeKm: number }) | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  return {
    latitudeDeg: satellite.degreesLat(geo.latitude),
    longitudeDeg: normalizeLon(satellite.degreesLong(geo.longitude)),
    altitudeKm: geo.height,
  };
}

/** Orbital period in minutes, from the TLE's mean-motion field (revs/day). */
export function orbitalPeriodMinutes(tle: TleRecord): number {
  const revsPerDay = Number(tle.line2.slice(52, 63));
  return 1440 / revsPerDay;
}

/**
 * Sub-satellite points sampled across a time span, centred on `centerTime`.
 * A ground track is normally shown across roughly one orbit — long enough to
 * see the satellite's actual coverage pattern, short enough not to overlap
 * itself into an unreadable tangle for a low-Earth orbit.
 */
export function groundTrack(
  satrec: satellite.SatRec,
  centerTime: Date,
  spanMinutes: number,
  steps = 90
): GroundPoint[] {
  const points: GroundPoint[] = [];
  const startMs = centerTime.getTime() - (spanMinutes * 60_000) / 2;
  const stepMs = (spanMinutes * 60_000) / steps;
  for (let i = 0; i <= steps; i++) {
    const point = subSatellitePoint(satrec, new Date(startMs + i * stepMs));
    if (point) points.push(point);
  }
  return points;
}

/**
 * Splits a sequence of consecutive ground points into separate runs wherever
 * consecutive samples cross the antimeridian, so an equirectangular map
 * doesn't draw a spurious line all the way across the map at that point.
 */
export function splitAtAntimeridian<T extends GroundPoint>(points: T[]): T[][] {
  const segments: T[][] = [];
  let current: T[] = [];
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev && Math.abs(p.longitudeDeg - prev.longitudeDeg) > 180) {
      segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

/**
 * Destination point at great-circle angular distance `angularDistanceDeg`
 * from `center`, along compass bearing `bearingDeg` (0 = north, clockwise).
 * Standard spherical "destination point given distance and bearing" formula.
 */
export function destinationPoint(
  center: GroundPoint,
  angularDistanceDeg: number,
  bearingDeg: number
): GroundPoint {
  const phi1 = (center.latitudeDeg * Math.PI) / 180;
  const lambda1 = (center.longitudeDeg * Math.PI) / 180;
  const delta = (angularDistanceDeg * Math.PI) / 180;
  const theta = (bearingDeg * Math.PI) / 180;

  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.max(-1, Math.min(1, sinPhi2)));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2);
  const lambda2 = lambda1 + Math.atan2(y, x);

  return {
    latitudeDeg: (phi2 * 180) / Math.PI,
    longitudeDeg: normalizeLon((lambda2 * 180) / Math.PI),
  };
}

/** A small circle at fixed angular radius around a centre point, e.g. a footprint or the terminator. */
export function circleAround(center: GroundPoint, angularRadiusDeg: number, steps = 72): GroundPoint[] {
  const points: GroundPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(destinationPoint(center, angularRadiusDeg, (i / steps) * 360));
  }
  return points;
}

/**
 * Angular radius of a satellite's geometric coverage circle: the ground
 * distance, in degrees of arc, out to the true horizon as seen from orbit.
 */
export function footprintRadiusDeg(altitudeKm: number): number {
  return (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm)) * 180) / Math.PI;
}

/**
 * The point on Earth directly beneath the Sun right now — the pole of the
 * day/night terminator, which sits 90 degrees of arc away from it in every
 * direction. Parallax between a geocentric and topocentric Sun position is a
 * few arcseconds at most, negligible at this map's scale, so an observer at
 * the geographic origin stands in for a true geocentric calculation.
 */
export function subsolarPoint(date: Date): GroundPoint {
  const observer = new Astronomy.Observer(0, 0, 0);
  const sun = 'Sun' as Parameters<typeof Astronomy.Equator>[0];
  const eq = Astronomy.Equator(sun, date, observer, true, true);
  const gmstDeg = (satellite.gstime(date) * 180) / Math.PI;
  const raDeg = eq.ra * 15;
  return { latitudeDeg: eq.dec, longitudeDeg: normalizeLon(raDeg - gmstDeg) };
}
