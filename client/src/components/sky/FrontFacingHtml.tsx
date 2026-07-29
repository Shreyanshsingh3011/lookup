import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * An `Html` overlay that hides itself when its anchor is behind the camera.
 *
 * drei's `Html` positions elements by projecting them to screen space, and a
 * perspective projection maps points behind the camera back onto the viewport
 * inverted — so without this guard the southern cardinal labels appear on
 * screen while you're facing north.
 *
 * The camera sits at the dome's centre, so a point's direction from the origin
 * is also its direction from the camera, making this a cheap dot product.
 */
export function FrontFacingHtml({
  position,
  children,
  threshold = 0.15,
  zIndexRange,
  offsetYPx = 0,
}: {
  position: [number, number, number];
  children: ReactNode;
  threshold?: number;
  zIndexRange?: [number, number];
  /**
   * Screen-space nudge, applied after projection. Offsetting a label in world
   * space would swing it around unpredictably as the camera orbits — near the
   * zenith a world-space "up" offset points almost at the camera.
   */
  offsetYPx?: number;
}) {
  const [inFront, setInFront] = useState(true);
  const direction = useMemo(() => new THREE.Vector3(...position).normalize(), [position]);
  const forward = useRef(new THREE.Vector3());

  useFrame(({ camera }) => {
    camera.getWorldDirection(forward.current);
    const visible = forward.current.dot(direction) > threshold;
    setInFront((prev) => (prev === visible ? prev : visible));
  });

  if (!inFront) return null;

  return (
    <Html position={position} center style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={zIndexRange}>
      <div style={offsetYPx ? { transform: `translateY(${offsetYPx}px)` } : undefined}>{children}</div>
    </Html>
  );
}
