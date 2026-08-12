import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { upFromRoll, type LookDirection } from '../../lib/deviceOrientation';

/** The subset of OrbitControls this needs to stand down. */
interface AimableControls {
  update(): void;
  enabled: boolean;
}

/**
 * Points the dome camera wherever the phone is pointing, roll included.
 *
 * This used to aim through the controls' spherical angles, the same way
 * CameraAim does, which is why the roll was missing: OrbitControls parameterises
 * the camera by azimuth and polar angle about a fixed world up, so there is
 * nowhere in that description to put a rotation about the view axis. The
 * direction was right at any attitude while the sky's rotation on screen was
 * only right in portrait — held sideways, the constellations came out turned by
 * up to ninety degrees from what was actually behind the handset.
 *
 * So the camera is driven directly here. Position stays on the far side of the
 * dome centre from the look direction, preserving the rig's geometry, and the
 * orientation comes from `lookAt` with an up vector rebuilt from the reported
 * roll — see upFromRoll, which is checked against the rotation matrix's own
 * second column across a grid of attitudes.
 *
 * Applied in a frame callback rather than an effect, and that is not incidental:
 * drei's OrbitControls calls update() every frame at priority -1, so anything
 * written to the camera outside the frame loop is overwritten before it is seen.
 * Default priority runs after, so this wins.
 *
 * Smoothing already happened upstream in useDeviceOrientation, so each reading
 * is applied as it arrives rather than eased again — double-smoothing would make
 * the view feel detached from the handset.
 *
 * While active, manual drag is disabled: the two would fight, and the sensor
 * would always win the next frame.
 */
export function OrientationCamera({ look }: { look: LookDirection | null }) {
  const controls = useThree((s) => s.controls) as (AimableControls & THREE.EventDispatcher) | null;
  const camera = useThree((s) => s.camera);

  // Read in the frame loop, so a new sample does not need a re-render to land.
  const lookRef = useRef<LookDirection | null>(look);
  lookRef.current = look;

  /**
   * The rig's orbit radius, captured before anything is moved.
   *
   * Taken from the camera rather than hardcoded so this cannot drift out of step
   * with the distance SkyDome chose. It is deliberately tiny — the viewer stands
   * at the observer's own position — so a zero would mean an unusable camera and
   * the fallback keeps it sane.
   */
  const radius = useRef(0.02);
  useEffect(() => {
    const current = camera.position.length();
    if (current > 1e-6) radius.current = current;
  }, [camera]);

  // Stand the controls down for as long as the sensor is driving.
  useEffect(() => {
    if (!controls) return;
    const previouslyEnabled = controls.enabled;
    controls.enabled = false;
    return () => {
      controls.enabled = previouslyEnabled;
    };
  }, [controls]);

  // Restore an up vector the controls can live with on the way out. Leaving the
  // camera rolled would tilt the whole dome the moment drag resumed, since
  // OrbitControls assumes its own up is world up.
  useEffect(() => {
    return () => {
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    };
  }, [camera]);

  const forward = useRef(new THREE.Vector3());
  const up = useRef(new THREE.Vector3());

  useFrame(() => {
    const current = lookRef.current;
    if (!current) return;

    const az = THREE.MathUtils.degToRad(current.azimuthDeg);
    const el = THREE.MathUtils.degToRad(current.elevationDeg);

    // Scene axes are +X east, +Y up, -Z north, so an east/north/up vector
    // (e, n, u) becomes (e, u, -n) here. Same mapping for both vectors below.
    const cosEl = Math.cos(el);
    forward.current.set(cosEl * Math.sin(az), Math.sin(el), -cosEl * Math.cos(az));

    const [ue, un, uu] = upFromRoll(current.azimuthDeg, current.elevationDeg, current.rollDeg);
    up.current.set(ue, uu, -un);

    camera.up.copy(up.current);
    camera.position.copy(forward.current).multiplyScalar(-radius.current);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  });

  return null;
}
