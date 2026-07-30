/**
 * Client-side mirror of the server's ExplainSubject union (server/src/explain.ts).
 * Kept in sync by hand — the client and server aren't in a shared package, and
 * this is small enough that a build-time codegen step would be overkill.
 */
export type ExplainSubject =
  | {
      kind: 'satellite';
      name: string;
      altitudeKm: number;
      speedKmS: number;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      illuminated: boolean;
      nextPassTime: string | null;
    }
  | {
      kind: 'planet';
      name: string;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      magnitude: number | null;
      illuminatedFraction: number | null;
    }
  | {
      kind: 'star';
      name: string;
      magnitude: number;
      elevationDeg: number;
      azimuthDeg: number;
      direction: string;
      constellation: string | null;
    };

export interface ExplainResult {
  explanation: string;
  source: 'ai' | 'template';
}
