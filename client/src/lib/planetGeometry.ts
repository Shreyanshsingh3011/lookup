import { Astronomy } from './astronomy';

/**
 * Where a planet's moons are, and which way the planet is actually facing.
 *
 * Both were previously either absent or decorative: the spin was a fixed slow
 * turn with a comment admitting it was decoration, and the Galilean moons —
 * the four objects Galileo used to overturn the geocentric model, and the
 * easiest thing in the sky to see change from one night to the next — were not
 * drawn at all.
 */

export type GalileanMoon = 'io' | 'europa' | 'ganymede' | 'callisto';

export const GALILEAN_MOONS: Array<{ id: GalileanMoon; name: string; radiusKm: number }> = [
  { id: 'io', name: 'Io', radiusKm: 1821.6 },
  { id: 'europa', name: 'Europa', radiusKm: 1560.8 },
  { id: 'ganymede', name: 'Ganymede', radiusKm: 2631.2 },
  { id: 'callisto', name: 'Callisto', radiusKm: 2410.3 },
];

export interface MoonOffset {
  id: GalileanMoon;
  name: string;
  /**
   * Offset from Jupiter's centre in units of Jupiter's own radius, in the
   * plane of the sky: +x toward increasing right ascension, +y toward
   * increasing declination.
   *
   * Expressed in planet radii rather than in degrees on purpose. The app draws
   * Jupiter's disc enlarged, and what a telescope actually shows is the moons'
   * separation *relative to the disc* — keeping that ratio is what makes the
   * enlarged view still true to the eyepiece.
   */
  x: number;
  y: number;
  /** Line-of-sight offset, positive when the moon is on the far side. */
  depth: number;
  radiusKm: number;
}

const KM_PER_AU = 149_597_870.7;
const JUPITER_RADIUS_KM = 71_492;

/**
 * Positions of the four Galilean moons, projected onto the plane of the sky.
 *
 * The library returns Jupiter-centric equatorial vectors, so the projection is
 * a change of basis rather than an approximation: build an orthonormal frame
 * with one axis along the line of sight to Jupiter, and read the other two
 * components off directly.
 */
export function galileanMoonOffsets(date: Date): MoonOffset[] {
  let moons: ReturnType<typeof Astronomy.JupiterMoons>;
  let jupiter: { x: number; y: number; z: number };
  try {
    moons = Astronomy.JupiterMoons(date);
    jupiter = Astronomy.GeoVector('Jupiter' as Parameters<typeof Astronomy.GeoVector>[0], date, true);
  } catch {
    return [];
  }

  // Line of sight to Jupiter, and a sky-plane basis around it. "North" is the
  // component along the celestial pole with the line-of-sight part removed,
  // which is exactly the direction declination increases.
  const losLength = Math.hypot(jupiter.x, jupiter.y, jupiter.z);
  if (!Number.isFinite(losLength) || losLength <= 0) return [];
  const los = { x: jupiter.x / losLength, y: jupiter.y / losLength, z: jupiter.z / losLength };

  // Celestial north in this frame is +z.
  const northDot = los.z;
  const north = { x: -los.x * northDot, y: -los.y * northDot, z: 1 - los.z * northDot };
  const northLength = Math.hypot(north.x, north.y, north.z);
  if (northLength < 1e-9) return []; // Jupiter exactly at a celestial pole
  north.x /= northLength;
  north.y /= northLength;
  north.z /= northLength;

  // East completes a right-handed frame: east = north x los.
  const east = {
    x: north.y * los.z - north.z * los.y,
    y: north.z * los.x - north.x * los.z,
    z: north.x * los.y - north.y * los.x,
  };

  const out: MoonOffset[] = [];
  for (const moon of GALILEAN_MOONS) {
    const state = moons[moon.id];
    if (!state) continue;
    const scale = KM_PER_AU / JUPITER_RADIUS_KM;
    out.push({
      id: moon.id,
      name: moon.name,
      x: (state.x * east.x + state.y * east.y + state.z * east.z) * scale,
      y: (state.x * north.x + state.y * north.y + state.z * north.z) * scale,
      depth: (state.x * los.x + state.y * los.y + state.z * los.z) * scale,
      radiusKm: moon.radiusKm,
    });
  }
  return out;
}

export interface RotationState {
  /** Right ascension of the north pole, degrees. */
  poleRaDeg: number;
  /** Declination of the north pole, degrees. */
  poleDecDeg: number;
  /** Rotation angle about the pole, degrees, increasing with the body's spin. */
  spinDeg: number;
}

/**
 * Real pole direction and rotation angle for a body.
 *
 * This is what makes Mars's polar caps point where they actually point and
 * Jupiter turn once every ten hours rather than at whatever rate looked nice.
 */
export function rotationState(body: string, date: Date): RotationState | null {
  try {
    const axis = Astronomy.RotationAxis(body as Parameters<typeof Astronomy.RotationAxis>[0], date);
    if (!Number.isFinite(axis.ra) || !Number.isFinite(axis.dec) || !Number.isFinite(axis.spin)) {
      return null;
    }
    return {
      // The library reports right ascension in hours, as is conventional for
      // that coordinate; everything downstream here works in degrees.
      poleRaDeg: axis.ra * 15,
      poleDecDeg: axis.dec,
      spinDeg: ((axis.spin % 360) + 360) % 360,
    };
  } catch {
    return null;
  }
}

/**
 * How open Saturn's rings are, in degrees.
 *
 * Zero is edge-on, when the rings all but vanish — which happens twice every
 * 29-year orbit and is happening around now. Drawing them at a fixed tilt
 * would show a Saturn that does not exist this year.
 *
 * Derived from the angle between the line of sight and Saturn's equatorial
 * plane, whose normal is its rotation axis.
 */
export function saturnRingOpeningDeg(date: Date): number | null {
  const rotation = rotationState('Saturn', date);
  if (!rotation) return null;

  try {
    const saturn = Astronomy.GeoVector('Saturn' as Parameters<typeof Astronomy.GeoVector>[0], date, true);
    const length = Math.hypot(saturn.x, saturn.y, saturn.z);
    if (!Number.isFinite(length) || length <= 0) return null;

    const ra = (rotation.poleRaDeg * Math.PI) / 180;
    const dec = (rotation.poleDecDeg * Math.PI) / 180;
    const pole = {
      x: Math.cos(dec) * Math.cos(ra),
      y: Math.cos(dec) * Math.sin(ra),
      z: Math.sin(dec),
    };

    // Angle between the pole and the direction *from Saturn to Earth*.
    const toEarth = { x: -saturn.x / length, y: -saturn.y / length, z: -saturn.z / length };
    const cosAngle = pole.x * toEarth.x + pole.y * toEarth.y + pole.z * toEarth.z;
    const clamped = Math.max(-1, Math.min(1, cosAngle));
    // 90 degrees from the pole is edge-on; the complement is the opening.
    return 90 - (Math.acos(clamped) * 180) / Math.PI;
  } catch {
    return null;
  }
}

/**
 * The Moon's libration — the slow wobble that lets us see about 59% of its
 * surface rather than exactly half.
 */
export function moonLibration(date: Date): { latDeg: number; lonDeg: number } | null {
  try {
    const lib = Astronomy.Libration(date);
    if (!Number.isFinite(lib.elat) || !Number.isFinite(lib.elon)) return null;
    return { latDeg: lib.elat, lonDeg: lib.elon };
  } catch {
    return null;
  }
}
