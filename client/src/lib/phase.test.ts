import assert from 'node:assert/strict';
import { test } from 'node:test';
import { illuminatedFractionFrom, phaseAngleFor, sunwardDirection } from './phase';

test('phaseAngleFor maps a full disc to zero and a new one to pi', () => {
  assert.ok(Math.abs(phaseAngleFor(1)) < 1e-9);
  assert.ok(Math.abs(phaseAngleFor(0) - Math.PI) < 1e-9);
  // Exactly half lit is a right angle between Sun and observer.
  assert.ok(Math.abs(phaseAngleFor(0.5) - Math.PI / 2) < 1e-9);
});

test('phaseAngleFor clamps nonsense input rather than returning NaN', () => {
  assert.ok(Number.isFinite(phaseAngleFor(-3)));
  assert.ok(Number.isFinite(phaseAngleFor(42)));
});

/**
 * The construction is checked by round-tripping: light a body with the
 * direction produced for a given fraction, then measure the fraction that
 * direction actually lights. They must agree, or the rendered phase is wrong.
 */
test('the constructed light direction reproduces the requested phase', () => {
  const body = { azimuthDeg: 120, elevationDeg: 35 };
  const sun = { azimuthDeg: 250, elevationDeg: 10 };

  for (const fraction of [0.02, 0.15, 0.35, 0.5, 0.72, 0.95, 1]) {
    const light = sunwardDirection(body, sun, fraction);
    const measured = illuminatedFractionFrom(body, light);
    assert.ok(
      Math.abs(measured - fraction) < 1e-6,
      `asked for ${fraction}, direction lights ${measured}`
    );
  }
});

test('the round trip holds across a spread of sky geometries', () => {
  for (const bodyAz of [0, 75, 180, 300]) {
    for (const bodyEl of [5, 40, 80]) {
      for (const sunAz of [10, 190, 355]) {
        const body = { azimuthDeg: bodyAz, elevationDeg: bodyEl };
        const sun = { azimuthDeg: sunAz, elevationDeg: -20 };
        const light = sunwardDirection(body, sun, 0.3);
        const measured = illuminatedFractionFrom(body, light);
        assert.ok(
          Math.abs(measured - 0.3) < 1e-6,
          `body ${bodyAz}/${bodyEl} sun ${sunAz} gave ${measured}`
        );
      }
    }
  }
});

test('the bright limb leans toward the Sun rather than away from it', () => {
  // Body due south, Sun to the west: the lit edge must be on the west side.
  const body = { azimuthDeg: 180, elevationDeg: 30 };
  const west = sunwardDirection(body, { azimuthDeg: 270, elevationDeg: 5 }, 0.25);
  const east = sunwardDirection(body, { azimuthDeg: 90, elevationDeg: 5 }, 0.25);

  // Scene frame is +X east, so the two cases must fall on opposite sides.
  assert.ok(west[0] < 0, `expected the light to come from the west, got x=${west[0]}`);
  assert.ok(east[0] > 0, `expected the light to come from the east, got x=${east[0]}`);
});

test('a body with no reported phase is lit head-on rather than guessed at', () => {
  const body = { azimuthDeg: 45, elevationDeg: 20 };
  const light = sunwardDirection(body, { azimuthDeg: 200, elevationDeg: 0 }, null);
  assert.ok(Math.abs(illuminatedFractionFrom(body, light) - 1) < 1e-6);
});

test('a body sitting on the Sun does not produce a NaN direction', () => {
  const shared = { azimuthDeg: 100, elevationDeg: 25 };
  const light = sunwardDirection(shared, shared, 0.5);
  assert.ok(light.every(Number.isFinite), `got ${JSON.stringify(light)}`);
});

test('a body exactly opposite the Sun does not produce a NaN direction', () => {
  const body = { azimuthDeg: 0, elevationDeg: 40 };
  const sun = { azimuthDeg: 180, elevationDeg: -40 };
  const light = sunwardDirection(body, sun, 0.9);
  assert.ok(light.every(Number.isFinite), `got ${JSON.stringify(light)}`);
});
