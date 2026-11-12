/**
 * Non-operational short-range cooperative ranging benchmark.
 *
 * Deliberate assumptions: ten known stationary range transponders in a local
 * frame, synchronous calibrated range measurements, a coarse initial region,
 * no clock ambiguity or relative attitude errors, and no orbital dynamics.
 * Precision achieved under these synthetic assumptions IS NOT flight accuracy
 * and is not comparable to GNSS carrier-phase millimetre orbit determination.
 *
 * Never connect this research code to spacecraft actuators or treat its outputs
 * as operational collision alerts.
 */
export interface Vec3M { x: number; y: number; z: number }
export interface RangingAnchor { id: string; positionM: Vec3M }
export interface RangeReading { anchorId: string; distanceM: number; sigmaM: number; ageSeconds: number }
export type PrecisionMode = 'ideal' | 'noisy' | 'outlier' | 'biased' | 'unobservable';
export interface PrecisionSolution {
  status: 'ADVISORY' | 'HOLD';
  reason: string;
  estimateM: Vec3M | null;
  uncertainty95M: number | null;
  normalizedResidualRms: number | null;
  accepted: number;
  rejected: number;
}
export interface PrecisionMetrics {
  mode: PrecisionMode;
  trials: number;
  accepted: number;
  rms3dMm: number | null;
  p95ErrorMm: number | null;
  envelopeCoveragePercent: number | null;
  meanUncertainty95Mm: number | null;
  rejectedMeasurements: number;
}
export const PRECISION_MODES: Array<{ id: PrecisionMode; name: string; note: string }> = [
  { id: 'ideal', name: 'Idealised precision sensors', note: '0.35 mm independent ranging noise; perfect calibration and geometry' },
  { id: 'noisy', name: 'Degraded sensors', note: '20 mm independent ranging noise' },
  { id: 'outlier', name: 'One gross outlier', note: '0.35 mm noise, one range has +12 mm false measurement' },
  { id: 'biased', name: 'Unmodelled clock/range bias', note: '0.35 mm noise with +3 mm common range bias' },
  { id: 'unobservable', name: 'Unobservable geometry', note: 'All transponders lie on one line' },
];
export const PRECISION_GOAL_RMS_MM = 1;
export const PRECISION_STRETCH_RMS_MM = 0.1;
export const PRECISION_ANCHORS: RangingAnchor[] = [
  { id: 'A', positionM: { x: -5, y: 0, z: 0 } },
  { id: 'B', positionM: { x: 5, y: 0, z: 0 } },
  { id: 'C', positionM: { x: 0, y: -5, z: 0 } },
  { id: 'D', positionM: { x: 0, y: 5, z: 0 } },
  { id: 'E', positionM: { x: 0, y: 0, z: -5 } },
  { id: 'F', positionM: { x: 0, y: 0, z: 5 } },
  // Diagonal viewpoints provide residual redundancy after any one receiver
  // is rejected. Axis-only geometry can falsely explain a bad +X reading
  // as a genuine -X position change when its opposite range is removed.
  { id: 'G', positionM: { x: 4, y: 4, z: 4 } },
  { id: 'H', positionM: { x: -4, y: 4, z: -4 } },
  { id: 'I', positionM: { x: 4, y: -4, z: -4 } },
  { id: 'J', positionM: { x: -4, y: -4, z: 4 } },
];

function subtract(a: Vec3M, b: Vec3M): Vec3M {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function norm(v: Vec3M): number { return Math.hypot(v.x, v.y, v.z); }
type Matrix3 = number[][];

/** Pivoted elimination: fail closed for singular or badly conditioned geometry. */
function solve3(matrix: Matrix3, rhs: number[]): number[] | null {
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  const scale = Math.max(...matrix.flat().map(Math.abs));
  if (!(scale > 0)) return null;
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < scale * 1e-9) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const div = a[col][col];
    for (let k = col; k <= 3; k++) a[col][k] /= div;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let k = col; k <= 3; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map(row => row[3]);
}

