import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAircraft } from '../api/client';
import { aircraftSkyPosition, deadReckon, type AircraftState, type SkyPosition } from '../lib/aircraft';
import type { Observer } from '../types';

/**
 * How often to re-poll the server. The server caches upstream responses for
 * about a minute to stay inside OpenSky's quota, so polling much faster than
 * this would just re-read the same snapshot.
 */
const POLL_INTERVAL_MS = 30_000;

/** How often to re-project dead-reckoned positions, for smooth movement. */
const TICK_INTERVAL_MS = 1000;

/**
 * Drop a contact this long after its last received position. ADS-B updates
 * every few seconds when an aircraft is in range, so a minutes-old contact
 * has almost certainly flown out of receiver coverage — better to remove it
 * than to keep dead-reckoning a ghost across the sky indefinitely.
 */
const STALE_AFTER_SECONDS = 180;

export interface LiveAircraft {
  state: AircraftState;
  sky: SkyPosition;
}

export interface AircraftFeed {
  aircraft: LiveAircraft[];
  status: 'idle' | 'live' | 'cache' | 'unavailable';
  error: string | null;
}

/**
 * Live aircraft above the observer.
 *
 * Positions are extrapolated between polls: the server's snapshot is up to a
 * minute old, and an airliner moves visibly in that time, so each aircraft is
 * projected along its last reported track (see deadReckon) and re-projected
 * into the sky once a second.
 */
export function useAircraft(observer: Observer, enabled: boolean): AircraftFeed {
  const [snapshot, setSnapshot] = useState<{ aircraft: AircraftState[]; at: number } | null>(null);
  const [status, setStatus] = useState<AircraftFeed['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      setStatus('idle');
      setError(null);
      return;
    }

    cancelledRef.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = () => {
      fetchAircraft(observer)
        .then((res) => {
          if (cancelledRef.current) return;
          setStatus(res.status);
          setError(res.error ?? null);
          // Keep the previous snapshot when the upstream is unreachable rather
          // than blanking the sky; dead reckoning carries it for a while.
          if (res.status !== 'unavailable') {
            setSnapshot({ aircraft: res.aircraft, at: Date.now() });
          }
        })
        .catch((err) => {
          if (cancelledRef.current) return;
          setStatus('unavailable');
          setError(err instanceof Error ? err.message : 'Failed to load aircraft');
        });
    };

    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      if (timer) clearInterval(timer);
    };
  }, [observer, enabled]);

  // Re-project on a steady tick so aircraft visibly move between polls.
  useEffect(() => {
    if (!enabled || !snapshot) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, snapshot]);

  const aircraft = useMemo(() => {
    if (!snapshot) return [];
    // `tick` is what drives re-projection as wall-clock time advances.
    void tick;

    const nowMs = Date.now();
    const nowSeconds = nowMs / 1000;
    const out: LiveAircraft[] = [];

    for (const state of snapshot.aircraft) {
      if (state.onGround) continue;
      if (nowSeconds - state.lastContact > STALE_AFTER_SECONDS) continue;

      // Project from when the position was actually measured, not from when
      // we happened to receive it.
      const projected = deadReckon(state, nowSeconds - state.lastContact);
      const sky = aircraftSkyPosition(projected, observer);
      if (sky.elevationDeg < 0) continue;

      out.push({ state: projected, sky });
    }

    // Highest first, so the closest-to-overhead labels win any overlap.
    return out.sort((a, b) => b.sky.elevationDeg - a.sky.elevationDeg);
  }, [snapshot, observer, tick]);

  return { aircraft, status, error };
}
