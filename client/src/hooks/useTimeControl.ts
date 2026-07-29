import { useCallback, useEffect, useMemo, useState } from 'react';

/** The scrubber spans from the anchor ("now") to 24 hours ahead. */
export const TIME_RANGE_MS = 24 * 60 * 60 * 1000;

export const PLAYBACK_SPEEDS = [1, 60, 300, 1800] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Cap recomputation during playback; 60fps propagation is wasted work. */
const PLAYBACK_TICK_MS = 40;

export interface TimeControl {
  displayTime: Date;
  offsetMs: number;
  live: boolean;
  playing: boolean;
  speed: PlaybackSpeed;
  setOffsetMs: (ms: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  togglePlay: () => void;
  resetToNow: () => void;
}

/**
 * Decouples the sky's "display time" from wall-clock time.
 *
 * In live mode the anchor tracks the real clock each second. Scrubbing or
 * playing freezes the anchor and moves an offset instead, so satellite
 * positions can be previewed up to 24 hours ahead.
 */
export function useTimeControl(): TimeControl {
  const [anchor, setAnchor] = useState(() => Date.now());
  const [offsetMs, setOffsetMsState] = useState(0);
  const [live, setLive] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(60);

  // Live mode: follow the real clock.
  useEffect(() => {
    if (!live || playing) return;
    const id = setInterval(() => setAnchor(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, playing]);

  // Playback: advance the offset at `speed` times real time.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let accumulated = 0;

    const step = (now: number) => {
      const frameMs = now - last;
      last = now;
      accumulated += frameMs;

      if (accumulated >= PLAYBACK_TICK_MS) {
        const advance = accumulated * speed;
        accumulated = 0;
        setOffsetMsState((prev) => {
          const next = prev + advance;
          if (next >= TIME_RANGE_MS) {
            setPlaying(false);
            return TIME_RANGE_MS;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const setOffsetMs = useCallback((ms: number) => {
    setLive(ms === 0);
    setPlaying(false);
    setOffsetMsState(Math.max(0, Math.min(ms, TIME_RANGE_MS)));
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      const next = !p;
      // Freeze the anchor while playing so the offset alone drives time.
      if (next) setLive(false);
      return next;
    });
  }, []);

  const resetToNow = useCallback(() => {
    setAnchor(Date.now());
    setOffsetMsState(0);
    setLive(true);
    setPlaying(false);
  }, []);

  const displayTime = useMemo(() => new Date(anchor + offsetMs), [anchor, offsetMs]);

  return { displayTime, offsetMs, live, playing, speed, setOffsetMs, setSpeed, togglePlay, resetToNow };
}
