import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateOpticalPosition, makeScenario, type Scenario } from './opticalNavigation';

test('nominal synthetic bearings produce an accurate advisory position fix', () => {
  const scenario = makeScenario('nominal');
  const result = estimateOpticalPosition(scenario);
  assert.equal(result.status, 'ADVISORY');
  assert.equal(result.usedObservations, 4);
  assert.ok(result.positionKm);
  assert.ok(Math.hypot(result.positionKm.x - scenario.groundTruthKm.x, result.positionKm.y - scenario.groundTruthKm.y) < 0.4);
  assert.ok((result.uncertainty95Km ?? 0) > 0);
});

test('noisy observations increase estimated uncertainty', () => {
  const nominal = estimateOpticalPosition(makeScenario('nominal'));
  const noisy = estimateOpticalPosition(makeScenario('noisy'));
  assert.ok((noisy.uncertainty95Km ?? 0) > (nominal.uncertainty95Km ?? 0));
});

test('occlusion and stale bearings block the position fix', () => {
  for (const id of ['occluded', 'stale'] as const) {
    const result = estimateOpticalPosition(makeScenario(id));
    assert.equal(result.status, 'HOLD');
    assert.equal(result.positionKm, null);
    assert.equal(result.usedObservations, 1);
  }
});

test('collinear bearings fail the observability gate', () => {
  const result = estimateOpticalPosition(makeScenario('degenerate'));
  assert.equal(result.status, 'HOLD');
  assert.equal(result.positionKm, null);
  assert.match(result.reason, /geometry/i);
});

test('false target association triggers the integrity hold', () => {
  const result = estimateOpticalPosition(makeScenario('inconsistent'));
  assert.equal(result.status, 'HOLD');
  assert.match(result.reason, /inconsistent/i);
});

test('invalid timestamps and missing references are rejected, never silently used', () => {
  const s: Scenario = makeScenario('nominal');
  s.observations[0].ageSeconds = -1;
  s.observations[1].landmarkId = 'UNKNOWN';
  const result = estimateOpticalPosition(s);
  assert.equal(result.status, 'HOLD');
  assert.equal(result.usedObservations, 2);
});

test('scenario generation is fully deterministic and does not mutate the catalogue', () => {
  const first = makeScenario('nominal');
  const original = JSON.stringify(first);
  first.landmarks[0].positionKm.x = 1000;
  assert.equal(JSON.stringify(makeScenario('nominal')), original);
});
