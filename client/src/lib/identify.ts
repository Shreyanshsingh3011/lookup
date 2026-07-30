import { azToCompass } from './sky';
import type { LiveSatellite } from '../components/sky/SatelliteMarker';
import type { PlanetPosition } from '../hooks/usePlanetPositions';
import type { ExplainSubject } from './explain';

export interface NamedStar {
  ra: number;
  dec: number;
  mag: number;
  name: string;
  constellation: string | null;
}

/**
 * What the "what am I looking at" boresight search can match against. Only
 * named stars carry a name to identify by, so the unnamed bulk of the star
 * field (down to mag 6) is deliberately not searchable here.
 */
export type IdentifyCandidate =
  | { kind: 'satellite'; sat: LiveSatellite }
  | { kind: 'planet'; planet: PlanetPosition }
  | { kind: 'star'; star: NamedStar; azimuthDeg: number; elevationDeg: number };

/** Convert whichever candidate the boresight search matched into the shape /api/explain expects. */
export function toExplainSubject(candidate: IdentifyCandidate): ExplainSubject {
  switch (candidate.kind) {
    case 'satellite': {
      const { sat } = candidate;
      return {
        kind: 'satellite',
        name: sat.name,
        altitudeKm: sat.sample.altitudeKm,
        speedKmS: sat.sample.speedKmS,
        elevationDeg: sat.sample.elevationDeg,
        azimuthDeg: sat.sample.azimuthDeg,
        direction: azToCompass(sat.sample.azimuthDeg),
        illuminated: sat.sample.illuminated,
        nextPassTime: sat.nextPassTime,
      };
    }
    case 'planet': {
      const { planet } = candidate;
      return {
        kind: 'planet',
        name: planet.body,
        elevationDeg: planet.elevationDeg,
        azimuthDeg: planet.azimuthDeg,
        direction: azToCompass(planet.azimuthDeg),
        magnitude: planet.magnitude,
        illuminatedFraction: planet.phase,
      };
    }
    case 'star': {
      const { star, azimuthDeg, elevationDeg } = candidate;
      return {
        kind: 'star',
        name: star.name,
        magnitude: star.mag,
        elevationDeg,
        azimuthDeg,
        direction: azToCompass(azimuthDeg),
        constellation: star.constellation,
      };
    }
  }
}
