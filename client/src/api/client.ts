import type { AircraftResponse } from '../lib/aircraft';
import type { StarlinkTrainsResponse } from '../lib/starlinkTrains';
import type { EarthImageryResponse } from '../lib/earthImagery';
import type { ExplainResult, ExplainSubject } from '../lib/explain';
import type { OrbitAdviceRequest, OrbitAdviceResult } from '../lib/orbitAdvice';
import type {
  CustomPassesResponse,
  DebrisCatalogueResponse,
  DebrisCloudResponse,
  GroupCatalogueResponse,
  Observer,
  PassesResponse,
  SatcatResponse,
  CatalogueSearchResponse,
  SatelliteSearchResponse,
  SpaceTrackDebrisResponse,
  SingleTleResponse,
  SmallBodyResponse,
  TleRecord,
  TleResponse,
  TransmitterResponse,
} from '../types';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchPasses(observer: Observer, opts: { groups?: string[]; days?: number; minElevationDeg?: number } = {}): Promise<PassesResponse> {
  const params = new URLSearchParams({
    lat: String(observer.latitude),
    lon: String(observer.longitude),
    alt: String(observer.elevation),
    groups: (opts.groups ?? ['stations']).join(','),
    days: String(opts.days ?? 10),
    minEl: String(opts.minElevationDeg ?? 10),
  });
  return apiFetch<PassesResponse>(`/api/passes?${params.toString()}`);
}

/**
 * Most objects the sky dome will draw from any one group.
 *
 * Every one is propagated in the browser on each frame, and a group like
 * Starlink is eight thousand of them — over a megabyte of JSON before the
 * first triangle is drawn. The server keeps the brightest, which for a naked-eye
 * sky view is the only part that would have been visible anyway.
 */
export const SKY_DOME_LIMIT = 600;

export function fetchTles(group = 'stations', limit = SKY_DOME_LIMIT): Promise<TleResponse> {
  return apiFetch<TleResponse>(`/api/tle/${encodeURIComponent(group)}?limit=${limit}`);
}

export function fetchExplanation(subject: ExplainSubject): Promise<ExplainResult> {
  return apiFetch<ExplainResult>('/api/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subject),
  });
}

export function fetchOrbitAdvice(request: OrbitAdviceRequest): Promise<OrbitAdviceResult> {
  return apiFetch<OrbitAdviceResult>('/api/orbit-advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}

export function fetchAircraft(observer: Observer, radiusKm?: number): Promise<AircraftResponse> {
  const params = new URLSearchParams({
    lat: String(observer.latitude),
    lon: String(observer.longitude),
  });
  if (radiusKm !== undefined) params.set('radiusKm', String(radiusKm));
  return apiFetch<AircraftResponse>(`/api/aircraft?${params.toString()}`);
}

export function fetchSatelliteByNorad(catnr: string): Promise<SingleTleResponse> {
  return apiFetch<SingleTleResponse>(`/api/tle/satellite/${encodeURIComponent(catnr)}`);
}

export function fetchCustomPasses(
  observer: Observer,
  tles: TleRecord[],
  opts: { days?: number; minElevationDeg?: number } = {}
): Promise<CustomPassesResponse> {
  return apiFetch<CustomPassesResponse>('/api/passes/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      observer,
      tles,
      days: opts.days ?? 10,
      minElevationDeg: opts.minElevationDeg ?? 10,
    }),
  });
}

/**
 * Trains are found server-side: the scan needs the whole Starlink catalogue,
 * which is thousands of objects, to surface the handful still in formation.
 */
export function fetchStarlinkTrains(observer: Observer, days = 5): Promise<StarlinkTrainsResponse> {
  const params = new URLSearchParams({
    lat: String(observer.latitude),
    lon: String(observer.longitude),
    alt: String(observer.elevation),
    days: String(days),
  });
  return apiFetch<StarlinkTrainsResponse>(`/api/starlink/trains?${params.toString()}`);
}

/**
 * A recent Earth view from whichever geostationary weather satellite sees the
 * observer. The server picks and probes the source; the client just renders
 * whatever came back reachable.
 */
