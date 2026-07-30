import { useMemo } from 'react';
import { Astronomy } from '../lib/astronomy';

/**
 * The classical naked-eye bodies. Uranus and Neptune are omitted: at mag 5.7+
 * they are not what someone scanning the sky is looking for, and they add
 * clutter next to the objects that matter.
 */
export const PLANET_BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'] as const;

export interface PlanetPosition {
  body: (typeof PLANET_BODIES)[number];
  azimuthDeg: number;
  elevationDeg: number;
  magnitude: number | null;
  /** Illuminated fraction, for the Moon and inner planets. */
  phase: number | null;
}

/**
 * Positions for the Sun, Moon, and naked-eye planets at a given time and
 * observer. Shared by the visual PlanetLayer and the "what am I looking at"
 * boresight search, so both agree on exactly the same set of bodies rather
 * than risking two slightly different computations drifting apart.
 */
export function usePlanetPositions(
  displayTime: Date,
  observerLatitude: number,
  observerLongitude: number,
  observerElevation: number
): PlanetPosition[] {
  return useMemo(() => {
    const observer = new Astronomy.Observer(observerLatitude, observerLongitude, observerElevation);
    const out: PlanetPosition[] = [];

    for (const body of PLANET_BODIES) {
      try {
        const astroBody = body as Parameters<typeof Astronomy.Equator>[0];
        // Apparent coordinates of date, including aberration.
        const eq = Astronomy.Equator(astroBody, displayTime, observer, true, true);
        // Refraction is left off (an omitted argument means no correction) to
        // stay consistent with how satellite elevations are computed elsewhere.
        const hor = Astronomy.Horizon(displayTime, observer, eq.ra, eq.dec, undefined);
        if (hor.altitude < -2) continue;

        let magnitude: number | null = null;
        let phase: number | null = null;
        if (body !== 'Sun') {
          try {
            const illum = Astronomy.Illumination(astroBody, displayTime);
            magnitude = illum.mag;
            phase = illum.phase_fraction;
          } catch {
            // Illumination is undefined for some body/time combinations.
          }
        }

        out.push({ body, azimuthDeg: hor.azimuth, elevationDeg: hor.altitude, magnitude, phase });
      } catch {
        // Skip any body astronomy-engine cannot place at this instant.
      }
    }
    return out;
  }, [displayTime, observerLatitude, observerLongitude, observerElevation]);
}

/**
 * The Sun's sky position, whether or not it is up.
 *
 * Separate from usePlanetPositions because that hook drops anything below the
 * horizon — correct for deciding what to *draw*, wrong for deciding how to
 * *light*. Planet phases are measured against the Sun, and at night the Sun
 * is precisely the thing that has just been filtered out, so reusing that
 * list would leave every planet rendered fully lit exactly when the app is
 * actually being used.
 */
export function useSunDirection(
  displayTime: Date,
  observerLatitude: number,
  observerLongitude: number,
  observerElevation: number
): { azimuthDeg: number; elevationDeg: number } | null {
  return useMemo(() => {
    try {
      const observer = new Astronomy.Observer(observerLatitude, observerLongitude, observerElevation);
      const sun = 'Sun' as Parameters<typeof Astronomy.Equator>[0];
      const eq = Astronomy.Equator(sun, displayTime, observer, true, true);
      const hor = Astronomy.Horizon(displayTime, observer, eq.ra, eq.dec, undefined);
      return { azimuthDeg: hor.azimuth, elevationDeg: hor.altitude };
    } catch {
      return null;
    }
  }, [displayTime, observerLatitude, observerLongitude, observerElevation]);
}
