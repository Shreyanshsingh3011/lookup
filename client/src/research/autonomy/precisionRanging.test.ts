import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  makePrecisionTrial, PRECISION_ANCHORS, PRECISION_GOAL_RMS_MM,
  runPrecisionBenchmark, solveCooperativeRanges,
} from './precisionRanging';

test('precision trial is deterministic and keeps truth separate from solver inputs', () => {
  const a = makePrecisionTrial('ideal', 3);
  assert.deepEqual(a, makePrecisionTrial('ideal', 3));
  const result = solveCooperativeRanges(a.anchors, a.readings);
  assert.equal(result.status, 'ADVISORY');
  assert.ok(result.estimateM);
  assert.ok(result.uncertainty95M !== null && result.uncertainty95M > 0);
  const errorMm = Math.hypot(
    result.estimateM.x - a.truthM.x,
    result.estimateM.y - a.truthM.y,
    result.estimateM.z - a.truthM.z,
  ) * 1000;
  assert.ok(errorMm < 3);
});

test('ideal synthetic ranging is below 1 mm RMS under stated assumptions', () => {
  const metrics = runPrecisionBenchmark('ideal', 256);
  assert.equal(metrics.trials, 256);
  assert.equal(metrics.accepted, 256);
  assert.ok(metrics.rms3dMm !== null && metrics.rms3dMm < PRECISION_GOAL_RMS_MM);
  assert.ok(metrics.p95ErrorMm !== null && metrics.p95ErrorMm < 2);
  assert.ok(metrics.envelopeCoveragePercent !== null && metrics.envelopeCoveragePercent >= 90);
});

test('lower-quality sensors visibly lose precision', () => {
  const ideal = runPrecisionBenchmark('ideal', 128);
  const degraded = runPrecisionBenchmark('noisy', 128);
  assert.ok(ideal.rms3dMm !== null && degraded.rms3dMm !== null);
  assert.ok(degraded.rms3dMm > 10 * ideal.rms3dMm);
});

test('redundant 3-D geometry isolates a gross outlier without a false fix', () => {
  const metrics = runPrecisionBenchmark('outlier', 256);
  assert.equal(metrics.accepted, metrics.trials);
  assert.equal(metrics.rejectedMeasurements, metrics.trials);
  assert.ok(metrics.rms3dMm !== null && metrics.rms3dMm < 1,
    'one 12 mm bad reading must not become an apparently accurate position fix');
  assert.ok(metrics.p95ErrorMm !== null && metrics.p95ErrorMm < 1);
  assert.ok(metrics.envelopeCoveragePercent !== null && metrics.envelopeCoveragePercent >= 90);
});

test('unobservable geometry is held rather than returning false certainty', () => {
  const metrics = runPrecisionBenchmark('unobservable', 32);
  assert.equal(metrics.accepted, 0);
  assert.equal(metrics.rms3dMm, null);
});

test('missing, stale and invalid measurements fail closed', () => {
  const trial = makePrecisionTrial('ideal', 8);
  const stale = trial.readings.map(r => ({ ...r, ageSeconds: 10 }));
  const bad = solveCooperativeRanges(trial.anchors, stale);
  assert.equal(bad.status, 'HOLD');
  assert.equal(bad.accepted, 0);
  const tooFew = solveCooperativeRanges(PRECISION_ANCHORS, trial.readings.slice(0, 3));
  assert.equal(tooFew.status, 'HOLD');
});

test('bias benchmark is reported separately rather than mixed with ideal scenario', () => {
  const biased = runPrecisionBenchmark('biased', 128);
  assert.equal(biased.mode, 'biased');
  assert.equal(biased.trials, 128);
  assert.ok(biased.accepted <= 128);
});

test('input bounds and non-finite initial estimate are rejected', () => {
  assert.throws(() => runPrecisionBenchmark('ideal', -1), RangeError);
  assert.throws(() => runPrecisionBenchmark('ideal', 4097), RangeError);
  const a = makePrecisionTrial('ideal', 1);
  const invalid = solveCooperativeRanges(a.anchors, a.readings, {x:NaN,y:0,z:0});
  assert.equal(invalid.status, 'HOLD');
});

test('sub-mm ideal and one-outlier results generalise across multiple independent deterministic seeds', () => {
  for (const seed of [7, 41, 2027, 0xc0ffee]) {
    for (const mode of ['ideal', 'outlier'] as const) {
      const result = runPrecisionBenchmark(mode, 256, seed);
      assert.equal(result.accepted, 256, mode + ' seed ' + seed + ' lost valid solutions');
      assert.ok(result.rms3dMm !== null && result.rms3dMm < 1,
        mode + ' seed ' + seed + ' missed the synthetic 1 mm RMS threshold');
      if (mode === 'outlier') assert.equal(result.rejectedMeasurements, 256);
    }
  }
});
