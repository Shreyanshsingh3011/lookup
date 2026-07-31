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

/**
 * Faintest a pass can be and still be worth walking outside for.
 *
 * Roughly the naked-eye limit under a suburban sky. Trains are listed without
 * a brightness filter — the magnitude model is calibrated for a single
 * spacecraft, not a formation — so the caller has to be told when the geometry
 * gives a pass nobody will actually see.
 */
export const NAKED_EYE_MAGNITUDE_LIMIT = 4.5;

/**
 * Comfortably visible without dark adaptation or a good site. Set at third
 * magnitude rather than something stricter because that is genuinely where
 * the eye is: a magnitude 3 satellite is an easy naked-eye object, and
 * treating it as doubtful would bury the trains most worth going out for
 * beneath larger, fainter ones.
 */
const EASY_MAGNITUDE = 3.5;

export function passVisibility(magnitude: number | null): 'good' | 'marginal' | 'too-faint' | 'unknown' {
  if (magnitude === null) return 'unknown';
  if (magnitude <= EASY_MAGNITUDE) return 'good';
  if (magnitude <= NAKED_EYE_MAGNITUDE_LIMIT) return 'marginal';
  return 'too-faint';
}

export const VISIBILITY_NOTES: Record<ReturnType<typeof passVisibility>, string | null> = {
  good: null,
  marginal: 'Faint — you will want a properly dark sky and dark-adapted eyes.',
  'too-faint': 'Too faint for the naked eye on this pass; the geometry works but the lighting does not.',
  unknown: null,
};

/**
 * Trains worth showing first.
 *
 * A busy launch cadence can leave well over a dozen batches in transit at
 * once, and a long list of things you cannot see is not useful. Trains with an
 * actually visible pass come first, then bright ones, then the rest by size.
 */
export function rankTrains(trains: StarlinkTrain[]): StarlinkTrain[] {
  const score = (train: StarlinkTrain): number => {
    const best = train.nextPasses[0];
    if (!best) return 0;
    if (passVisibility(best.magnitude) === 'too-faint') return 1;
    if (passVisibility(best.magnitude) === 'marginal') return 2;
    return 3;
  };
  return [...trains].sort((a, b) => score(b) - score(a) || b.count - a.count);
}
