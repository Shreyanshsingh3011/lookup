import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as THREE from 'three';
import { aircraftAttitude, aircraftGeometry, climbAngle } from './aircraftModel';

/** Where a model-space axis ends up in world space under an attitude. */
function mapped(q: THREE.Quaternion, axis: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(...axis).applyQuaternion(q);
}

function assertClose(actual: THREE.Vector3, expected: [number, number, number], message: string) {
  const want = new THREE.Vector3(...expected);
  assert.ok(
    actual.distanceTo(want) < 1e-6,
    `${message}: expected ${want.toArray().join(', ')} but got ${actual.toArray().join(', ')}`
  );
}

test('geometry is built once and shared', () => {
  assert.equal(aircraftGeometry(), aircraftGeometry());
});

test('geometry is nose-forward along +Z with a wider span than length', () => {
  const geometry = aircraftGeometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  // Nose reaches further forward than the tail reaches aft is not required,
  // but the model must extend in both directions along the flight axis.
  assert.ok(box.max.z > 2, `nose should reach past z=2, got ${box.max.z}`);
  assert.ok(box.min.z < -2, `tail should reach past z=-2, got ${box.min.z}`);

  // An airliner is wider than it is long at this level of detail, and the
  // wings must be symmetric about the fuselage.
  assert.ok(box.max.x - box.min.x > box.max.z - box.min.z, 'span should exceed length');
  assert.ok(Math.abs(box.max.x + box.min.x) < 1e-6, 'wings should be symmetric about x=0');

  // The fin puts far more of the airframe above the axis than below it.
  assert.ok(box.max.y > 0.7, `fin should reach above y=0.7, got ${box.max.y}`);
});

test('wings sweep aft on both sides, not one forward and one back', () => {
  const geometry = aircraftGeometry();
  const pos = geometry.getAttribute('position');

  // The most outboard vertex on each side is a wingtip; a swept wing puts it
  // behind the wing root, which sits near z = 0.
  let portTip = new THREE.Vector3(0, 0, 0);
  let starboardTip = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    if (v.x > starboardTip.x) starboardTip = v;
    if (v.x < portTip.x) portTip = v;
  }

  assert.ok(starboardTip.z < -0.3, `starboard tip should sit aft, got z=${starboardTip.z}`);
  assert.ok(portTip.z < -0.3, `port tip should sit aft, got z=${portTip.z}`);
  // Dihedral lifts both tips above the wing root.
  assert.ok(starboardTip.y > 0, `starboard tip should sit high, got y=${starboardTip.y}`);
  assert.ok(portTip.y > 0, `port tip should sit high, got y=${portTip.y}`);
});

test('northbound level flight points the nose north with wings level', () => {
  const q = aircraftAttitude(0);
  // Scene convention: North is -Z, East is +X, up is +Y.
  assertClose(mapped(q, [0, 0, 1]), [0, 0, -1], 'nose should point north');
  assertClose(mapped(q, [0, 1, 0]), [0, 1, 0], 'the model should be wings-level');
});

test('eastbound level flight points the nose east with wings level', () => {
  const q = aircraftAttitude(90);
  assertClose(mapped(q, [0, 0, 1]), [1, 0, 0], 'nose should point east');
  assertClose(mapped(q, [0, 1, 0]), [0, 1, 0], 'the model should be wings-level');
});

test('attitude is independent of where the aircraft appears on the dome', () => {
  // This is the whole point of using true attitude: a southbound aircraft is
  // flying the same way whether it is overhead or near the horizon, and the
  // observer's viewing angle is what makes them look different.
  const a = aircraftAttitude(180);
  const b = aircraftAttitude(180);
  assert.ok(a.equals(b));
  assertClose(mapped(a, [0, 0, 1]), [0, 0, 1], 'nose should point south');
});

test('the basis stays a proper rotation at every heading', () => {
  for (let heading = 0; heading < 360; heading += 15) {
    const q = aircraftAttitude(heading, 0.2);
    const nose = mapped(q, [0, 0, 1]);
    const up = mapped(q, [0, 1, 0]);
    const port = mapped(q, [1, 0, 0]);

    assert.ok(Math.abs(nose.length() - 1) < 1e-6, `heading ${heading}: nose not unit length`);
    assert.ok(Math.abs(nose.dot(up)) < 1e-6, `heading ${heading}: axes not orthogonal`);
    // A reflection would flip the handedness, which a quaternion cannot
    // represent and which would turn the model inside out.
    assertClose(
      new THREE.Vector3().crossVectors(port, up),
      nose.toArray() as [number, number, number],
      `heading ${heading}: basis should stay right-handed`
    );
  }
});

test('climbing raises the nose, descending lowers it', () => {
  const climbing = mapped(aircraftAttitude(0, 0.15), [0, 0, 1]);
  const descending = mapped(aircraftAttitude(0, -0.15), [0, 0, 1]);
  assert.ok(climbing.y > 0.1, `climbing nose should rise, got ${climbing.y}`);
  assert.ok(descending.y < -0.1, `descending nose should drop, got ${descending.y}`);
});

test('pitch is clamped so a bad vertical rate cannot stand the model on its tail', () => {
  const nose = mapped(aircraftAttitude(0, Math.PI / 2), [0, 0, 1]);
  assert.ok(nose.y < 0.35, `pitch should be clamped well below vertical, got ${nose.y}`);
  assert.ok(nose.z < -0.9, 'a clamped climb should still be mostly horizontal');
});

test('climb angle needs both a rate and a usable ground speed', () => {
  assert.equal(climbAngle(null, 200), 0);
  assert.equal(climbAngle(5, null), 0);
  // A near-stationary contact makes the ratio meaningless.
  assert.equal(climbAngle(5, 3), 0);

  // 10 m/s up at 200 m/s forward is a shade under 3 degrees.
  const angle = climbAngle(10, 200);
  assert.ok(angle > 0.049 && angle < 0.051, `expected ~0.05 rad, got ${angle}`);
  assert.ok(climbAngle(-10, 200) < 0, 'a descent should give a negative angle');
});
