import type { Observer } from '../types';

/**
 * Turning a reported aircraft position into a position in the observer's sky.
 *
 * Unlike satellites, aircraft broadcast where they actually are, so there is
 * no orbit model here — just geometry. The conversion goes geodetic (lat/lon/
 * altitude) to ECEF (an Earth-fixed Cartesian frame) to ENU (east/north/up at
 * the observer), which then reads off directly as azimuth and elevation.
 *
 * WGS84 ellipsoid parameters, matching what GPS and ADS-B report against.
 */
const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

const DEG = Math.PI / 180;

export interface AircraftState {
  icao24: string;
  callsign: string | null;
  originCountry: string;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeM: number;
  velocityMS: number | null;
  trueTrackDeg: number | null;
  /**
   * ADS-B emitter category as broadcast ("A3" large, "A6" high performance),
   * or null when the aircraft does not transmit one.
   */
  category: string | null;
  verticalRateMS: number | null;
  onGround: boolean;
  lastContact: number;
}

export interface AircraftResponse {
  observer: { latitude: number; longitude: number };
  status: 'live' | 'cache' | 'unavailable';
  error?: string;
  time: number | null;
  fetchedAt: string | null;
  count: number;
  aircraft: AircraftState[];
}

/** Geodetic coordinates to Earth-Centered Earth-Fixed metres. */
function geodeticToEcef(latitudeDeg: number, longitudeDeg: number, altitudeM: number) {
  const lat = latitudeDeg * DEG;
  const lon = longitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  // Radius of curvature in the prime vertical.
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + altitudeM) * cosLat * Math.cos(lon),
    y: (n + altitudeM) * cosLat * Math.sin(lon),
    z: (n * (1 - WGS84_E2) + altitudeM) * sinLat,
  };
}

export interface SkyPosition {
  azimuthDeg: number;
  elevationDeg: number;
  /** Straight-line distance from observer to aircraft, kilometres. */
  rangeKm: number;
}

/**
 * Where an aircraft appears in the observer's sky.
 *
 * Elevation is geometric — it ignores atmospheric refraction, which bends
 * light by under half a degree even at the horizon and is irrelevant for
 * something as close and as high in the sky as an airliner.
 */
export function aircraftSkyPosition(
  aircraft: Pick<AircraftState, 'latitudeDeg' | 'longitudeDeg' | 'altitudeM'>,
  observer: Observer
): SkyPosition {
  const target = geodeticToEcef(aircraft.latitudeDeg, aircraft.longitudeDeg, aircraft.altitudeM);
  const origin = geodeticToEcef(observer.latitude, observer.longitude, observer.elevation);

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;

  const lat = observer.latitude * DEG;
  const lon = observer.longitude * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);

  // Rotate the Earth-fixed offset into the observer's local east/north/up frame.
  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const horizontal = Math.hypot(east, north);
  let azimuthDeg = Math.atan2(east, north) / DEG;
  if (azimuthDeg < 0) azimuthDeg += 360;

  return {
    azimuthDeg,
    elevationDeg: Math.atan2(up, horizontal) / DEG,
    rangeKm: Math.hypot(horizontal, up) / 1000,
  };
}

/**
 * Advance an aircraft along its last reported track.
 *
 * The upstream snapshot is cached for up to a minute to stay inside OpenSky's
 * quota, and an airliner covers roughly 15 km in that time — enough to be
 * visibly wrong if drawn at a stale position. Aircraft in cruise fly straight
 * and level, so projecting along the reported ground track and vertical rate
 * tracks reality closely; a turning aircraft will drift until the next poll
 * corrects it, which is an accepted trade for not exhausting the API budget.
 *
 * Returns the input unchanged when there is no velocity or track to project
 * along, rather than inventing motion.
 */
export function deadReckon(aircraft: AircraftState, elapsedSeconds: number): AircraftState {
  if (
    elapsedSeconds <= 0 ||
    aircraft.onGround ||
    aircraft.velocityMS === null ||
    aircraft.trueTrackDeg === null ||
    aircraft.velocityMS <= 0
  ) {
    return aircraft;
  }

  const distanceM = aircraft.velocityMS * elapsedSeconds;
  const bearing = aircraft.trueTrackDeg * DEG;
  // Mean Earth radius is plenty here: over tens of kilometres the ellipsoid
  // correction is far smaller than the uncertainty already in dead reckoning.
  const angular = distanceM / 6371000;

  const lat = aircraft.latitudeDeg * DEG;
  const lon = aircraft.longitudeDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinAngular = Math.sin(angular);
  const cosAngular = Math.cos(angular);

  const nextLat = Math.asin(sinLat * cosAngular + cosLat * sinAngular * Math.cos(bearing));
  const nextLon =
    lon +
    Math.atan2(Math.sin(bearing) * sinAngular * cosLat, cosAngular - sinLat * Math.sin(nextLat));

  const climb = aircraft.verticalRateMS !== null ? aircraft.verticalRateMS * elapsedSeconds : 0;

  return {
    ...aircraft,
    latitudeDeg: nextLat / DEG,
    // Normalise back into [-180, 180] so a track crossing the antimeridian stays valid.
    longitudeDeg: (((nextLon / DEG + 180) % 360) + 360) % 360 - 180,
    altitudeM: Math.max(0, aircraft.altitudeM + climb),
  };
}

/** Human-readable label for an aircraft, preferring its callsign. */
export function aircraftLabel(aircraft: AircraftState): string {
  return aircraft.callsign ?? aircraft.icao24.toUpperCase();
}
