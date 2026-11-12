import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  initialBelief, propagateBelief, simulatePrediction, stateAt, syntheticTruth,
  updateWithPosition, PRESENT_SECONDS,
} from './predictiveNavigation';

test('3-D motion forecasts are deterministic and do not mutate the initial estimate', () => {
  const options = { horizonSeconds: 300, followUpObservation: true, unexpectedManeuver: false };
  const first = simulatePrediction(options);
  const snapshot = JSON.stringify(first);
  assert.deepEqual(simulatePrediction(options), first);
  assert.equal(JSON.stringify(first), snapshot);
  assert.equal(first.now.seconds, PRESENT_SECONDS);
  assert.equal(first.future.seconds, PRESENT_SECONDS + 300);
  for (const axis of ['x', 'y', 'z'] as const) {
    assert.ok(Number.isFinite(first.future.positionKm[axis]));
    assert.ok(Number.isFinite(first.future.velocityKmPerS[axis]));
  }
});

test('forecasts grow less certain the further ahead we predict', () => {
  const a = simulatePrediction({ horizonSeconds: 60, followUpObservation: true, unexpectedManeuver: false });
  const b = simulatePrediction({ horizonSeconds: 600, followUpObservation: true, unexpectedManeuver: false });
  assert.ok(b.future.uncertainty95Km > a.future.uncertainty95Km);
  assert.ok(a.future.uncertainty95Km > 0);
});

test('a valid follow-up multi-view observation improves current position and uncertainty', () => {
  const without = simulatePrediction({ horizonSeconds: 120, followUpObservation: false, unexpectedManeuver: false });
  const withObservation = simulatePrediction({ horizonSeconds: 120, followUpObservation: true, unexpectedManeuver: false });
  assert.equal(withObservation.updateAccepted, true);
  assert.ok(withObservation.now.uncertainty95Km < without.now.uncertainty95Km);
  assert.ok(withObservation.errorNowKm < without.errorNowKm);
});

test('unmodeled maneuver can invalidate an apparently confident forecast', () => {
  const nominal = simulatePrediction({ horizonSeconds: 600, followUpObservation: true, unexpectedManeuver: false });
  const maneuver = simulatePrediction({ horizonSeconds: 600, followUpObservation: true, unexpectedManeuver: true });
  assert.equal(maneuver.modelMismatch, true);
  assert.ok(maneuver.errorFutureKm > nominal.errorFutureKm);
  assert.equal(maneuver.truthInside95Sphere, false);
});

test('position-only update rejects a far-away inconsistent observation', () => {
  const belief = propagateBelief(initialBelief(), PRESENT_SECONDS);
  const bad = { x: 30, y: -30, z: 40 };
  const updated = updateWithPosition(belief, bad, 0.03);
  assert.equal(updated.accepted, false);
  assert.deepEqual(updated.belief, belief);
});

test('known truth is not secretly used in coasting propagation', () => {
  const before = stateAt(initialBelief(), 0);
  const after = stateAt(propagateBelief(initialBelief(), 60), 60);
  assert.notDeepEqual(before.positionKm, after.positionKm);
  const truth = syntheticTruth(60, false);
  assert.notDeepEqual(after.positionKm, truth);
});

test('invalid time, horizon and measurement precision fail visibly', () => {
  assert.throws(() => syntheticTruth(-1), RangeError);
  assert.throws(() => propagateBelief(initialBelief(), Number.NaN), RangeError);
  assert.throws(() => simulatePrediction({ horizonSeconds: 601, followUpObservation: true, unexpectedManeuver: false }), RangeError);
  assert.throws(() => updateWithPosition(initialBelief(), { x: 0, y: 0, z: 0 }, 0), RangeError);
});

test('a zero-second horizon equals the present estimate', () => {
  const v = simulatePrediction({ horizonSeconds: 0, followUpObservation: true, unexpectedManeuver: false });
  assert.deepEqual(v.future.positionKm, v.now.positionKm);
  assert.equal(v.future.uncertainty95Km, v.now.uncertainty95Km);
});
