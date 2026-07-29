import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import * as THREE from 'three';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { FrontFacingHtml } from './FrontFacingHtml';

const GRID_COLOR = '#3d4a6b';
const HORIZON_COLOR = '#5eead4';

const skyVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragmentShader = /* glsl */ `
  varying vec3 vWorldPos;
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform float radius;
  void main() {
    float h = clamp(vWorldPos.y / radius, 0.0, 1.0);
    gl_FragColor = vec4(mix(horizonColor, zenithColor, pow(h, 0.65)), 1.0);
  }
`;

/** Gradient inner surface of the dome, seen from inside. */
function SkyGradient() {
  const uniforms = useMemo(
    () => ({
      zenithColor: { value: new THREE.Color('#070b16') },
      horizonColor: { value: new THREE.Color('#1c2744') },
      radius: { value: DOME_RADIUS },
    }),
    []
  );

  return (
    <mesh>
      <sphereGeometry args={[DOME_RADIUS, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <shaderMaterial
        side={THREE.BackSide}
        uniforms={uniforms}
        vertexShader={skyVertexShader}
        fragmentShader={skyFragmentShader}
        depthWrite={false}
      />
    </mesh>
  );
}

/** A circle of constant elevation (an almucantar). */
function AltitudeRing({ elevationDeg, opacity }: { elevationDeg: number; opacity: number }) {
  const points = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (let az = 0; az <= 360; az += 3) {
      pts.push(azElToVec3(az, elevationDeg, DOME_RADIUS * 0.995));
    }
    return pts;
  }, [elevationDeg]);

  return (
    <Line
      points={points}
      color={elevationDeg === 0 ? HORIZON_COLOR : GRID_COLOR}
      lineWidth={elevationDeg === 0 ? 1.6 : 1}
      transparent
      opacity={opacity}
    />
  );
}

/** A vertical great-circle arc from horizon to zenith at a fixed azimuth. */
function Meridian({ azimuthDeg }: { azimuthDeg: number }) {
  const points = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    for (let el = 0; el <= 90; el += 3) {
      pts.push(azElToVec3(azimuthDeg, el, DOME_RADIUS * 0.995));
    }
    return pts;
  }, [azimuthDeg]);

  return <Line points={points} color={GRID_COLOR} lineWidth={1} transparent opacity={0.22} />;
}

function LabelChip({
  position,
  children,
  emphasis = false,
}: {
  position: [number, number, number];
  children: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <FrontFacingHtml position={position}>
      <div
        className={
          emphasis
            ? 'text-glow-400 text-sm font-semibold tracking-widest drop-shadow-[0_0_8px_rgba(45,212,191,0.6)]'
            : 'text-space-300 text-[10px] font-medium tracking-wider'
        }
      >
        {children}
      </div>
    </FrontFacingHtml>
  );
}

const CARDINALS: Array<{ az: number; label: string; major: boolean }> = [
  { az: 0, label: 'N', major: true },
  { az: 45, label: 'NE', major: false },
  { az: 90, label: 'E', major: true },
  { az: 135, label: 'SE', major: false },
  { az: 180, label: 'S', major: true },
  { az: 225, label: 'SW', major: false },
  { az: 270, label: 'W', major: true },
  { az: 315, label: 'NW', major: false },
];

export function DomeShell() {
  return (
    <group>
      <SkyGradient />

      {/* Ground plane, so looking below the horizon reads as "down" */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <circleGeometry args={[DOME_RADIUS, 64]} />
        <meshBasicMaterial color="#04060b" side={THREE.DoubleSide} transparent opacity={0.96} />
      </mesh>

      <AltitudeRing elevationDeg={0} opacity={0.55} />
      <AltitudeRing elevationDeg={30} opacity={0.28} />
      <AltitudeRing elevationDeg={60} opacity={0.28} />

      {CARDINALS.map(({ az }) => (
        <Meridian key={az} azimuthDeg={az} />
      ))}

      {CARDINALS.map(({ az, label, major }) => (
        <LabelChip key={label} position={azElToVec3(az, major ? 4 : 3, DOME_RADIUS * 0.93)} emphasis={major}>
          {label}
        </LabelChip>
      ))}

      {/* Altitude ring labels, placed on the northern meridian. The zenith is
          left unlabelled: the meridians visibly converge there, and satellites
          pass close enough to it that a label would collide with theirs. */}
      {[30, 60].map((el) => (
        <LabelChip key={el} position={azElToVec3(0, el, DOME_RADIUS * 0.93)}>
          {el}°
        </LabelChip>
      ))}
    </group>
  );
}
