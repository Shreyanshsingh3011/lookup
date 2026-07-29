import { useRef, useState, type ReactNode } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * An `Html` overlay that only mounts while its anchor is actually on screen.
 *
 * drei's `Html` positions elements by projecting them to screen space, and a
 * perspective projection maps points behind the camera back onto the viewport
 * inverted — so without a guard the southern cardinal labels appear while
 * you're facing north.
 *
 * The test projects the anchor's *world* position and checks it lands within
 * the viewport. That beats a fixed "is it roughly in front" dot product on two
 * counts: it adapts automatically to zoom and aspect ratio, and it keeps DOM
 * nodes from being created for objects far outside the frame.
 *
 * World position, not the `position` prop: these labels are usually mounted
 * inside an already-positioned group (a satellite, a planet) with a local
 * offset of zero.
 */
export function FrontFacingHtml({
  position = [0, 0, 0],
  children,
  margin = 1.15,
  zIndexRange,
  offsetYPx = 0,
}: {
  position?: [number, number, number];
  children: ReactNode;
  /** Normalised-device slack, so labels don't pop exactly at the frame edge. */
  margin?: number;
  zIndexRange?: [number, number];
  /**
   * Screen-space nudge, applied after projection. Offsetting a label in world
   * space would swing it around unpredictably as the camera orbits — near the
   * zenith a world-space "up" offset points almost at the camera.
   */
  offsetYPx?: number;
}) {
  const [onScreen, setOnScreen] = useState(false);
  const anchorRef = useRef<THREE.Group>(null);
  const worldPos = useRef(new THREE.Vector3());
  const projected = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    anchor.getWorldPosition(worldPos.current);

    // Camera space first: the camera looks down -Z, so anything with z >= 0 is
    // behind it and must be rejected before trusting projected coordinates.
    projected.current.copy(worldPos.current).applyMatrix4(camera.matrixWorldInverse);
    const inFrontOfCamera = projected.current.z < 0;

    let visible = false;
    if (inFrontOfCamera) {
      projected.current.copy(worldPos.current).project(camera);
      visible =
        Math.abs(projected.current.x) <= margin && Math.abs(projected.current.y) <= margin;
    }

    setOnScreen((prev) => (prev === visible ? prev : visible));
  });

  return (
    <group ref={anchorRef} position={position}>
      {onScreen && (
        <Html center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={zIndexRange}>
          <div style={offsetYPx ? { transform: `translateY(${offsetYPx}px)` } : undefined}>{children}</div>
        </Html>
      )}
    </group>
  );
}
