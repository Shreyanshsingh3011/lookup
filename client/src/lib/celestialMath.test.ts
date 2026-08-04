import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from 'three';
import { equatorialToSceneMatrix } from './celestial';
import { raDecToAzEl, raDecToEquatorial, sceneRotationRows } from './celestialMath';

/**
 * The point of these is that splitting three.js out of the coordinate maths
 * must not have moved a single star. Both forms are checked against each other
 * rather than against remembered numbers.
 */

test('the hand-rolled rotation is the same matrix three.js was building', () => {
  for (const lst of [0, 1.3, 3.9, 6.1]) {
    for (const lat of [-89, -33.9, 0, 28.5, 51.5, 89]) {
      const rows = sceneRotationRows(lst, lat);
      const matrix = equatorialToSceneMatrix(lst, lat);
      const e = matrix.elements; // column-major
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          assert.ok(
            Math.abs(rows[r][c] - e[c * 4 + r]) < 1e-15,
            `row ${r} col ${c} at lst ${lst}, lat ${lat}: ${rows[r][c]} vs ${e[c * 4 + r]}`
          );
        }
      }
    }
  }
});

test('az/el matches applying the matrix through three.js, to the last bit', () => {
  const viaThree = (raDeg: number, decDeg: number, lst: number, lat: number) => {
    const [ex, ey, ez] = raDecToEquatorial(raDeg, decDeg);
    const v = new THREE.Vector3(ex, ey, ez).applyMatrix4(equatorialToSceneMatrix(lst, lat));
    const elevationDeg = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180) / Math.PI;
    let azimuthDeg = (Math.atan2(v.x, -v.z) * 180) / Math.PI;
    if (azimuthDeg < 0) azimuthDeg += 360;
    return { azimuthDeg, elevationDeg };
  };

  // Real radiants and stars, at a spread of times and latitudes.
  const targets: Array<[string, number, number]> = [
    ['Perseid radiant', 48.0, 58.0],
    ['Geminid radiant', 112.0, 32.0],
    ['Polaris', 37.95, 89.26],
    ['Sirius', 101.29, -16.72],
    ['vernal equinox', 0, 0],
    ['south celestial pole', 0, -90],
  ];

  for (const [name, ra, dec] of targets) {
    for (const lst of [0, 0.7, 2.4, 4.8, 6.28]) {
      for (const lat of [-45, 0, 51.5, 78]) {
        const mine = raDecToAzEl(ra, dec, lst, lat);
        const theirs = viaThree(ra, dec, lst, lat);
        assert.ok(
          Math.abs(mine.elevationDeg - theirs.elevationDeg) < 1e-12,
          `${name} elevation at lst ${lst}, lat ${lat}`
        );
        // Azimuth is meaningless at the zenith and wraps at 360; compare the
        // short way round so 359.9999 and 0.0001 do not read as 360 apart.
        const delta = Math.abs(((mine.azimuthDeg - theirs.azimuthDeg + 540) % 360) - 180);
        assert.ok(delta < 1e-10, `${name} azimuth at lst ${lst}, lat ${lat}: ${delta}`);
      }
    }
  }
});

test('the sky still behaves like a sky', () => {
  // Polaris sits at very nearly the observer's latitude, due north — the oldest
  // navigation fact there is, and a check that nothing got transposed.
  for (const lat of [10, 40, 60]) {
    const polaris = raDecToAzEl(37.95, 89.26, 1.234, lat);
    assert.ok(Math.abs(polaris.elevationDeg - lat) < 1, `Polaris at lat ${lat}`);
    const fromNorth = Math.min(polaris.azimuthDeg, 360 - polaris.azimuthDeg);
    assert.ok(fromNorth < 2, `Polaris should be due north, was ${polaris.azimuthDeg}`);
  }

  // The south celestial pole is below the horizon for any northern observer.
  assert.ok(raDecToAzEl(0, -90, 0, 51.5).elevationDeg < -50);
  // And a unit vector stays a unit vector.
  const [x, y, z] = raDecToEquatorial(123, -45);
  assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-15);
});