export function fetchEarthImagery(longitudeDeg: number): Promise<EarthImageryResponse> {
  return apiFetch<EarthImageryResponse>(`/api/earth-imagery?lon=${encodeURIComponent(longitudeDeg)}`);
}

export function fetchGroupCatalogue(): Promise<GroupCatalogueResponse> {
  return apiFetch<GroupCatalogueResponse>('/api/groups');
}

/**
 * Search the catalogue by name.
 *
 * Answered by Celestrak's own name query rather than by filtering groups here,
 * so it reaches objects in groups this app does not track at all.
 */
export function searchSatellites(query: string): Promise<SatelliteSearchResponse> {
  return apiFetch<SatelliteSearchResponse>(`/api/satellites/search?q=${encodeURIComponent(query)}`);
}

/** Amateur radio services for a satellite. Never rejects on an unreachable register. */
export function fetchTransmitters(satnum: string): Promise<TransmitterResponse> {
  return apiFetch<TransmitterResponse>(`/api/radio/${encodeURIComponent(satnum)}`);
}

/**
 * The full public debris catalogue, joined from Space-Track satcat + gp.
 *
 * Never rejects on an unconfigured or unreachable Space-Track — the server
 * reports source "unavailable" with the reason, and the screen keeps showing
 * the curated clouds and derelicts while saying that is what it is doing.
 */
export function fetchSpaceTrackDebris(limit?: number): Promise<SpaceTrackDebrisResponse> {
  const q = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return apiFetch<SpaceTrackDebrisResponse>(`/api/spacetrack/debris${q}`);
}

export interface DebrisFieldResponse {
  count: number;
  clouds: Array<{ id: string; label: string; count: number; source: string }>;
  source: 'live' | 'partial' | 'unavailable';
  tles: TleRecord[];
}

/**
 * Every fragment CelesTrak serves without an account.
 *
 * The fallback for the dome's point field when Space-Track has no credentials.
 * Fewer objects than the full catalogue and only from the four tracked breakup
 * events, but real, current, and available to everyone with no configuration.
 */
export function fetchDebrisField(): Promise<DebrisFieldResponse> {
  return apiFetch<DebrisFieldResponse>('/api/debris/field');
}

/**
 * Search the cached non-active catalogue.
 *
 * Served from the server's in-memory join, so a query per keystroke costs
 * Space-Track nothing. Never rejects — an unavailable catalogue comes back with
 * source "unavailable" and an empty result set.
 */
export function fetchCatalogueSearch(opts: {
  q?: string;
  type?: string;
  size?: string;
}): Promise<CatalogueSearchResponse> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.type) params.set('type', opts.type);
  if (opts.size) params.set('size', opts.size);
  return apiFetch<CatalogueSearchResponse>(`/api/spacetrack/search?${params.toString()}`);
}

/**
 * Catalogue metadata for one group: declared type and operational status.
 *
 * Never rejects on an unreachable SATCAT — the server reports source
 * "unavailable" with an empty list, and the caller falls back to classifying
 * by name exactly as before.
 */
export function fetchSatcat(group: string): Promise<SatcatResponse> {
  return apiFetch<SatcatResponse>(`/api/satcat/${encodeURIComponent(group)}`);
}

/** Comets and asteroids bright enough to look for. Never rejects. */
export function fetchSmallBodies(): Promise<SmallBodyResponse> {
  return apiFetch<SmallBodyResponse>('/api/small-bodies');
}

/** The debris catalogue: named clouds, and notable derelicts resolved one by one. */
export function fetchDebrisCatalogue(): Promise<DebrisCatalogueResponse> {
  return apiFetch<DebrisCatalogueResponse>('/api/debris/catalogue');
}

/** One breakup cloud's fragments. Explicitly requested — these are thousands of objects. */
export function fetchDebrisCloud(id: string): Promise<DebrisCloudResponse> {
  return apiFetch<DebrisCloudResponse>(`/api/debris/cloud/${encodeURIComponent(id)}`);
}
