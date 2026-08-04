import { useCallback, useEffect, useMemo, useState } from 'react';

/** The scrubber spans from the anchor ("now") to 24 hours ahead. */
export const TIME_RANGE_MS = 24 * 60 * 60 * 1000;

export const PLAYBACK_SPEEDS = [1, 60, 300, 1800] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** Cap recomputation during playback; 60fps propagation is wasted work. */
const PLAYBACK_TICK_MS = 40;

/** Lead-in when jumping to an event, so the approach is visible first. */
const GOTO_LEAD_MS = 2 * 60 * 1000;

export interface TimeControl {
  displayTime: Date;
  offsetMs: number;
  live: boolean;
  playing: boolean;
  speed: PlaybackSpeed;
  /**
   * Whether the timeline's zero point is the real "now". Jumping to a specific
   * event re-anchors it, at which point "+2h from now" would be a lie.
   */
  anchoredToNow: boolean;
  setOffsetMs: (ms: number) => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  togglePlay: () => void;
  resetToNow: () => void;
  /** Jump the display time to a specific instant, however far ahead it is. */
  goToTime: (date: Date) => void;
}

/**
 * Decouples the sky's "display time" from wall-clock time.
 *
 * In live mode the anchor tracks the real clock each second. Scrubbing or
 * playing freezes the anchor and moves an offset instead, so satellite
 * positions can be previewed up to 24 hours ahead.
 */
/**
 * @param pinnedTo Instant from a shared link. Opening one lands on that moment
 *   rather than on now, since the whole point of sharing a pass is the moment.
 */
export function useTimeControl(pinnedTo?: Date | null): TimeControl {
  const [anchor, setAnchor] = useState(() => pinnedTo?.getTime() ?? Date.now());
  const [offsetMs, setOffsetMsState] = useState(0);
  const [live, setLive] = useState(!pinnedTo);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(60);
  // A shared instant is not "now", so the scrubber must not label offsets from
  // it as "+2h from now" — that would be a lie about a time somebody else chose.
  const [anchoredToNow, setAnchoredToNow] = useState(!pinnedTo);

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

  const setOffsetMs = useCallback(
    (ms: number) => {
      // Scrubbing back to zero only means "live" if zero still represents now.
      setLive(ms === 0 && anchoredToNow);
      setPlaying(false);
      setOffsetMsState(Math.max(0, Math.min(ms, TIME_RANGE_MS)));
    },
    [anchoredToNow]
  );

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
    setAnchoredToNow(true);
  }, []);

  /**
   * Re-anchor the timeline just before `date` rather than offsetting from now.
   * Passes are predicted up to 10 days out, well beyond the 24-hour scrub
   * range, so an offset from the present instant could not reach them.
   */
  const goToTime = useCallback((date: Date) => {
    setAnchor(date.getTime() - GOTO_LEAD_MS);
    setOffsetMsState(GOTO_LEAD_MS);
    setLive(false);
    setPlaying(false);
    setAnchoredToNow(false);
  }, []);

  const displayTime = useMemo(() => new Date(anchor + offsetMs), [anchor, offsetMs]);

  return {
    displayTime,
    offsetMs,
    live,
    playing,
    speed,
    anchoredToNow,
    setOffsetMs,
    setSpeed,
    togglePlay,
    resetToNow,
    goToTime,
  };
}
