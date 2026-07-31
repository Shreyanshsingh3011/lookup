import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { raDecToAzEl } from '../../lib/celestial';
import {
  activeShowers,
  describeRate,
  expectedRateRange,
  type ShowerActivity,
} from '../../lib/meteorShowers';
import { FrontFacingHtml } from './FrontFacingHtml';

/** Between the stars and the satellites — meteors burn up around 90 km. */
const METEOR_RADIUS = DOME_RADIUS * 0.99;

const RADIANT_COLOR = '#a78bfa';

/** How many streaks are in flight at once, per shower. Visual, not a rate. */
const STREAKS_PER_SHOWER = 6;

interface Streak {
  /** Direction the streak travels, tangent to the dome at the radiant. */
  bearing: number;
  /** Angular distance from the radiant, in scene units along the dome. */
  distance: number;
  speed: number;
  length: number;
  life: number;
  maxLife: number;
}

function newStreak(): Streak {
  const maxLife = 0.45 + Math.random() * 0.75;
  return {
    bearing: Math.random() * Math.PI * 2,
    // Meteors are never seen at the radiant itself: that is the direction the
    // stream is coming from, so they appear foreshortened to a point there and
    // lengthen with distance from it.
    distance: 4 + Math.random() * 26,
    speed: 26 + Math.random() * 45,
    length: 5 + Math.random() * 11,
    life: 0,
    maxLife,
  };
}

/**
 * Streaks radiating from a shower's radiant.
 *
 * This is illustration, not simulation: the number on screen is fixed and has
 * nothing to do with the predicted rate, which is stated in words instead. The
 * one thing it does get right is the geometry — every streak traces directly
 * away from the radiant, which is exactly how you tell a shower meteor from a
 * sporadic one when you are actually out there.
 */
function Streaks({ position }: { position: THREE.Vector3 }) {
  const linesRef = useRef<THREE.LineSegments>(null);
  const streaks = useRef<Streak[]>(Array.from({ length: STREAKS_PER_SHOWER }, newStreak));

  const { geometry, basis } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(STREAKS_PER_SHOWER * 6), 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(STREAKS_PER_SHOWER * 6), 3));

    // A tangent plane at the radiant, so streaks fan out across the sky rather
    // than through the dome.
    const normal = position.clone().normalize();
    const reference = Math.abs(normal.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(reference, normal).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    return { geometry: geo, basis: { u, v } };
  }, [position]);

  useFrame((_, delta) => {
    const lines = linesRef.current;
    if (!lines) return;
    const positions = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = lines.geometry.getAttribute('color') as THREE.BufferAttribute;

    streaks.current.forEach((streak, i) => {
      streak.life += delta;
      if (streak.life > streak.maxLife) {
        streaks.current[i] = newStreak();
        streak = streaks.current[i];
      }
      streak.distance += streak.speed * delta;

      const dir = basis.u
        .clone()
        .multiplyScalar(Math.cos(streak.bearing))
        .addScaledVector(basis.v, Math.sin(streak.bearing));

      // Tail sits back toward the radiant; head leads away from it.
      const tail = position.clone().addScaledVector(dir, streak.distance);
      const head = position.clone().addScaledVector(dir, streak.distance + streak.length);
      // Keep them on the dome rather than drifting off its surface.
      tail.setLength(METEOR_RADIUS);
      head.setLength(METEOR_RADIUS);

      positions.setXYZ(i * 2, tail.x, tail.y, tail.z);
      positions.setXYZ(i * 2 + 1, head.x, head.y, head.z);

      // Fade in and out over the streak's life, and fade the tail to nothing.
      const phase = streak.life / streak.maxLife;
      const alpha = Math.sin(Math.PI * phase) ** 1.5;
      colors.setXYZ(i * 2, 0, 0, 0);
      colors.setXYZ(i * 2 + 1, alpha, alpha * 0.95, alpha * 0.85);
    });

    positions.needsUpdate = true;
    colors.needsUpdate = true;
  });

  return (
    <lineSegments ref={linesRef} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  );
}

function Radiant({ activity, azimuthDeg, elevationDeg }: { activity: ShowerActivity; azimuthDeg: number; elevationDeg: number }) {
  const position = useMemo(
    () => new THREE.Vector3(...azElToVec3(azimuthDeg, elevationDeg, METEOR_RADIUS)),
    [azimuthDeg, elevationDeg]
  );

  const rate = describeRate(expectedRateRange(activity, elevationDeg));

  return (
    <group>
      <Streaks position={position} />

      <group position={position}>
        <mesh>
          <ringGeometry args={[2.4, 2.9, 32]} />
          <meshBasicMaterial color={RADIANT_COLOR} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>

        <FrontFacingHtml position={[0, 0, 0]} offsetYPx={-26}>
          <div className="text-center whitespace-nowrap">
            <div className="text-[10px] font-semibold tracking-wide" style={{ color: RADIANT_COLOR }}>
              {activity.shower.name}
            </div>
            {/* Deliberately a range: the app cannot know the observer's sky,
                and the dark-sky figure alone would promise too much. */}
            <div className="text-[9px] text-space-300">{rate}</div>
          </div>
        </FrontFacingHtml>
      </group>
    </group>
  );
}

interface Props {
  displayTime: Date;
  latitude: number;
  lstRad: number;
}

export function MeteorLayer({ displayTime, latitude, lstRad }: Props) {
  const radiants = useMemo(() => {
    return activeShowers(displayTime)
      .map((activity) => ({
        activity,
        ...raDecToAzEl(activity.shower.radiantRaDeg, activity.shower.radiantDecDeg, lstRad, latitude),
      }))
      // A radiant below the horizon produces nothing to see, so there is
      // nothing to draw and nothing to claim.
      .filter((r) => r.elevationDeg > 2)
      // Only the showers actually worth going outside for. The Taurids at
      // ZHR 5 would otherwise clutter two months of sky for no reason.
      .filter((r) => r.activity.zhrNow >= 3);
  }, [displayTime, latitude, lstRad]);

  return (
    <>
      {radiants.map((r) => (
        <Radiant
          key={r.activity.shower.id}
          activity={r.activity}
          azimuthDeg={r.azimuthDeg}
          elevationDeg={r.elevationDeg}
        />
      ))}
    </>
  );
}
