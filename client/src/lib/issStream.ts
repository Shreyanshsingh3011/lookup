import * as satellite from 'satellite.js';
import { parseSatrec, satelliteSunlit } from './sky';
import type { TleRecord } from '../types';

/**
 * NASA's live view from the International Space Station.
 *
 * The ISS is the only tracked object here with a live feed at all. Satellites
 * do not generally carry cameras pointed at anything, let alone downlink them
 * publicly — offering "live video" for a Starlink or a weather satellite would
 * be showing something that is not what it claims to be. So this is
 * deliberately ISS-only.
 *
 * The embed targets NASA's channel rather than a video id, because the id
 * rotates every time the stream restarts and a hardcoded one would quietly rot
 * into a dead player.
 */
export const NASA_CHANNEL_ID = 'UCLA_DiR1FfKNvjuUpBHmylQ';

/** youtube-nocookie so simply opening the panel does not set tracking cookies. */
export const NASA_LIVE_EMBED_URL = `https://www.youtube-nocookie.com/embed/live_stream?channel=${NASA_CHANNEL_ID}`;

/** Always offered alongside the embed, in case the player itself is blocked. */
export const NASA_LIVE_WATCH_URL = `https://www.youtube.com/channel/${NASA_CHANNEL_ID}/live`;

export function isIssName(name: string): boolean {
  return /\bISS\b|ZARYA/i.test(name);
}

export function findIss(tles: TleRecord[]): TleRecord | null {
  return tles.find((t) => isIssName(t.name)) ?? null;
}

export interface SunlightState {
  /** Null when the elements cannot be propagated to this instant. */
  sunlit: boolean | null;
  /** When the illumination next flips, or null if no flip was found in the window. */
  changesAt: Date | null;
}

const COARSE_STEP_MS = 20_000;
const REFINE_TO_MS = 5_000;

/**
 * Whether the station is in sunlight now, and when that next changes.
 *
 * This is what makes the live feed honest rather than a black rectangle. The
 * external cameras have no illumination of their own, so for roughly a third
 * of every 93-minute orbit they show nothing at all. Knowing the orbit, the
 * app can say so — and say how long until orbital sunrise — instead of leaving
 * someone to conclude the stream is broken.
 *
 * A default window of two hours comfortably exceeds one orbit, so under normal
 * conditions a transition is always found.
 */
export function sunlightState(
  satrec: satellite.SatRec,
  from: Date,
  windowMinutes = 120
): SunlightState {
  const start = satelliteSunlit(satrec, from);
  if (start === null) return { sunlit: null, changesAt: null };

  const endMs = from.getTime() + windowMinutes * 60_000;
  let previousMs = from.getTime();

  for (let ms = previousMs + COARSE_STEP_MS; ms <= endMs; ms += COARSE_STEP_MS) {
    const state = satelliteSunlit(satrec, new Date(ms));
    // A propagation failure mid-window means the elements have run out; report
    // the current state rather than guessing at a transition.
    if (state === null) return { sunlit: start, changesAt: null };

    if (state !== start) {
      // Bisect the bracketing interval down to a few seconds. The terminator
      // crossing takes only moments, so a coarse step would otherwise put the
      // countdown out by up to twenty seconds.
      let lo = previousMs;
      let hi = ms;
      while (hi - lo > REFINE_TO_MS) {
        const mid = Math.floor((lo + hi) / 2);
        const midState = satelliteSunlit(satrec, new Date(mid));
        if (midState === null) break;
        if (midState === start) lo = mid;
        else hi = mid;
      }
      return { sunlit: start, changesAt: new Date(hi) };
    }
    previousMs = ms;
  }

  return { sunlit: start, changesAt: null };
}

/** Convenience wrapper for callers holding a TLE rather than a parsed satrec. */
export function issSunlight(tle: TleRecord, at: Date): SunlightState {
  const satrec = parseSatrec(tle);
  if (!satrec) return { sunlit: null, changesAt: null };
  return sunlightState(satrec, at);
}

/**
 * "in 4 min", "in 1 h 12 min", or "now" — for a countdown that sits next to a
 * video, where seconds-level precision would just be noise.
 */
export function formatCountdown(fromMs: number, toMs: number): string {
  const seconds = Math.round((toMs - fromMs) / 1000);
  if (seconds <= 30) return 'any moment';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `in ${hours} h ${minutes % 60} min`;
}
