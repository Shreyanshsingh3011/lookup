import type { TleRecord } from "./celestrak.js";

/**
 * Finding Starlink trains — the strings of lights people photograph and then
 * search the internet about at midnight.
 *
 * A batch launched together shares one orbital plane and is deployed strung
 * out along it, so for a few days the satellites cross the sky in a line. Then
 * they raise orbits and drift apart in both plane and phase, and the train
 * stops being a train. Everything here is about spotting that window, from
 * nothing but the published elements.
 *
 * Two honest limits, surfaced to the caller rather than buried:
 *   - Trains disperse within days to a couple of weeks. A cluster detected
 *     now may already be looser than it looks.
 *   - Celestrak's elements for a brand-new launch lag by a day or two, which
 *     is exactly the period when a train is tightest and brightest. A launch
 *     from last night will not be here yet.
 */

/** Orbital elements read straight out of a TLE's second line. */
export interface TrainElements {
  inclinationDeg: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  eccentricity: number;
}

export function elementsFromLine2(line2: string): TrainElements {
  // Fixed-column format; the fields never move.
  return {
    inclinationDeg: Number(line2.slice(8, 16)),
    raanDeg: Number(line2.slice(17, 25)),
    eccentricity: Number(`0.${line2.slice(26, 33).trim()}`),
    argPerigeeDeg: Number(line2.slice(34, 42)),
    meanAnomalyDeg: Number(line2.slice(43, 51)),
    meanMotionRevPerDay: Number(line2.slice(52, 63)),
  };
}

const EARTH_RADIUS_KM = 6378.137;
const MU_EARTH = 398_600.4418;

/** Mean altitude implied by the mean motion, for a near-circular orbit. */
export function altitudeKmFromMeanMotion(revPerDay: number): number {
  const n = (revPerDay * 2 * Math.PI) / 86_400;
  return Math.cbrt(MU_EARTH / (n * n)) - EARTH_RADIUS_KM;
}

/** Smallest absolute difference between two angles in degrees. */
export function angularDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export interface TrainCriteria {
  /** Satellites in the same plane agree on RAAN to about this much. */
  raanToleranceDeg: number;
  inclinationToleranceDeg: number;
  /** Same insertion burn: mean motions agree closely. */
  meanMotionTolerance: number;
  /** Largest along-track gap, in degrees of mean anomaly, still counted as one train. */
  maxPhaseGapDeg: number;
  /** Fewer than this and it is a few satellites near each other, not a train. */
  minMembers: number;
  /**
   * Trains are worth reporting while the batch is still low. Once raised to
   * the operational shell they are dimmer, far more spread out, and
   * indistinguishable from the thousands of other Starlinks overhead.
   */
  maxAltitudeKm: number;
}

export const DEFAULT_TRAIN_CRITERIA: TrainCriteria = {
  raanToleranceDeg: 1.2,
  inclinationToleranceDeg: 0.35,
  meanMotionTolerance: 0.12,
  maxPhaseGapDeg: 12,
  minMembers: 8,
  maxAltitudeKm: 450,
};

export interface StarlinkTrain {
  /** Members in along-track order, leader first. */
  members: TleRecord[];
  count: number;
  meanAltitudeKm: number;
  inclinationDeg: number;
  raanDeg: number;
  /** Angular length of the string along its orbit, in degrees. */
  spreadDeg: number;
  /**
   * Rough time for the whole string to pass a fixed point, from its angular
   * length and orbital period. This is what "the lights kept coming for two
   * minutes" actually measures.
   */
  passDurationSeconds: number;
}

interface Candidate {
  tle: TleRecord;
  elements: TrainElements;
  altitudeKm: number;
}

/**
 * Groups satellites into orbital planes.
 *
 * Simple agglomeration against a group's first member rather than a proper
 * clustering algorithm: launches are well separated in RAAN, so the planes are
 * not close calls, and this stays obvious to read.
 */
function groupByPlane(candidates: Candidate[], criteria: TrainCriteria): Candidate[][] {
  const planes: Candidate[][] = [];

  for (const candidate of candidates) {
    const plane = planes.find((members) => {
      const first = members[0].elements;
      return (
        angularDelta(first.raanDeg, candidate.elements.raanDeg) <= criteria.raanToleranceDeg &&
        angularDelta(first.inclinationDeg, candidate.elements.inclinationDeg) <=
          criteria.inclinationToleranceDeg &&
        Math.abs(first.meanMotionRevPerDay - candidate.elements.meanMotionRevPerDay) <=
          criteria.meanMotionTolerance
      );
    });
    if (plane) plane.push(candidate);
    else planes.push([candidate]);
  }

  return planes;
}

