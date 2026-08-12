import { Astronomy } from './astronomy';
import { precessRaDec, raDecToAzEl } from './celestialMath';
import type { Observer } from '../types';

/**
 * Comets and asteroids.
 *
 * These cannot go through the same path as everything else in the app. SGP4
 * models a satellite dragged around by an oblate Earth and is meaningless
 * here; astronomy-engine carries the planets as fitted series and has no
 * notion of an arbitrary small body. So this solves the two-body problem from
 * published orbital elements directly.
 *
 * All three conic sections are handled, which is the point of doing it
 * properly: most asteroids are comfortably elliptical, many bright comets sit
 * within a whisker of parabolic where the usual Kepler iteration converges
 * slowly or not at all, and interstellar visitors are frankly hyperbolic. A
 * solver that assumed ellipses would quietly produce nonsense for exactly the
 * objects people care most about.
 */

/** Gaussian gravitational constant, AU^1.5 per day. */
const GAUSS_K = 0.017_202_098_95;
/** Obliquity of the ecliptic at J2000, degrees. */
const OBLIQUITY_DEG = 23.439_291_1;
const DEG = Math.PI / 180;

export type BodyKind = 'comet' | 'asteroid';

/**
 * Orbital elements as the small-body catalogues publish them.
 *
 * Perihelion distance rather than semi-major axis, because `a` is infinite for
 * a parabola and negative for a hyperbola while `q` is finite and positive for
 * every orbit there is.
 */
export interface OrbitalElements {
  /** Eccentricity. */
  e: number;
  /** Perihelion distance, AU. */
  q: number;
  /** Time of perihelion passage. */
  tp: Date;
  /** Inclination to the ecliptic, degrees. */
  i: number;
  /** Longitude of the ascending node, degrees. */
  node: number;
  /** Argument of perihelion, degrees. */
  peri: number;
}