function matrixAt(
  readings: RangeReading[],
  anchors: Map<string, Vec3M>,
  at: Vec3M,
): { a: Matrix3; b: number[]; errors: number[] } | null {
  const a: Matrix3 = [[0,0,0],[0,0,0],[0,0,0]];
  const b = [0,0,0];
  const errors: number[] = [];
  for (const reading of readings) {
    const anchor = anchors.get(reading.anchorId)!;
    const diff = subtract(at, anchor);
    const r = norm(diff);
    if (!(r > 1e-8)) return null;
    const j = [diff.x/r, diff.y/r, diff.z/r];
    const residual = reading.distanceM - r;
    const weight = 1 / (reading.sigmaM * reading.sigmaM);
    errors.push(residual / reading.sigmaM);
    for (let i = 0; i < 3; i++) {
      b[i] += weight * j[i] * residual;
      for (let k = 0; k < 3; k++) a[i][k] += weight * j[i] * j[k];
    }
  }
  return { a, b, errors };
}

function fit(readings: RangeReading[], anchors: Map<string, Vec3M>, start: Vec3M) {
  let estimate = { ...start };
  for (let i = 0; i < 18; i++) {
    const normal = matrixAt(readings, anchors, estimate);
    if (!normal) return null;
    const delta = solve3(normal.a, normal.b);
    if (!delta || delta.some(v => !Number.isFinite(v))) return null;
    const stepSize = Math.hypot(...delta);
    const ratio = stepSize > 0.8 ? 0.8 / stepSize : 1;
    estimate = {
      x: estimate.x + delta[0] * ratio,
      y: estimate.y + delta[1] * ratio,
      z: estimate.z + delta[2] * ratio,
    };
    if (stepSize < 1e-10) break;
  }
  const normal = matrixAt(readings, anchors, estimate);
  if (!normal) return null;
  const invColumns = [0,1,2].map(i => solve3(normal.a, [0,1,2].map(j => Number(i === j))));
  if (invColumns.some(c => c === null)) return null;
  const inverse = invColumns as number[][];
  const traceCovariance = inverse[0][0] + inverse[1][1] + inverse[2][2];
  if (!(traceCovariance > 0) || !Number.isFinite(traceCovariance)) return null;
  const normalizedResidualRms = Math.sqrt(
    normal.errors.reduce((sum, v) => sum + v*v, 0) / Math.max(1, readings.length - 3));
  return {
    estimate, normalizedResidualRms,
    residuals: normal.errors,
    // Conservative spherical bound under independent Gaussian range-noise assumptions.
    uncertainty95M: Math.sqrt(7.814727903 * traceCovariance),
  };
}

/** Independent truth is not passed to this solver. */
export function solveCooperativeRanges(
  anchors: RangingAnchor[],
  readings: RangeReading[],
  startingGuess: Vec3M = { x: 0, y: 0, z: 0 },
): PrecisionSolution {
  const validAnchors = new Map(anchors.map(a => [a.id, a.positionM]));
  let current = readings.filter(o =>
    validAnchors.has(o.anchorId) && Number.isFinite(o.distanceM) && o.distanceM > 0 &&
    Number.isFinite(o.sigmaM) && o.sigmaM > 0 && o.sigmaM <= 1 &&
    Number.isFinite(o.ageSeconds) && o.ageSeconds >= 0 && o.ageSeconds < 2,
  );
  const hold = (reason: string): PrecisionSolution => ({
    status: 'HOLD', reason, estimateM: null, uncertainty95M: null, normalizedResidualRms: null,
    accepted: current.length, rejected: readings.length-current.length,
  });
  if (current.length < 4) return hold('Fewer than four valid fresh range observations.');
  if (![startingGuess.x, startingGuess.y, startingGuess.z].every(Number.isFinite)) {
    return hold('Invalid initial reference frame position.');
  }
  let result = fit(current, validAnchors, startingGuess);
  if (!result) return hold('Unobservable or ill-conditioned 3-D ranging geometry.');
  const initialWorst = Math.max(...result.residuals.map(v => Math.abs(v)));
  // Never trust the largest post-fit residual alone: ordinary least squares can
  // shift a gross error onto innocent measurements. Test every possible single
  // exclusion, and require a well-fitting subset PLUS a strongly inconsistent
  // excluded measurement. Otherwise fail closed rather than publish a fix.
  if ((initialWorst > 4 || result.normalizedResidualRms > 3) && current.length >= 6) {
    let best: { index: number; subset: ReturnType<typeof fit>; score: number } | null = null;
    for (let index = 0; index < current.length; index++) {
      const candidateReadings = current.filter((_, i) => i !== index);
      const subset = fit(candidateReadings, validAnchors, result.estimate);
      if (!subset) continue;
      const keptWorst = Math.max(...subset.residuals.map(v => Math.abs(v)));
      const excluded = current[index];
      const anchor = validAnchors.get(excluded.anchorId)!;
      const excludedError = Math.abs(excluded.distanceM -
        norm(subtract(subset.estimate, anchor))) / excluded.sigmaM;
      if (keptWorst >= 4 || subset.normalizedResidualRms >= 3 || excludedError <= 6) continue;
      const score = subset.normalizedResidualRms;
      if (!best || score < best.score) best = { index, subset, score };
    }
    if (best) {
      current = current.filter((_, i) => i !== best!.index);
      result = best.subset!;
    } else {
      return hold('Gross mismatch cannot be safely attributed to one range; navigation HOLD.');
    }
  }
  const maxResidual = Math.max(...result.residuals.map(v => Math.abs(v)));
  if (maxResidual > 4 || result.normalizedResidualRms > 3) {
    return hold('Inconsistent ranges: sensor bias, extra outliers, or geometry error suspected.');
  }
  return {
    status: 'ADVISORY',
    reason: 'Synthetic coherent range solution; not a validated physical precision claim.',
    estimateM: result.estimate,
    uncertainty95M: result.uncertainty95M,
    normalizedResidualRms: result.normalizedResidualRms,
    accepted: current.length, rejected: readings.length-current.length,
  };
}

