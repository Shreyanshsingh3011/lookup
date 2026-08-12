import * as THREE from 'three';
import { precessionRows, sceneRotationRows } from './celestialMath';
import { DOME_RADIUS } from './sky';

/**
 * The renderer-free maths lives in `./celestialMath`, so that panels wanting
 * only a sidereal time do not pull three.js — and by extension the whole 3D
 * engine — into the initial bundle. Re-exported here so the sky components can
 * keep importing everything from one place.
 */
export {
  localSiderealTime,
  precessRaDec,
  precessionRows,
  raDecToAzEl,
  raDecToEquatorial,
  sceneRotationRows,
} from './celestialMath';

/**
 * Rotation taking the equatorial frame into dome/scene coordinates
 * (+X east, +Y up, −Z north), for a given sidereal time and latitude.
 *
 * Derivation. With hour angle H = LST − α, the standard horizontal formulae are
 *
 *   x = cos(el)·sin(az)          = −cos(δ)·sin(H)
 *   y = sin(el)                  =  sin(δ)·sin(φ) + cos(δ)·cos(φ)·cos(H)
 *   z = −cos(el)·cos(az)         = −sin(δ)·cos(φ) + cos(δ)·sin(φ)·cos(H)
 *
 * Substituting u = cos(δ)cos(H), v = cos(δ)sin(H), w = sin(δ) makes the right
 * hand sides linear in (u, v, w), and (u, v, w) is itself linear in the
 * equatorial vector — so the whole conversion collapses to one 3×3 rotation.
 * Its determinant is +1: the parity flip from measuring azimuth eastward from
 * north cancels the flip from hour angle running opposite to right ascension.
 *
 * This is what makes a 5000-star field cheap. The geometry is built once from
 * fixed RA/Dec and only this matrix changes as time advances or the observer
 * moves, instead of re-deriving horizontal coordinates per star per frame.
 *
 * Precession rides in the same matrix. The catalogue is J2000 and the sky is
 * not, so the J2000 vectors are rotated to the mean equinox of date before the
 * horizontal rotation — one extra 3x3 multiply per matrix rebuild, and none per
 * star. Pass the instant being drawn; omitting it leaves the coordinates in
 * J2000, which is what the whole star field used to do.
 */
export function equatorialToSceneMatrix(
  lstRad: number,
  latitudeDeg: number,
  when?: Date
): THREE.Matrix4 {
  const [h0, h1, h2] = sceneRotationRows(lstRad, latitudeDeg);
  const [r0, r1, r2] = when ? composeRows([h0, h1, h2], precessionRows(when)) : [h0, h1, h2];
  // Row-major, matching Matrix4.set.
  return new THREE.Matrix4().set(
    r0[0], r0[1], r0[2], 0,
    r1[0], r1[1], r1[2], 0,
    r2[0], r2[1], r2[2], 0,
    0,     0,     0,     1
  );
}

/** Row-major 3x3 product, so precession can be folded into the scene rotation. */
type Rows = [[number, number, number], [number, number, number], [number, number, number]];
function composeRows(a: Rows, b: Rows): Rows {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out as Rows;
}

/**
 * Approximate visual colour from B−V colour index, via Ballesteros' formula for
 * effective temperature and a blackbody-ish ramp. Purely cosmetic, but it makes
 * Betelgeuse read orange and Rigel blue-white as they should.
 */
export function bvToColor(bv: number): THREE.Color {
  const clamped = THREE.MathUtils.clamp(bv, -0.4, 2.0);
  const t = 4600 * (1 / (0.92 * clamped + 1.7) + 1 / (0.92 * clamped + 0.62));

  // Piecewise ramp across the temperatures naked-eye stars actually span.
  const stops: Array<[number, string]> = [
    [2500, '#ffcc6f'],
    [3500, '#ffd2a1'],
    [5000, '#fff4ea'],
    [6000, '#ffffff'],
    [7500, '#e9f2ff'],
    [10000, '#cadfff'],
    [20000, '#aabfff'],
  ];

  if (t <= stops[0][0]) return new THREE.Color(stops[0][1]);
  const last = stops[stops.length - 1];
  if (t >= last[0]) return new THREE.Color(last[1]);

  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      return new THREE.Color(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0));
    }
  }
  return new THREE.Color('#ffffff');
}

/** Point size in world units, so brighter stars render larger. */
export function magnitudeToSize(mag: number, magnitudeLimit: number): number {
  // Each magnitude step is ~2.5x in flux; compress that hard so mag-6 stars
  // stay visible without mag -1 stars becoming blobs.
  const t = THREE.MathUtils.clamp((magnitudeLimit - mag) / (magnitudeLimit + 1.5), 0, 1);
  return DOME_RADIUS * (0.0025 + 0.011 * Math.pow(t, 2.1));
}