/**
 * Splits one plane into runs of satellites that are actually adjacent along
 * the orbit.
 *
 * Sharing a plane is not enough — an older batch can have spread all the way
 * round it. What makes a train is a run with no large gap, so the members are
 * sorted by mean anomaly and cut wherever the gap exceeds the threshold. The
 * wrap-around gap is included, since mean anomaly is a circle and a string
 * straddling 0/360 is still one string.
 */
function runsAlongOrbit(plane: Candidate[], criteria: TrainCriteria): Candidate[][] {
  if (plane.length < 2) return [plane];

  const sorted = [...plane].sort((a, b) => a.elements.meanAnomalyDeg - b.elements.meanAnomalyDeg);
  const gapAfter = sorted.map((current, i) => {
    const next = sorted[(i + 1) % sorted.length];
    const raw = next.elements.meanAnomalyDeg - current.elements.meanAnomalyDeg;
    return ((raw % 360) + 360) % 360;
  });

  // Start each run after the largest gap, so a string straddling 0/360 is not
  // arbitrarily cut in half by where the numbering happens to begin.
  let startIndex = 0;
  for (let i = 1; i < gapAfter.length; i++) {
    if (gapAfter[i] > gapAfter[startIndex]) startIndex = i;
  }

  const runs: Candidate[][] = [];
  let current: Candidate[] = [];
  for (let step = 0; step < sorted.length; step++) {
    const i = (startIndex + 1 + step) % sorted.length;
    current.push(sorted[i]);
    const gap = gapAfter[i];
    const isLast = step === sorted.length - 1;
    if (gap > criteria.maxPhaseGapDeg || isLast) {
      runs.push(current);
      current = [];
    }
  }
  return runs;
}

/** Angular length of a run, following it from its first member to its last. */
function spreadDeg(run: Candidate[]): number {
  let total = 0;
  for (let i = 1; i < run.length; i++) {
    const raw = run[i].elements.meanAnomalyDeg - run[i - 1].elements.meanAnomalyDeg;
    total += ((raw % 360) + 360) % 360;
  }
  return total;
}

/**
 * Every train currently detectable in a set of elements, longest first.
 *
 * `names` filtering is left to the caller: this works on whatever it is given,
 * which keeps it testable with synthetic elements and usable for any
 * constellation deployed the same way.
 */
export function findTrains(
  tles: TleRecord[],
  criteria: TrainCriteria = DEFAULT_TRAIN_CRITERIA
): StarlinkTrain[] {
  const candidates: Candidate[] = [];
  for (const tle of tles) {
    const elements = elementsFromLine2(tle.line2);
    if (!Number.isFinite(elements.meanMotionRevPerDay) || elements.meanMotionRevPerDay <= 0) continue;
    const altitudeKm = altitudeKmFromMeanMotion(elements.meanMotionRevPerDay);
    if (altitudeKm > criteria.maxAltitudeKm) continue;
    candidates.push({ tle, elements, altitudeKm });
  }

  const trains: StarlinkTrain[] = [];
  for (const plane of groupByPlane(candidates, criteria)) {
    if (plane.length < criteria.minMembers) continue;

    for (const run of runsAlongOrbit(plane, criteria)) {
      if (run.length < criteria.minMembers) continue;

      const meanMotion =
        run.reduce((sum, c) => sum + c.elements.meanMotionRevPerDay, 0) / run.length;
      const periodSeconds = 86_400 / meanMotion;
      const spread = spreadDeg(run);

      trains.push({
        members: run.map((c) => c.tle),
        count: run.length,
        meanAltitudeKm: run.reduce((sum, c) => sum + c.altitudeKm, 0) / run.length,
        inclinationDeg: run[0].elements.inclinationDeg,
        raanDeg: run[0].elements.raanDeg,
        spreadDeg: spread,
        passDurationSeconds: (spread / 360) * periodSeconds,
      });
    }
  }

  return trains.sort((a, b) => b.count - a.count);
}
