import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A low-poly airliner, built once and shared by every aircraft on screen.
 *
 * There can be a hundred-plus contacts over a busy area, so the whole
 * airframe is merged into a single BufferGeometry: one mesh and one draw call
 * per aircraft rather than one per wing and tailplane. The geometry is
 * created lazily on first use and never rebuilt.
 *
 * Modelled nose-forward along +Z with +Y up, so orienting an aircraft is just
 * pointing +Z along its direction of travel.
 */

let cached: THREE.BufferGeometry | null = null;

/**
 * Rough swept-wing planform: a tapered box, angled back and given dihedral.
 *
 * Both are whole-geometry rotations about the origin rather than about the
 * wing root, so the sign has to flip with the side to stay symmetric — the
 * same angle on both wings would sweep one forward and one aft.
 */
function wing(side: 1 | -1): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(2.9, 0.06, 0.62);
  geometry.translate(side * 1.55, 0, -0.1);
  // Sweep the tip aft, then lift it for dihedral.
  geometry.rotateY(side * 0.42);
  geometry.rotateZ(side * 0.06);
  return geometry;
}

function tailplane(side: 1 | -1): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1.15, 0.05, 0.34);
  geometry.translate(side * 0.62, 0.06, -1.62);
  geometry.rotateY(side * 0.34);
  return geometry;
}

/** Engine nacelle, slung under and ahead of the wing as on a real airliner. */
function engine(side: 1 | -1): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.2, 0.18, 0.72, 8);
  // Cylinders are built along Y; stand it along the flight axis.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(side * 1.15, -0.22, 0.12);
  return geometry;
}

function build(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Fuselage: a tube along the flight axis with a tapered nose and tail.
  const fuselage = new THREE.CylinderGeometry(0.26, 0.26, 3.1, 10);
  fuselage.rotateX(Math.PI / 2);
  parts.push(fuselage);

  const nose = new THREE.ConeGeometry(0.26, 0.75, 10);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 1.92);
  parts.push(nose);

  const tailCone = new THREE.ConeGeometry(0.26, 0.9, 10);
  // Pointing the other way, so the taper runs aft.
  tailCone.rotateX(-Math.PI / 2);
  tailCone.translate(0, 0.05, -2.0);
  parts.push(tailCone);

  parts.push(wing(1), wing(-1));
  parts.push(tailplane(1), tailplane(-1));

  // Vertical stabiliser.
  const fin = new THREE.BoxGeometry(0.06, 0.78, 0.66);
  fin.translate(0, 0.42, -1.78);
  parts.push(fin);

  parts.push(engine(1), engine(-1));

  const merged = BufferGeometryUtils.mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());

  if (!merged) {
    // mergeGeometries returns null if the inputs disagree on attributes,
    // which would be a programming error above rather than a runtime
    // condition — fail visibly rather than silently drawing nothing.
    throw new Error('Failed to merge aircraft geometry');
  }
  merged.computeVertexNormals();
  return merged;
}

export function aircraftGeometry(): THREE.BufferGeometry {
  if (!cached) cached = build();
  return cached;
}

/**
 * Steepest climb or descent we will draw. Vertical rate and ground speed are
 * independently reported and occasionally disagree wildly; clamping keeps one
 * bad reading from standing an airliner on its tail.
 */
const MAX_PITCH_RAD = THREE.MathUtils.degToRad(18);

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * The attitude an aircraft is actually flying at: wings level with the ground,
 * nose along its reported ground track.
 *
 * There is deliberately no dependence on where the aircraft sits on the dome.
 * The dome is only a direction — the aircraft's real orientation in the sky is
 * fixed by how it is flying, and the observer stands at the dome's centre, so
 * the viewing angle alone does the rest: one passing overhead is seen belly-on
 * and one near the horizon is seen from the side, with no special-casing.
 *
 * `trueTrackDeg` is a compass bearing (0 = north, clockwise), matching ADS-B.
 */
export function aircraftAttitude(
  trueTrackDeg: number,
  pitchRad = 0,
  target = new THREE.Quaternion()
): THREE.Quaternion {
  const heading = THREE.MathUtils.degToRad(trueTrackDeg);
  const pitch = THREE.MathUtils.clamp(pitchRad, -MAX_PITCH_RAD, MAX_PITCH_RAD);
  const cosPitch = Math.cos(pitch);

  // Scene convention (see azElToVec3): North is -Z, East is +X, up is +Y.
  const forward = new THREE.Vector3(
    Math.sin(heading) * cosPitch,
    Math.sin(pitch),
    -Math.cos(heading) * cosPitch
  );

  // makeBasis wants a right-handed frame, i.e. z = x cross y. With +Z as the
  // nose that puts the model's +X out the port wing; the airframe is
  // symmetric, so this shows up only in the maths, never on screen.
  const port = new THREE.Vector3().crossVectors(WORLD_UP, forward).normalize();
  const up = new THREE.Vector3().crossVectors(forward, port);

  return target.setFromRotationMatrix(new THREE.Matrix4().makeBasis(port, up, forward));
}

/**
 * Pitch angle implied by a climb rate against ground speed.
 *
 * Returns level flight when either figure is missing or the aircraft is too
 * slow for the ratio to mean anything, rather than guessing at an attitude.
 */
export function climbAngle(verticalRateMS: number | null, velocityMS: number | null): number {
  if (verticalRateMS === null || velocityMS === null || velocityMS < 20) return 0;
  return Math.atan2(verticalRateMS, velocityMS);
}
