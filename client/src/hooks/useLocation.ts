import { useCallback, useEffect, useState } from 'react';
import type { Observer } from '../types';

const STORAGE_KEY = 'lookup.observer';

const DEFAULT_OBSERVER: Observer = { latitude: 51.4769, longitude: -0.0005, elevation: 45 }; // Royal Observatory, Greenwich

function loadStored(): Observer | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.latitude === 'number' && typeof parsed.longitude === 'number') {
      return { latitude: parsed.latitude, longitude: parsed.longitude, elevation: parsed.elevation ?? 0 };
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

/**
 * @param shared Location from a shared link, which outranks stored and default.
 */
export function useLocation(shared?: Observer | null) {
  const [observer, setObserver] = useState<Observer>(() => shared ?? loadStored() ?? DEFAULT_OBSERVER);
  const [source, setSource] = useState<'default' | 'stored' | 'geolocation' | 'manual' | 'shared'>(() =>
    shared ? 'shared' : loadStored() ? 'stored' : 'default'
  );
  const [geoStatus, setGeoStatus] = useState<'idle' | 'locating' | 'error'>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    // Someone else's link should not quietly replace the location you saved.
    // Opening a shared view shows you that sky; it does not move your home.
    // The moment you pick a location yourself, that is stored as normal.
    if (source === 'shared') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(observer));
  }, [observer, source]);

  const useGeolocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('error');
      setGeoError('Geolocation is not supported by this browser.');
      return;
    }
    setGeoStatus('locating');
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setObserver({
          latitude: Math.round(pos.coords.latitude * 10000) / 10000,
          longitude: Math.round(pos.coords.longitude * 10000) / 10000,
          elevation: pos.coords.altitude ? Math.round(pos.coords.altitude) : 0,
        });
        setSource('geolocation');
        setGeoStatus('idle');
      },
      (err) => {
        setGeoStatus('error');
        setGeoError(err.message || 'Unable to retrieve your location.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const setManualLocation = useCallback((next: Observer) => {
    setObserver(next);
    setSource('manual');
    setGeoStatus('idle');
    setGeoError(null);
  }, []);

  return { observer, source, geoStatus, geoError, useGeolocation, setManualLocation };
}
