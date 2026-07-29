
import { observerToGeodetic, parseSatrec, skySampleAt } from './sky';
import type { Observer, Pass, TleRecord } from '../types';

export interface TrackPoint {
  time: Date;
  azimuthDeg: number;
  elevationDeg: number;
  illuminated: boolean;
  /** Inside the reported visible window (sunlit and the observer in darkness). */
  visible: boolean;
}

/** Sampling resolution of the drawn arc. */
const STEP_SECONDS = 6;
/**
 * How far either side of the visible window to look for the horizon crossings.
 * A low-Earth-orbit pass is above the horizon for at most ~12 minutes, so this
 * comfortably brackets the whole arc.
 */
const SEARCH_MARGIN_MINUTES = 15;

/**
 * Full horizon-to-horizon arc for a pass, with each sample flagged for
 * visibility.
 *
 * The server reports only the visible segment. Drawing the entire above-horizon
 * arc and highlighting the visible part is more useful: it shows where to start
 * watching, and where the satellite slides into Earth's shadow mid-pass.
 */
export function computePassTrack(
  tle: TleRecord,
  observer: Observer,
  pass: Pass
): TrackPoint[] {
  const satrec = parseSatrec(tle);
  if (!satrec) return [];

  const observerGd = observerToGeodetic(observer);
  const visibleStart = new Date(pass.start.time).getTime();
  const visibleEnd = new Date(pass.end.time).getTime();

  const from = visibleStart - SEARCH_MARGIN_MINUTES * 60_000;
  const to = visibleEnd + SEARCH_MARGIN_MINUTES * 60_000;

  const points: TrackPoint[] = [];
  for (let t = from; t <= to; t += STEP_SECONDS * 1000) {
    const date = new Date(t);
    const sample = skySampleAt(satrec, observerGd, date);
    if (!sample || sample.elevationDeg < 0) continue;

    points.push({
      time: date,
      azimuthDeg: sample.azimuthDeg,
      elevationDeg: sample.elevationDeg,
      illuminated: sample.illuminated,
      visible: t >= visibleStart && t <= visibleEnd && sample.illuminated,
    });
  }

  return points;
}

/** Contiguous runs of samples sharing a visibility state, for drawing. */
export function splitByVisibility(points: TrackPoint[]): Array<{ visible: boolean; points: TrackPoint[] }> {
  const runs: Array<{ visible: boolean; points: TrackPoint[] }> = [];
  for (const point of points) {
    const current = runs[runs.length - 1];
    if (current && current.visible === point.visible) {
      current.points.push(point);
    } else {
      // Repeat the boundary sample so consecutive runs join without a gap.
      const seed = current ? [current.points[current.points.length - 1], point] : [point];
      runs.push({ visible: point.visible, points: seed });
    }
  }
  return runs;
}

