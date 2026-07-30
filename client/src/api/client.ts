import type { ExplainResult, ExplainSubject } from '../lib/explain';
import type { Observer, PassesResponse, TleResponse } from '../types';

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
