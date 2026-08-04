import * as satellite from 'satellite.js';

/**
 * The coordinate maths, with no renderer attached.
 *
 * Split out of `celestial.ts` for a specific reason: that module imports
 * three.js for its Matrix4 and Color types, so anything touching it drags the
 * entire 3D engine into the bundle. The meteor shower panel wanted exactly two
 * functions from it — sidereal time, and where a radiant sits in the sky — and
 * paid for a megabyte of WebGL to get them, which also meant the sky dome could
 * never be code-split away from the rest of the page.
 *
 * Nothing here needs a matrix class. The rotation is a 3x3, and applying it is
 * three dot products.
 */

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
 * Rows of the rotation taking the equatorial frame into dome/scene coordinates
 * (+X east, +Y up, −Z north). See `equatorialToSceneMatrix` for the derivation;
 * this is the same rotation as plain numbers.
 */
export function sceneRotationRows(
  lstRad: number,
  latitudeDeg: number
): [[number, number, number], [number, number, number], [number, number, number]] {
  const phi = (latitudeDeg * Math.PI) / 180;
  const sinL = Math.sin(lstRad);
  const cosL = Math.cos(lstRad);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);

  return [
    [-sinL, cosL, 0],
    [cosPhi * cosL, cosPhi * sinL, sinPhi],
    [sinPhi * cosL, sinPhi * sinL, -cosPhi],
  ];
}

/**
 * Horizontal coordinates for a fixed equatorial position. Used for labels and
 * hit-testing; bulk star rendering uses the matrix form instead, which is what
 * keeps a five-thousand-star field cheap.
 */
export function raDecToAzEl(
  raDeg: number,
  decDeg: number,
  lstRad: number,
  latitudeDeg: number
): { azimuthDeg: number; elevationDeg: number } {
  const [ex, ey, ez] = raDecToEquatorial(raDeg, decDeg);
  const [rx, ry, rz] = sceneRotationRows(lstRad, latitudeDeg);

  const vx = rx[0] * ex + rx[1] * ey + rx[2] * ez;
  const vy = ry[0] * ex + ry[1] * ey + ry[2] * ez;
  const vz = rz[0] * ex + rz[1] * ey + rz[2] * ez;

  const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, vy))) * 180) / Math.PI;
  let azimuthDeg = (Math.atan2(vx, -vz) * 180) / Math.PI;
  if (azimuthDeg < 0) azimuthDeg += 360;
  return { azimuthDeg, elevationDeg };
}