/** Deterministic pseudo-random sampler; no runtime RNG, network or real data. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}
function normalSample(random: () => number): number {
  return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}
export function makePrecisionTrial(mode: PrecisionMode, index: number, seed = 18052027) {
  const random = makeRandom((seed ^ Math.imul(index + 1, 2654435761)) >>> 0);
  const truthM: Vec3M = {
    x: (random() - 0.5) * 0.8, y: (random() - 0.5) * 0.8, z: (random() - 0.5) * 0.8,
  };
  const anchors = mode === 'unobservable'
    ? PRECISION_ANCHORS.map((a, i) => ({ id: a.id, positionM: { x: -5+i*2, y: 0, z: 0 } }))
    : PRECISION_ANCHORS;
  const sigmaM = mode === 'noisy' ? 0.02 : 0.00035;
  const readings = anchors.map((anchor, i): RangeReading => ({
    anchorId: anchor.id,
    distanceM: norm(subtract(truthM, anchor.positionM)) +
      normalSample(random) * sigmaM +
      (mode === 'outlier' && i === 1 ? 0.012 : 0) +
      (mode === 'biased' ? 0.003 : 0),
    sigmaM,
    ageSeconds: 0.2,
  }));
  return { anchors, readings, truthM };
}

/** Benchmark covers all trials, including rejected estimates (availability). */
export function runPrecisionBenchmark(mode: PrecisionMode, trials = 256, seed = 18052027): PrecisionMetrics {
  if (!Number.isInteger(trials) || trials < 1 || trials > 4096) {
    throw new RangeError('trials must be an integer from 1 to 4096');
  }
  let accepted = 0, sumSq = 0, totalCoverage = 0, sumUncertainty = 0, rejectedMeasurements = 0;
  const errors: number[] = [];
  for (let i = 0; i < trials; i++) {
    const test = makePrecisionTrial(mode, i, seed);
    const solved = solveCooperativeRanges(test.anchors, test.readings);
    rejectedMeasurements += solved.rejected;
    if (!solved.estimateM || solved.uncertainty95M === null || solved.status !== 'ADVISORY') continue;
    accepted += 1;
    const errorM = norm(subtract(test.truthM, solved.estimateM));
    errors.push(errorM);
    sumSq += errorM*errorM;
    totalCoverage += Number(errorM <= solved.uncertainty95M);
    sumUncertainty += solved.uncertainty95M;
  }
  errors.sort((a,b)=>a-b);
  return {
    mode, trials, accepted,
    rms3dMm: accepted ? 1000*Math.sqrt(sumSq/accepted) : null,
    p95ErrorMm: accepted ? 1000*errors[Math.max(0, Math.ceil(0.95*accepted)-1)] : null,
    envelopeCoveragePercent: accepted ? 100*totalCoverage/accepted : null,
    meanUncertainty95Mm: accepted ? 1000*sumUncertainty/accepted : null,
    rejectedMeasurements,
  };
}
