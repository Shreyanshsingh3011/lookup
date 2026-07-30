import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BORESIGHT_THRESHOLD_DEG, findBoresightMatch } from './boresight';

/** A camera at the dome centre, looking toward the given azimuth/elevation. */
function cameraLookingAt(azimuthDeg: number, elevationDeg: number): THREE.Camera {
  const camera = new THREE.PerspectiveCamera();
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // Same convention as azElToVec3: +X east, +Y up, -Z north.
  const target = new THREE.Vector3(
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    -Math.cos(el) * Math.cos(az)
  );
  camera.position.set(0, 0, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

test('matches the one candidate dead centre', () => {
  const camera = cameraLookingAt(90, 30);
  const match = findBoresightMatch(camera, [{ azimuthDeg: 90, elevationDeg: 30, data: 'target' }]);
  assert.ok(match);
  assert.equal(match.data, 'target');
  assert.ok(match.separationDeg < 0.01, `expected ~0 separation, got ${match.separationDeg}`);
});

test('picks the nearest of several candidates within range', () => {
  const camera = cameraLookingAt(180, 45);
  const match = findBoresightMatch(camera, [
    { azimuthDeg: 180, elevationDeg: 50, data: 'near' }, // 5 deg away
    { azimuthDeg: 180, elevationDeg: 40, data: 'also-near' }, // 5 deg away, farther in this test's tie
    { azimuthDeg: 190, elevationDeg: 45, data: 'far-but-in-range' },
  ]);
  assert.ok(match);
  assert.equal(match.data, 'near');
});

test('returns null when nothing is within the threshold', () => {
  const camera = cameraLookingAt(0, 60); // looking north, high up
  const match = findBoresightMatch(camera, [
    { azimuthDeg: 180, elevationDeg: 10, data: 'south-and-low' }, // far away
  ]);
  assert.equal(match, null);
});

test('a candidate exactly at the threshold edge is excluded, just inside is included', () => {
  const camera = cameraLookingAt(0, 0); // looking due north at the horizon
  const justOutside = findBoresightMatch(camera, [
    { azimuthDeg: BORESIGHT_THRESHOLD_DEG + 0.5, elevationDeg: 0, data: 'outside' },
  ]);
  assert.equal(justOutside, null);

  const justInside = findBoresightMatch(camera, [
    { azimuthDeg: BORESIGHT_THRESHOLD_DEG - 0.5, elevationDeg: 0, data: 'inside' },
  ]);
  assert.ok(justInside);
  assert.equal(justInside.data, 'inside');
});

test('works at the zenith, where azimuth becomes degenerate', () => {
  const camera = cameraLookingAt(0, 89.9);
  // Any azimuth is valid near the zenith; both should read as very close.
  const match = findBoresightMatch(camera, [
    { azimuthDeg: 45, elevationDeg: 89.8, data: 'near-zenith' },
    { azimuthDeg: 270, elevationDeg: 10, data: 'far-away' },
  ]);
  assert.ok(match);
  assert.equal(match.data, 'near-zenith');
});

test('empty candidate list returns null', () => {
  const camera = cameraLookingAt(90, 30);
  assert.equal(findBoresightMatch(camera, []), null);
});
