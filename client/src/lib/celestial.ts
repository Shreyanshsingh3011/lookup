import * as satellite from 'satellite.js';
import * as THREE from 'three';
import { DOME_RADIUS } from './sky';

/**
 * Unit vector in the J2000 equatorial frame: +x toward the vernal equinox,
 * +z toward the north celestial pole.
 */
export function raDecToEquatorial(raDeg: number, decDeg: number): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cosDec = Math.cos(dec);
  return [cosDec * Math.cos(ra), cosDec * Math.sin(ra), Math.sin(dec)];
}

/** Local apparent sidereal time in radians (GMST plus the observer's longitude). */
export function localSiderealTime(date: Date, longitudeDeg: number): number {
  return satellite.gstime(date) + (longitudeDeg * Math.PI) / 180;
}

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
 */
export function equatorialToSceneMatrix(lstRad: number, latitudeDeg: number): THREE.Matrix4 {
  const phi = (latitudeDeg * Math.PI) / 180;
  const sinL = Math.sin(lstRad);
  const cosL = Math.cos(lstRad);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  // Row-major, matching Matrix4.set.
  return new THREE.Matrix4().set(
    -sinL,          cosL,          0,       0,
    cosPhi * cosL,  cosPhi * sinL, sinPhi,  0,
    sinPhi * cosL,  sinPhi * sinL, -cosPhi, 0,
    0,              0,             0,       1
  );
}

/**
 * Horizontal coordinates for a fixed equatorial position. Used for labels and
 * hit-testing; bulk star rendering uses the matrix above instead.
 */
export function raDecToAzEl(
  raDeg: number,
  decDeg: number,
  lstRad: number,
  latitudeDeg: number
): { azimuthDeg: number; elevationDeg: number } {
  const [ex, ey, ez] = raDecToEquatorial(raDeg, decDeg);
  const v = new THREE.Vector3(ex, ey, ez).applyMatrix4(equatorialToSceneMatrix(lstRad, latitudeDeg));
  const elevationDeg = (Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180) / Math.PI;
  let azimuthDeg = (Math.atan2(v.x, -v.z) * 180) / Math.PI;
  if (azimuthDeg < 0) azimuthDeg += 360;
  return { azimuthDeg, elevationDeg };
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
