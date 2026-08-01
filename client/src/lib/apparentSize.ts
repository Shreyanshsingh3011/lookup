import { Astronomy } from './astronomy';

/**
 * How big the planets actually are in the sky, and how to draw them without
 * lying about it.
 *
 * The app used to carry a hardcoded size per body. Measured against reality
 * those were exaggerated by 7x for the Moon and 1586x for Mars — so the
 * relative sizes were wrong by a factor of 220, Mercury and Mars came out in
 * the wrong order, and the picture taught you that Jupiter and the Moon are
 * comparable objects in the sky. Jupiter is about one sixtieth of the Moon's
 * width.
 *
 * The honest tension is that you cannot both draw planets as visible discs and
 * keep their relative sizes true: the range from Mars to the Moon spans a
 * factor of four hundred, and at true scale a planet is a point of light —
 * which is, of course, exactly what a planet looks like. So both are offered,
 * and the enhanced view uses a transformation that is *monotonic*, meaning the
 * ordering is right even where the ratios are compressed.
 */

/** Equatorial radii in km (IAU values). */
const EQUATORIAL_RADIUS_KM: Record<string, number> = {
  Sun: 695_700,
  Moon: 1_737.4,
  Mercury: 2_439.7,
  Venus: 6_051.8,
  Mars: 3_389.5,
  Jupiter: 71_492,
  Saturn: 60_268,
};

const KM_PER_AU = 149_597_870.7;

/**
 * True apparent diameter in degrees, or null for a body we have no radius for.
 *
 * Distance comes from the same ephemeris that places the body in the sky, so
 * the disc and its position can never disagree.
 */
export function apparentDiameterDeg(body: string, date: Date): number | null {
  const radiusKm = EQUATORIAL_RADIUS_KM[body];
  if (!radiusKm) return null;

  try {
    const vector =
      body === 'Moon'
        ? Astronomy.GeoMoon(date)
        : Astronomy.GeoVector(body as Parameters<typeof Astronomy.GeoVector>[0], date, true);
    const distanceAu = Math.hypot(vector.x, vector.y, vector.z);
    if (!Number.isFinite(distanceAu) || distanceAu <= 0) return null;

    return (2 * Math.atan(radiusKm / (distanceAu * KM_PER_AU)) * 180) / Math.PI;
  } catch {
    return null;
  }
}

/** Arcseconds, which is the unit planetary diameters are actually quoted in. */
export function toArcseconds(degrees: number): number {
  return degrees * 3600;
}

/**
 * Reference body for the enhanced view: everything is sized relative to the
 * Moon, which is the one object whose true size people already have an
 * intuition for.
 */
const REFERENCE_DIAMETER_DEG = 0.5182; // Moon at its mean distance
const REFERENCE_DRAWN_DEG = 3.4;

/**
 * How hard the size range is compressed in the enhanced view.
 *
 * At 1 this is true scale. At 0 every body is the same size. The value here
 * keeps Mars — the smallest disc, at a little over one arcsecond — large
 * enough to see while leaving Jupiter visibly the biggest planet. Being a
 * power law it is strictly increasing, so the *order* of the discs is always
 * correct even though the ratios are not.
 */
const COMPRESSION = 0.35;

export type ScaleMode = 'enhanced' | 'true';

/**
 * Angular diameter to actually draw, in degrees.
 *
 * In 'true' mode this is simply reality, and the planets become the points of
 * light they really are — zooming in then behaves like a telescope, growing
 * them back into discs.
 */
export function drawnDiameterDeg(trueDiameterDeg: number, mode: ScaleMode): number {
  if (mode === 'true') return trueDiameterDeg;
  const ratio = trueDiameterDeg / REFERENCE_DIAMETER_DEG;
  return REFERENCE_DRAWN_DEG * Math.pow(ratio, COMPRESSION);
}

/**
 * Radius of the sphere to place on a dome of the given radius so it subtends
 * `diameterDeg`.
 */
export function sphereRadiusFor(diameterDeg: number, domeRadius: number): number {
  return domeRadius * Math.tan((diameterDeg * Math.PI) / 360);
}

/** How many times larger than life a body is being drawn. */
export function exaggerationFactor(trueDiameterDeg: number, drawnDeg: number): number {
  return trueDiameterDeg > 0 ? drawnDeg / trueDiameterDeg : 1;
}

/**
 * Apparent diameter in words, in the units astronomers use.
 *
 * The Moon and Sun are near half a degree and read naturally that way; a
 * planet is a few arcseconds and does not.
 */
export function describeApparentSize(diameterDeg: number): string {
  const arcsec = toArcseconds(diameterDeg);
  if (arcsec >= 600) return `${diameterDeg.toFixed(2)}° across`;
  if (arcsec >= 10) return `${arcsec.toFixed(1)}″ across`;
  return `${arcsec.toFixed(1)}″ across`;
}
