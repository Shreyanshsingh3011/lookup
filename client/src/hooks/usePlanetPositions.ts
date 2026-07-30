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
