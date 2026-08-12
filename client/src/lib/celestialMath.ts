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

/**
 * Precession from J2000 to the mean equinox of date.
 *
 * The star catalogue, the constellation lines, the galactic pole and the
 * small-body elements are all J2000. The planets are not: usePlanetPositions
 * asks astronomy-engine for of-date coordinates. So the two frames in this app
 * disagree, and the size of the disagreement is not negligible — measured
 * against astronomy-engine at the current epoch it reaches 0.36° for
 * Betelgeuse, around 4-5 pixels at the default field of view, growing by about
 * 0.14° a decade. The README claimed sub-arcminute, which was wrong by a factor
 * of roughly twenty.
 *
 * Implemented here rather than taken from astronomy-engine because this module
 * is deliberately dependency-free — panels import it for a sidereal time
 * without pulling in three.js or an ephemeris. It is the standard IAU 1976
 * zeta/z/theta rotation, which is accurate to well under an arcsecond over the
 * decades this app deals in, and celestialMath.test.ts cross-checks it against
 * astronomy-engine's independent implementation.
 *
 * Mean equinox, not true: nutation is deliberately omitted, at most about 17
 * arcseconds and well under a rendered star glyph. Atmospheric refraction is
 * likewise not applied anywhere in this app, matching how satellite elevations
 * are computed.
 */
export function precessionRows(
  when: Date
): [[number, number, number], [number, number, number], [number, number, number]] {
  // Julian centuries from J2000.0.
  const jd = when.getTime() / 86_400_000 + 2_440_587.5;
  const T = (jd - 2_451_545.0) / 36_525;

  const arcsec = Math.PI / (180 * 3600);
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * arcsec;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * arcsec;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * arcsec;

  const cz = Math.cos(zeta);
  const sz = Math.sin(zeta);
  const cZ = Math.cos(z);
  const sZ = Math.sin(z);
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  return [
    [cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ],
    [cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ],
    [cz * st, -sz * st, ct],
  ];
}

/**
 * A J2000 right ascension and declination, moved to the mean equinox of date.
 *
 * Returned in the same units it takes, so a call site that had J2000 degrees
 * can be corrected without changing anything else about how it works.
 */
export function precessRaDec(
  raDeg: number,
  decDeg: number,
  when: Date
): { raDeg: number; decDeg: number } {
  const [ex, ey, ez] = raDecToEquatorial(raDeg, decDeg);
  const [r0, r1, r2] = precessionRows(when);

  const x = r0[0] * ex + r0[1] * ey + r0[2] * ez;
  const y = r1[0] * ex + r1[1] * ey + r1[2] * ez;
  const zc = r2[0] * ex + r2[1] * ey + r2[2] * ez;

  let ra = (Math.atan2(y, x) * 180) / Math.PI;
  if (ra < 0) ra += 360;
  return {
    raDeg: ra,
    decDeg: (Math.asin(Math.max(-1, Math.min(1, zc))) * 180) / Math.PI,
  };
}
