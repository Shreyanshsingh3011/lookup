import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookDirectionFrom, shortestAngleDelta, smoothAngle } from './deviceOrientation';

/**
 * Reference orientations, checked against what the phone is physically doing
 * rather than against the formula that produced them. The reference frame has
 * the device flat, screen up, top edge toward north.
 */

test('a phone lying flat screen-up points its camera straight down', () => {
  const look = lookDirectionFrom({ alpha: 0, beta: 0, gamma: 0 });
  assert.ok(Math.abs(look.elevationDeg + 90) < 0.01, `expected -90, got ${look.elevationDeg}`);
});

test('a phone held upright with its top away points at the northern horizon', () => {
  const look = lookDirectionFrom({ alpha: 0, beta: 90, gamma: 0 });
  assert.ok(Math.abs(look.azimuthDeg) < 0.01, `expected azimuth ~0, got ${look.azimuthDeg}`);
  assert.ok(Math.abs(look.elevationDeg) < 0.01, `expected elevation ~0, got ${look.elevationDeg}`);
});

test('a phone lying flat screen-down points its camera at the zenith', () => {
  const look = lookDirectionFrom({ alpha: 0, beta: 180, gamma: 0 });
  assert.ok(Math.abs(look.elevationDeg - 90) < 0.01, `expected +90, got ${look.elevationDeg}`);
});

test('alpha rotates the view counter-clockwise, so alpha 90 upright looks west', () => {
  const look = lookDirectionFrom({ alpha: 90, beta: 90, gamma: 0 });
  assert.ok(Math.abs(look.azimuthDeg - 270) < 0.01, `expected ~270 (west), got ${look.azimuthDeg}`);
});

test('alpha 180 upright looks south', () => {
  const look = lookDirectionFrom({ alpha: 180, beta: 90, gamma: 0 });
  assert.ok(Math.abs(look.azimuthDeg - 180) < 0.01, `expected ~180, got ${look.azimuthDeg}`);
});

test('tilting the phone back from upright raises the view up the sky', () => {
  const horizon = lookDirectionFrom({ alpha: 0, beta: 90, gamma: 0 });
  const halfway = lookDirectionFrom({ alpha: 0, beta: 135, gamma: 0 });
  const zenith = lookDirectionFrom({ alpha: 0, beta: 180, gamma: 0 });

  assert.ok(Math.abs(horizon.elevationDeg) < 0.01);
  assert.ok(Math.abs(halfway.elevationDeg - 45) < 0.01, `expected ~45, got ${halfway.elevationDeg}`);
  assert.ok(Math.abs(zenith.elevationDeg - 90) < 0.01);
});

test('gamma swings the bearing while the phone stays upright', () => {
  const look = lookDirectionFrom({ alpha: 0, beta: 90, gamma: 30 });
  // Rolling the phone about its own long axis while upright turns where the
  // camera faces; it should stay on the horizon and swing west of north.
  assert.ok(Math.abs(look.elevationDeg) < 0.01, `expected to stay on the horizon, got ${look.elevationDeg}`);
  assert.ok(Math.abs(look.azimuthDeg - 330) < 0.01, `expected ~330, got ${look.azimuthDeg}`);
});

test('a true-north compass heading overrides the relative alpha', () => {
  // webkitCompassHeading is clockwise from north, the opposite sense to alpha.
  // A heading of 90 (east) held upright should look east.
  const look = lookDirectionFrom({ alpha: 0, beta: 90, gamma: 0, compassHeading: 90 });
  assert.ok(Math.abs(look.azimuthDeg - 90) < 0.01, `expected ~90 (east), got ${look.azimuthDeg}`);
});

test('a compass heading of zero still reads as north', () => {
  const look = lookDirectionFrom({ alpha: 123, beta: 90, gamma: 0, compassHeading: 0 });
  assert.ok(Math.abs(look.azimuthDeg) < 0.01, `expected ~0, got ${look.azimuthDeg}`);
});

test('azimuth is always reported in [0, 360)', () => {
  for (let alpha = -720; alpha <= 720; alpha += 37) {
    for (const beta of [0, 45, 90, 135, 180]) {
      const { azimuthDeg } = lookDirectionFrom({ alpha, beta, gamma: 0 });
      assert.ok(azimuthDeg >= 0 && azimuthDeg < 360, `alpha=${alpha} beta=${beta} gave ${azimuthDeg}`);
    }
  }
});

test('elevation never leaves the [-90, 90] range', () => {
  for (let beta = -180; beta <= 180; beta += 13) {
    for (let gamma = -90; gamma <= 90; gamma += 13) {
      const { elevationDeg } = lookDirectionFrom({ alpha: 17, beta, gamma });
      assert.ok(elevationDeg >= -90.001 && elevationDeg <= 90.001, `beta=${beta} gamma=${gamma} gave ${elevationDeg}`);
    }
  }
});

test('shortestAngleDelta takes the short way around the compass', () => {
  assert.equal(shortestAngleDelta(350, 10), 20);
  assert.equal(shortestAngleDelta(10, 350), -20);
  assert.equal(shortestAngleDelta(0, 180), 180);
  assert.equal(shortestAngleDelta(90, 90), 0);
});

test('smoothAngle eases toward the target without wrapping the long way', () => {
  // Crossing north: 350 -> 10 should move forward through 0, not back through 180.
  const stepped = smoothAngle(350, 10, 0.5);
  assert.ok(Math.abs(stepped - 0) < 0.01, `expected ~0, got ${stepped}`);
});

test('smoothAngle keeps its output in [0, 360) and converges', () => {
  let current = 0;
  for (let i = 0; i < 200; i++) {
    current = smoothAngle(current, 275, 0.2);
    assert.ok(current >= 0 && current < 360);
  }
  assert.ok(Math.abs(current - 275) < 0.5, `expected convergence to 275, got ${current}`);
});
