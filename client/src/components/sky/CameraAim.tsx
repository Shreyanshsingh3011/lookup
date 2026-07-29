import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface AimTarget {
  azimuthDeg: number;
  elevationDeg: number;
}

/** The subset of OrbitControls we drive programmatically. */
interface AimableControls {
  getAzimuthalAngle(): number;
  getPolarAngle(): number;
  setAzimuthalAngle(value: number): void;
  setPolarAngle(value: number): void;
  update(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/**
 * Convert a look direction to OrbitControls' spherical angles.
 *
 * The camera orbits the dome centre and always faces it, so the camera sits
 * opposite the direction being looked at:
 *   cameraPos = -viewDir * distance
 * Expanding that against OrbitControls' (polar, azimuthal) parameterisation
 * gives polar = acos(-sin el) and azimuthal = -az.
 */
function toControlAngles(target: AimTarget): { polar: number; azimuthal: number } {
  const el = THREE.MathUtils.degToRad(target.elevationDeg);
  const az = THREE.MathUtils.degToRad(target.azimuthDeg);
  return { polar: Math.acos(-Math.sin(el)), azimuthal: -az };
}

/** Shortest signed angular delta, so aiming never takes the long way round. */
function shortestAngle(delta: number): number {
  let d = delta;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Smoothly swings the view to face `target`. Any manual camera interaction
 * cancels the animation, so the user is never fighting the camera.
 */
export function CameraAim({ target }: { target: AimTarget | null }) {
  const controls = useThree((s) => s.controls) as AimableControls | null;
  const desired = useRef<{ polar: number; azimuthal: number } | null>(null);

  useEffect(() => {
    desired.current = target ? toControlAngles(target) : null;
  }, [target]);

  // Hand control back the moment the user grabs the sky.
  useEffect(() => {
    if (!controls) return;
    const cancel = () => {
      desired.current = null;
    };
    controls.addEventListener('start', cancel);
    return () => controls.removeEventListener('start', cancel);
  }, [controls]);

  useFrame((_, delta) => {
    const goal = desired.current;
    if (!controls || !goal) return;

    const currentAzimuthal = controls.getAzimuthalAngle();
    const currentPolar = controls.getPolarAngle();
    const deltaAzimuthal = shortestAngle(goal.azimuthal - currentAzimuthal);
    const deltaPolar = goal.polar - currentPolar;

    // Exponential approach: frame-rate independent and settles smoothly.
    const t = 1 - Math.exp(-delta * 5);
    controls.setAzimuthalAngle(currentAzimuthal + deltaAzimuthal * t);
    controls.setPolarAngle(currentPolar + deltaPolar * t);
    controls.update();

    if (Math.abs(deltaAzimuthal) < 0.002 && Math.abs(deltaPolar) < 0.002) {
      desired.current = null;
    }
  });

  return null;
}