export interface SmallBody {
  id: string;
  name: string;
  kind: BodyKind;
  elements: OrbitalElements;
  /** Absolute magnitude: H for an asteroid, M1 for a comet. */
  absoluteMagnitude: number | null;
  /** Slope parameter G for an asteroid, or activity index K1 for a comet. */
  slope: number | null;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Solve Kepler's equation for an elliptical orbit.
 *
 * Newton's method, started from a guess that stays sane at high eccentricity —
 * the naive E = M start converges slowly above about e = 0.8, which is most
 * comets.
 */
function solveElliptic(meanAnomaly: number, e: number): number {
  const M = normaliseRadians(meanAnomaly);
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 60; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const step = f / fp;
    E -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return E;
}

/** Solve the hyperbolic analogue, M = e·sinh H − H. */
function solveHyperbolic(meanAnomaly: number, e: number): number {
  const M = meanAnomaly;
  // A poor start diverges outright here, so begin from the asymptotic form.
  let H = Math.sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
  for (let i = 0; i < 100; i++) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    const step = f / fp;
    H -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return H;
}

/** How close to 1 counts as parabolic. */
const PARABOLIC_TOLERANCE = 1e-8;

/**
 * True anomaly and heliocentric distance at a given time.
 *
 * Split by conic section rather than forced through one formula: the
 * elliptical and hyperbolic solutions both degenerate at e = 1, where Barker's
 * equation gives the answer in closed form with no iteration at all.
 */
export function anomalyAt(elements: OrbitalElements, date: Date): { trueAnomaly: number; radiusAu: number } {
  const { e, q, tp } = elements;
  const daysSincePerihelion = (date.getTime() - tp.getTime()) / 86_400_000;

  if (Math.abs(e - 1) < PARABOLIC_TOLERANCE) {
    // Barker's equation, solved by Cardano rather than iterated.
    const meanAnomaly = (GAUSS_K * daysSincePerihelion) / Math.sqrt(2 * q * q * q);
    const A = 1.5 * meanAnomaly;
    const B = Math.cbrt(A + Math.sqrt(A * A + 1));
    const s = B - 1 / B;
    return { trueAnomaly: 2 * Math.atan(s), radiusAu: q * (1 + s * s) };
  }

  if (e < 1) {
    const a = q / (1 - e);
    const n = GAUSS_K / Math.sqrt(a * a * a);
    const E = solveElliptic(n * daysSincePerihelion, e);
    const trueAnomaly =
      2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    return { trueAnomaly, radiusAu: a * (1 - e * Math.cos(E)) };
  }

  // Hyperbolic: a is negative, and −a is the quantity with physical size.
  const a = q / (1 - e);
  const n = GAUSS_K / Math.sqrt(-a * a * a);
  const H = solveHyperbolic(n * daysSincePerihelion, e);
  const trueAnomaly =
    2 * Math.atan2(Math.sqrt(e + 1) * Math.sinh(H / 2), Math.sqrt(e - 1) * Math.cosh(H / 2));
  return { trueAnomaly, radiusAu: a * (1 - e * Math.cosh(H)) };
}

/** Heliocentric position in the J2000 ecliptic frame, AU. */
export function heliocentricEcliptic(elements: OrbitalElements, date: Date): Vector3 {
  const { trueAnomaly, radiusAu } = anomalyAt(elements, date);
  const u = elements.peri * DEG + trueAnomaly; // argument of latitude
  const node = elements.node * DEG;
  const i = elements.i * DEG;

  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  const cosI = Math.cos(i);
  const sinI = Math.sin(i);

  return {
    x: radiusAu * (cosNode * cosU - sinNode * sinU * cosI),
    y: radiusAu * (sinNode * cosU + cosNode * sinU * cosI),
    z: radiusAu * (sinU * sinI),
  };
}

/** Rotate an ecliptic vector into the equatorial frame both share at J2000. */
export function eclipticToEquatorial(v: Vector3): Vector3 {
  const eps = OBLIQUITY_DEG * DEG;
  return {
    x: v.x,
    y: v.y * Math.cos(eps) - v.z * Math.sin(eps),
    z: v.y * Math.sin(eps) + v.z * Math.cos(eps),
  };
}

export function equatorialToEcliptic(v: Vector3): Vector3 {
  const eps = OBLIQUITY_DEG * DEG;
  return {
    x: v.x,
    y: v.y * Math.cos(eps) + v.z * Math.sin(eps),
    z: -v.y * Math.sin(eps) + v.z * Math.cos(eps),
  };
}

export interface BodyPosition {
  raDeg: number;
  decDeg: number;
  /** Distance from Earth, AU. */
  distanceAu: number;
  /** Distance from the Sun, AU. */
  heliocentricAu: number;
  /** Sun–body–Earth angle, degrees. */
  phaseAngleDeg: number;
  /** Apparent magnitude, or null where the catalogue gave no photometry. */
  magnitude: number | null;
  azimuthDeg: number;
  elevationDeg: number;
}

/**
 * Where a small body appears, and how bright.
 *
 * Earth's own position comes from astronomy-engine rather than from elements,
 * since it is known far better than any two-body propagation of it would be.
 */
export function positionOf(
  body: SmallBody,
  observer: Observer,
  date: Date,
  lstRad: number
): BodyPosition {
  const helio = heliocentricEcliptic(body.elements, date);

  // Earth's heliocentric vector, converted from the equatorial frame
  // astronomy-engine returns into the ecliptic one the elements live in.
  const earthEq = Astronomy.HelioVector(Astronomy.Body.Earth, date);
  const earth = equatorialToEcliptic({ x: earthEq.x, y: earthEq.y, z: earthEq.z });

  const geo = { x: helio.x - earth.x, y: helio.y - earth.y, z: helio.z - earth.z };
  const distanceAu = Math.hypot(geo.x, geo.y, geo.z);
  const heliocentricAu = Math.hypot(helio.x, helio.y, helio.z);
  const earthSunAu = Math.hypot(earth.x, earth.y, earth.z);

  const equatorial = eclipticToEquatorial(geo);
  let raDeg = (Math.atan2(equatorial.y, equatorial.x) * 180) / Math.PI;
  if (raDeg < 0) raDeg += 360;
  const decDeg = (Math.asin(equatorial.z / distanceAu) * 180) / Math.PI;

  // Sun–body–Earth angle, by the cosine rule on the triangle.
  const cosPhase =
    (heliocentricAu * heliocentricAu + distanceAu * distanceAu - earthSunAu * earthSunAu) /
    (2 * heliocentricAu * distanceAu);
  const phaseAngleDeg = (Math.acos(Math.max(-1, Math.min(1, cosPhase))) * 180) / Math.PI;

  // The elements, and therefore this position, are J2000 — see
  // eclipticToEquatorial. The star field and the planets are both drawn at the
  // equinox of date, so plotting a comet straight from J2000 would place it
  // consistently off against the sky around it.
  const ofDate = precessRaDec(raDeg, decDeg, date);
  const { azimuthDeg, elevationDeg } = raDecToAzEl(
    ofDate.raDeg,
    ofDate.decDeg,
    lstRad,
    observer.latitude
  );

  return {
    raDeg,
    decDeg,
    distanceAu,
    heliocentricAu,
    phaseAngleDeg,
    magnitude: apparentMagnitude(body, heliocentricAu, distanceAu, phaseAngleDeg),
    azimuthDeg,
    elevationDeg,
  };
}

/**
 * Apparent magnitude.
 *
 * Two quite different formulae, because they describe two quite different
 * things. An asteroid is a rock reflecting sunlight and the H–G system
 * predicts it well. A comet is an unpredictable cloud of gas and dust whose
 * brightness depends on how much of it happens to be sublimating, and the
 * M1/K1 relation is an empirical fit that routinely misses by a couple of
 * magnitudes in either direction. Both are returned; only one of them deserves
 * to be trusted, and the interface says which.
 */
export function apparentMagnitude(
  body: SmallBody,
  heliocentricAu: number,
  distanceAu: number,
  phaseAngleDeg: number
): number | null {
  if (body.absoluteMagnitude === null) return null;
  if (heliocentricAu <= 0 || distanceAu <= 0) return null;

  if (body.kind === 'comet') {
    // m = M1 + 5·log10(Δ) + K1·log10(r), with the usual K1 = 10 when unstated.
    const k1 = body.slope ?? 10;
    return body.absoluteMagnitude + 5 * Math.log10(distanceAu) + k1 * Math.log10(heliocentricAu);
  }

  // H–G system. The two phase functions describe backscatter and forward
  // scatter; G weights between them.
  const g = body.slope ?? 0.15;
  const phase = Math.min(phaseAngleDeg, 120) * DEG;
  const tanHalf = Math.tan(phase / 2);
  const phi1 = Math.exp(-3.33 * tanHalf ** 0.63);
  const phi2 = Math.exp(-1.87 * tanHalf ** 1.22);
  const blended = (1 - g) * phi1 + g * phi2;
  if (!(blended > 0)) return null;

  return (
    body.absoluteMagnitude +
    5 * Math.log10(heliocentricAu * distanceAu) -
    2.5 * Math.log10(blended)
  );
}

/** Orbital period in days, or null for an orbit that never returns. */
export function periodDays(elements: OrbitalElements): number | null {
  if (elements.e >= 1) return null;
  const a = elements.q / (1 - elements.e);
  return (2 * Math.PI * Math.sqrt(a * a * a)) / GAUSS_K;
}

function normaliseRadians(radians: number): number {
  const twoPi = 2 * Math.PI;
  return ((radians % twoPi) + twoPi) % twoPi;
}

/**
 * Orbital elements from a heliocentric state vector.
 *
 * Exists so the solver can be checked against something that knows the answer:
 * take a planet's state from the fitted planetary theory, reduce it to
 * elements, propagate those forward with the code below, and compare. Any
 * error in the conic solving shows up immediately, with no hardcoded positions
 * to be wrong about.
 */
export function elementsFromState(
  position: Vector3,
  velocity: Vector3,
  epoch: Date
): OrbitalElements {
  const mu = GAUSS_K * GAUSS_K; // AU^3 / day^2
  const r = Math.hypot(position.x, position.y, position.z);
  const v2 = velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2;

  // Specific angular momentum.
  const hx = position.y * velocity.z - position.z * velocity.y;
  const hy = position.z * velocity.x - position.x * velocity.z;
  const hz = position.x * velocity.y - position.y * velocity.x;
  const h = Math.hypot(hx, hy, hz);

  const inclination = Math.acos(Math.max(-1, Math.min(1, hz / h)));
  const nodeVectorX = -hy;
  const nodeVectorY = hx;
  const nodeMagnitude = Math.hypot(nodeVectorX, nodeVectorY);
  let node = nodeMagnitude > 1e-12 ? Math.atan2(nodeVectorY, nodeVectorX) : 0;

  // Eccentricity vector points at perihelion.
  const rv = position.x * velocity.x + position.y * velocity.y + position.z * velocity.z;
  const ex = ((v2 - mu / r) * position.x - rv * velocity.x) / mu;
  const ey = ((v2 - mu / r) * position.y - rv * velocity.y) / mu;
  const ez = ((v2 - mu / r) * position.z - rv * velocity.z) / mu;
  const e = Math.hypot(ex, ey, ez);

  let peri =
    nodeMagnitude > 1e-12
      ? Math.acos(
          Math.max(
            -1,
            Math.min(1, (nodeVectorX * ex + nodeVectorY * ey) / (nodeMagnitude * e))
          )
        )
      : Math.atan2(ey, ex);
  if (ez < 0) peri = 2 * Math.PI - peri;

  // True anomaly now, then back to a time of perihelion passage.
  let trueAnomaly = Math.acos(
    Math.max(-1, Math.min(1, (ex * position.x + ey * position.y + ez * position.z) / (e * r)))
  );
  if (rv < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;

  const a = 1 / (2 / r - v2 / mu);
  const q = a * (1 - e);

  let daysSincePerihelion: number;
  if (e < 1) {
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2), Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2));
    const M = E - e * Math.sin(E);
    daysSincePerihelion = M / (GAUSS_K / Math.sqrt(a * a * a));
  } else {
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(trueAnomaly / 2));
    const M = e * Math.sinh(H) - H;
    daysSincePerihelion = M / (GAUSS_K / Math.sqrt(-a * a * a));
  }

  if (node < 0) node += 2 * Math.PI;

  return {
    e,
    q,
    tp: new Date(epoch.getTime() - daysSincePerihelion * 86_400_000),
    i: inclination / DEG,
    node: node / DEG,
    peri: peri / DEG,
  };
}
