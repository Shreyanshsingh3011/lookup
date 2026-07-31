import type { AircraftResponse } from '../lib/aircraft';
import type { StarlinkTrainsResponse } from '../lib/starlinkTrains';
import type { EarthImageryResponse } from '../lib/earthImagery';
import type { ExplainResult, ExplainSubject } from '../lib/explain';
import type { OrbitAdviceRequest, OrbitAdviceResult } from '../lib/orbitAdvice';
import type { CustomPassesResponse, Observer, PassesResponse, SingleTleResponse, TleRecord, TleResponse } from '../types';

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

export function fetchTles(group = 'stations'): Promise<TleResponse> {
  return apiFetch<TleResponse>(`/api/tle/${encodeURIComponent(group)}`);
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
