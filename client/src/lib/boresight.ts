import * as THREE from 'three';
import { azElToVec3 } from './sky';

/**
 * A candidate object the "what am I looking at" search can identify, reduced
 * to just what the search needs: a sky position and a way to recover the
 * caller's original data once a match is picked.
 */
export interface BoresightCandidate<T> {
  azimuthDeg: number;
  elevationDeg: number;
  data: T;
}

export interface BoresightMatch<T> {
  data: T;
  /** Angular separation between the camera's look direction and the object. */
  separationDeg: number;
}

/**
 * Widest angular separation still considered "centred" — beyond this, nothing
 * is close enough to the crosshair to call a match. Loose enough to forgive
 * imprecise aiming (dragging a 3D view to point exactly at a small marker is
 * fiddly), tight enough that "identify" doesn't grab something off to the
 * side that merely happens to be the least-far candidate.
 */
export const BORESIGHT_THRESHOLD_DEG = 8;

/**
 * Find whichever candidate sits closest to the camera's current look
 * direction, among candidates within BORESIGHT_THRESHOLD_DEG. Used by the
 * "what am I looking at" identify button: rather than requiring a precise
 * click on a small marker, it identifies whatever the user has roughly
 * centred by dragging the view.
 */
export function findBoresightMatch<T>(
  camera: THREE.Camera,
  candidates: Array<BoresightCandidate<T>>
): BoresightMatch<T> | null {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);

  let best: BoresightMatch<T> | null = null;
  const candidateDir = new THREE.Vector3();

  for (const candidate of candidates) {
    const [x, y, z] = azElToVec3(candidate.azimuthDeg, candidate.elevationDeg, 1);
    candidateDir.set(x, y, z);

    const cosAngle = THREE.MathUtils.clamp(forward.dot(candidateDir), -1, 1);
    const separationDeg = (Math.acos(cosAngle) * 180) / Math.PI;

    if (separationDeg > BORESIGHT_THRESHOLD_DEG) continue;
    if (!best || separationDeg < best.separationDeg) {
      best = { data: candidate.data, separationDeg };
    }
  }

  return best;
}
