import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deviceUpFrom, lookDirectionFrom, upFromRoll } from './deviceOrientation';

/**
 * The camera's up vector is rebuilt from three smoothed angles rather than
 * carried as a vector, because a vector cannot be eased between samples without
 * drifting off the unit sphere. That reconstruction has a sign convention in it,
 * and a sign error would tilt the sky the wrong way in exactly the cases hardest
 * to notice — so it is checked against the rotation matrix's own second column,
 * which has no convention to get wrong.
 */
test('the reconstructed up vector matches the matrix across every attitude', () => {
  let worst = 0;
  let worstAt = '';

  for (let alpha = 0; alpha < 360; alpha += 30) {
    for (let beta = -170; beta <= 170; beta += 20) {
      for (let gamma = -80; gamma <= 80; gamma += 20) {
        const sample = { alpha, beta, gamma };
        const look = lookDirectionFrom(sample);

        // Undefined at the poles: no reference "up" exists looking straight up
        // or down, so the reconstruction legitimately picks its own.
        if (Math.abs(look.elevationDeg) > 89.5) continue;

        const [ex, ey, ez] = deviceUpFrom(sample);
        const [rx, ry, rz] = upFromRoll(look.azimuthDeg, look.elevationDeg, look.rollDeg);

        const dot = Math.max(-1, Math.min(1, ex * rx + ey * ry + ez * rz));
        const offDeg = (Math.acos(dot) * 180) / Math.PI;
        if (offDeg > worst) {
          worst = offDeg;
          worstAt = `alpha=${alpha} beta=${beta} gamma=${gamma}`;
        }
      }
    }
  }

  assert.ok(worst < 0.001, `worst disagreement ${worst.toFixed(4)}deg at ${worstAt}`);
});

test('the reconstructed up vector is a unit vector and perpendicular to the view', () => {
  for (const sample of [
    { alpha: 0, beta: 90, gamma: 0 },
    { alpha: 270, beta: 0, gamma: 90 },
    { alpha: 137, beta: -40, gamma: 25 },
  ]) {
    const look = lookDirectionFrom(sample);
    const [ux, uy, uz] = upFromRoll(look.azimuthDeg, look.elevationDeg, look.rollDeg);
    assert.ok(Math.abs(Math.hypot(ux, uy, uz) - 1) < 1e-9, 'up must be unit length');

    const az = (look.azimuthDeg * Math.PI) / 180;
    const el = (look.elevationDeg * Math.PI) / 180;
    const f = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
    const along = f[0] * ux + f[1] * uy + f[2] * uz;
    assert.ok(Math.abs(along) < 1e-9, `up must be perpendicular to the view, got ${along}`);
  }
});

test('pointing at the zenith yields a usable up rather than a NaN', () => {
  const [x, y, z] = upFromRoll(0, 90, 0);
  assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-9);
});
