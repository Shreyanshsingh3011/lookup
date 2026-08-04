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
  /**
   * Forecast cloud cover percent at the pass maximum, or null when no forecast
   * covers that time. Advisory only — never affects whether a pass is listed.
   */
  cloudCoverPercent?: number | null;
}

/**
 * Provenance of the orbital elements behind a response.
 * "file" means operator-supplied via TLE_FILE; "fixture" means bundled dev-only
 * elements, which are not valid for real predictions.
 */
export type TleSource = 'live' | 'file' | 'cache' | 'fixture';

/** How old the elements are, independently of where they came from. */
export interface EpochSpan {
  newestAgeDays: number;
  oldestAgeDays: number;
}

export interface PassesResponse {
  observer: Observer;
  days: number;
  minElevationDeg: number;
  maxMagnitude: number;
  source: TleSource;
  epoch: EpochSpan | null;
  /** Objects actually scanned, after the cap. */
  satelliteCount: number;
  /** Everything the chosen groups contain, before the cap. */
  catalogueCount?: number;
  /** Objects the cap ranked out as the faintest candidates and never scanned. */
  notScannedCount?: number;
  maxScannedSatellites?: number;
  passCount: number;
  /** Geometrically valid passes omitted for being fainter than the cutoff. */
  tooFaintCount: number;
  brightestRejectedMagnitude: number | null;
  weather: { status: 'live' | 'cache' | 'unavailable'; error?: string };
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
  /** Everything in the group upstream, before any limit was applied. */
  catalogueCount?: number;
  /** Objects the limit ranked out as too faint to draw. */
  omittedCount?: number;
  fetchedAt: string;
  source: TleSource;
  epoch: EpochSpan | null;
  tles: TleRecord[];
}

export interface SingleTleResponse {
  tle: TleRecord;
  source: 'live' | 'cache';
  fetchedAt: string;
  epoch: EpochSpan | null;
}

/**
 * Passes for satellites the client supplied directly (pasted, or looked up
 * by NORAD ID), as opposed to one of the bundled Celestrak groups — so there
 * is no single meaningful TleSource or maxMagnitude filter to report.
 */
export interface CustomPassesResponse {
  observer: Observer;
  days: number;
  minElevationDeg: number;
  epoch: EpochSpan | null;
  satelliteCount: number;
  passCount: number;
  tooFaintCount: number;
  brightestRejectedMagnitude: number | null;
  weather: { status: 'live' | 'cache' | 'unavailable'; error?: string };
  passes: Pass[];
}

export interface GroupCatalogueResponse {
  groups: import('./lib/satelliteGroups').SatelliteGroup[];
  /** Most objects a single pass search will scan, whatever is selected. */
  maxScannedSatellites: number;
}

export interface SatelliteSearchResponse {
  query: string;
  count: number;
  /** The upstream had more matches than were returned. */
  truncated: boolean;
  limit: number;
  source: 'live' | 'cache';
  epoch: EpochSpan | null;
  tles: TleRecord[];
}
