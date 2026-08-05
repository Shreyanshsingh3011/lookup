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

export interface Transmitter {
  description: string;
  /** Hz, or null for a service that only goes one way. */
  uplinkHz: number | null;
  downlinkHz: number | null;
  mode: string | null;
  /** Whether the register believes this service still works. */
  alive: boolean;
  type: string | null;
}

export interface TransmitterResponse {
  satnum: string;
  transmitters: Transmitter[];
  source: 'live' | 'cache' | 'builtin' | 'unavailable';
  error?: string;
}

export interface SmallBodyRecord {
  id: string;
  name: string;
  kind: 'comet' | 'asteroid';
  e: number;
  /** Perihelion distance, AU. */
  q: number;
  /** Time of perihelion passage, ISO. */
  tp: string;
  i: number;
  node: number;
  peri: number;
  /** H for an asteroid, M1 for a comet. */
  absoluteMagnitude: number | null;
  /** G for an asteroid, K1 for a comet. */
  slope: number | null;
}

export interface SmallBodyResponse {
  bodies: SmallBodyRecord[];
  source: 'live' | 'cache' | 'builtin';
  error?: string;
}

export type ObjectType = 'PAYLOAD' | 'ROCKET BODY' | 'DEBRIS' | 'UNKNOWN';

/** A breakup event whose fragments are still catalogued together. */
export interface DebrisCloud {
  id: string;
  celestrakGroup: string;
  label: string;
  event: string;
  eventDate: string;
  /** Historical peak, not the current population. See server/src/debris.ts. */
  peakCatalogued: number;
  altitudeBandKm: [number, number];
}

export interface NotableDerelict {
  satnum: string;
  label: string;
  kind: 'rocket-body' | 'payload';
  note: string;
}

/** A derelict lookup, which may legitimately have found nothing. */
export interface ResolvedDerelict {
  entry: NotableDerelict;
  status: 'resolved' | 'not-in-catalogue' | 'unavailable';
  tle: TleRecord | null;
  error?: string;
}

export interface DebrisCatalogueResponse {
  clouds: DebrisCloud[];
  derelicts: ResolvedDerelict[];
  resolvedCount: number;
}

export interface DebrisCloudResponse {
  cloud: DebrisCloud;
  count: number;
  /** The object that broke up, identified in the fetched data. Often gone. */
  parent: { satnum: string; name: string } | null;
  typeCounts: Partial<Record<ObjectType, number>>;
  source: TleSource;
  epoch: EpochSpan | null;
  fetchedAt: string;
  tles: TleRecord[];
}

/**
 * Catalogue metadata for one object, which element sets do not carry.
 *
 * A TLE says where something is, never whether anything aboard still works.
 * This is what closes that gap — see server/src/satcat.ts.
 */
export type OpsStatus =
  | 'operational'
  | 'nonoperational'
  | 'partially-operational'
  | 'backup'
  | 'spare'
  | 'extended-mission'
  | 'decayed'
  | 'unknown';

export interface SatcatEntry {
  satnum: string;
  name: string;
  objectType: 'PAYLOAD' | 'ROCKET BODY' | 'DEBRIS' | 'UNKNOWN';
  opsStatus: OpsStatus;
  /** Radar cross-section in square metres, where measured. */
  rcsSquareMetres: number | null;
  launchDate: string | null;
  decayDate: string | null;
}

export interface SatcatResponse {
  group: string;
  count: number;
  source: 'live' | 'cache' | 'unavailable';
  endpoint?: string;
  fetchedAt: string | null;
  error?: string;
  derelictCount: number;
  entries: SatcatEntry[];
}
