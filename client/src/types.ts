export interface Observer {
  latitude: number;
  longitude: number;
  elevation: number;
}

export interface PassEvent {
  time: string;
  azimuthDeg: number;
  altitudeDeg: number;
  direction: string;
  magnitude: number | null;
}

export interface Pass {
  satnum: string;
  name: string;
  start: PassEvent;
  max: PassEvent;
  end: PassEvent;
  magnitude: number | null;
  durationSeconds: number;
  endReason: 'set' | 'shadow' | 'daylight';
}

/**
 * Provenance of the orbital elements behind a response.
 * "fixture" means bundled dev-only elements — not valid for real predictions.
 */
export type TleSource = 'live' | 'cache' | 'fixture';

export interface PassesResponse {
  observer: Observer;
  days: number;
  minElevationDeg: number;
  source: TleSource;
  satelliteCount: number;
  passCount: number;
  passes: Pass[];
}

export interface TleRecord {
  name: string;
  satnum: string;
  line1: string;
  line2: string;
}

export interface TleResponse {
  group: string;
  count: number;
  fetchedAt: string;
  source: TleSource;
  tles: TleRecord[];
}
