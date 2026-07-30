import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { LookDirection } from '../../lib/deviceOrientation';

/** The subset of OrbitControls this drives, matching CameraAim's approach. */
interface AimableControls {
  setAzimuthalAngle(value: number): void;
  setPolarAngle(value: number): void;
  update(): void;
  enabled: boolean;
}

/**
 * Points the dome camera wherever the phone is pointing.
 *
 * Uses the same spherical parameterisation as CameraAim: the camera orbits
 * the dome centre and always faces it, so it sits opposite the direction
 * being looked at, giving polar = acos(-sin(elevation)) and azimuthal =
 * -azimuth.
 *
 * Smoothing already happened upstream in useDeviceOrientation, so this
 * applies each reading directly rather than easing again — double-smoothing
 * would make the view feel laggy and detached from the handset.
 *
 * While active, manual drag is disabled: the two would fight, and the sensor
 * would always win the next frame.
 */
export function OrientationCamera({ look }: { look: LookDirection | null }) {
  const controls = useThree((s) => s.controls) as (AimableControls & THREE.EventDispatcher) | null;

  useEffect(() => {
    if (!controls) return;
    const previouslyEnabled = controls.enabled;
    controls.enabled = false;
    return () => {
      controls.enabled = previouslyEnabled;
    };
  }, [controls]);

  useEffect(() => {
    if (!controls || !look) return;

    const elevation = THREE.MathUtils.degToRad(look.elevationDeg);
    const azimuth = THREE.MathUtils.degToRad(look.azimuthDeg);

    controls.setAzimuthalAngle(-azimuth);
    // Clamped because OrbitControls rejects a polar angle outside [0, PI], and
    // a phone pointed at the ground legitimately produces one at the limit.
    controls.setPolarAngle(THREE.MathUtils.clamp(Math.acos(-Math.sin(elevation)), 0.001, Math.PI - 0.001));
    controls.update();
  }, [controls, look]);

  return null;
}
