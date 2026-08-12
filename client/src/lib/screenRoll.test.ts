import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { lookDirectionFrom, screenRollFrom } from './deviceOrientation';

/**
 * How far the sky on screen is turned away from reality.
 *
 * The dome aims correctly at any device attitude — that is covered in
 * deviceOrientation.test.ts — but the rendered view's roll is pinned to world
 * up by OrbitControls. These pin the size of the resulting error so it is a
 * measured limitation rather than an unknown one.
 */

/**
 * Both of these point the camera at the northern horizon; they differ only in
 * roll. The angles are derived from the rotation matrix, not guessed: for the
 * screen's up axis to point east while the camera looks north, the second column
 * of Rz(alpha)Rx(beta)Ry(gamma) must be east and the third south, which forces
 * alpha 270, beta 0, gamma 90.
 *
 * Guessing gave beta 90 with gamma -90, which sounds like "upright, rolled onto
 * its side" and is not: at beta 90 the alpha and gamma axes coincide — ordinary
 * gimbal lock for this convention — so gamma swings the bearing instead of
 * rolling the phone. The first version of this test asserted against that and
 * failed, correctly.
 */
const PORTRAIT_NORTH = { alpha: 0, beta: 90, gamma: 0 };
const LANDSCAPE_NORTH = { alpha: 270, beta: 0, gamma: 90 };

test('portrait is unrolled, so the displayed sky matches reality', () => {
  assert.ok(
    Math.abs(screenRollFrom(PORTRAIT_NORTH)) < 1,
    `portrait should read about zero roll, got ${screenRollFrom(PORTRAIT_NORTH).toFixed(1)}`
  );
});

test('landscape is rolled about ninety degrees, which is the size of the error', () => {
  const roll = Math.abs(screenRollFrom(LANDSCAPE_NORTH));
  assert.ok(
    roll > 80 && roll < 100,
    `landscape should read about ninety degrees of roll, got ${roll.toFixed(1)}`
  );
});

test('rolling the phone does not change where it points', () => {
  // The two holds above are the same pointing direction. If they were not, the
  // roll measurement would be describing something else.
  const a = lookDirectionFrom(PORTRAIT_NORTH);
  const b = lookDirectionFrom(LANDSCAPE_NORTH);
  assert.ok(Math.abs(a.azimuthDeg - b.azimuthDeg) < 1, `azimuth moved: ${a.azimuthDeg} vs ${b.azimuthDeg}`);
  assert.ok(Math.abs(a.elevationDeg - b.elevationDeg) < 1, `elevation moved: ${a.elevationDeg} vs ${b.elevationDeg}`);
});

test('a partially rolled phone reads a partial roll', () => {
  const roll = Math.abs(screenRollFrom({ alpha: 315, beta: 45, gamma: 45 }));
  assert.ok(roll > 10 && roll < 80, `expected an intermediate roll, got ${roll.toFixed(1)}`);
});

test('the two landscape holds roll opposite ways', () => {
  const left = screenRollFrom({ alpha: 270, beta: 0, gamma: 90 });
  const right = screenRollFrom({ alpha: 90, beta: 0, gamma: -90 });
  assert.ok(left * right < 0, `rolling either way should differ in sign: ${left}, ${right}`);
});

test('roll is defined, not NaN, when pointing at the zenith', () => {
  // Straight up there is no reference direction for "up on screen", so this
  // must degrade to zero rather than produce NaN and corrupt a camera.
  const roll = screenRollFrom({ alpha: 0, beta: 180, gamma: 0 });
  assert.ok(Number.isFinite(roll), `expected a finite roll, got ${roll}`);
});
