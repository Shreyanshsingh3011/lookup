import type { EpochSpan, Pass, TleSource } from '../types';

/**
 * A batch of Starlinks still flying in formation after launch, and when it
 * next crosses the observer's sky.
 *
 * Detection happens on the server, which is the only place the whole Starlink
 * catalogue exists. This is just the shape that comes back.
 */
export interface StarlinkTrain {
  count: number;
  leadName: string;
  meanAltitudeKm: number;
  inclinationDeg: number;
  /** Angular length of the string along its orbit. */
  spreadDeg: number;
  /** Roughly how long the whole string takes to cross a fixed point. */
  passDurationSeconds: number;
  satnums: string[];
  nextPasses: Pass[];
}

export interface StarlinkTrainsResponse {
  days: number;
  source: TleSource;
  epoch: EpochSpan | null;
  catalogueSize: number;
  trainCount: number;
  trains: StarlinkTrain[];
}

/**
 * How long the lights keep coming, in words.
 *
 * This is the number people actually remember about a train sighting — not
 * how many satellites there were, but that it went on and on.
 */
export function describeTrainDuration(seconds: number): string {
  if (seconds < 90) return `about ${Math.round(seconds)} seconds of lights`;
  const minutes = seconds / 60;
  if (minutes < 10) return `about ${minutes.toFixed(minutes < 3 ? 1 : 0)} minutes of lights`;
  return `over ${Math.floor(minutes)} minutes of lights`;
}

/**
 * Whether a train is still tight enough to look like one.
 *
 * A batch spreads along its orbit continuously, so there is no moment it stops
 * being a train — but past a certain length the satellites arrive too far
 * apart to read as a single string, and calling that a train sets people up
 * for disappointment.
 */
export function trainTightness(spreadDeg: number): 'tight' | 'stretched' | 'dispersing' {
  if (spreadDeg <= 25) return 'tight';
  if (spreadDeg <= 70) return 'stretched';
  return 'dispersing';
}

export const TIGHTNESS_NOTES: Record<ReturnType<typeof trainTightness>, string> = {
  tight: 'Still closely spaced — this is the classic string of pearls.',
  stretched: 'Spreading out, so expect gaps between the lights rather than a solid line.',
  dispersing: 'Well spread along its orbit; you will see them arrive over several minutes.',
};
