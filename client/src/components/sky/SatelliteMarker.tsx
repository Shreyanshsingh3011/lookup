import { useMemo, useRef, useState } from 'react';
import { Billboard, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { azElToVec3, azToCompass, type SkySample } from '../../lib/sky';
import { useSatelliteModel } from '../../hooks/useSatelliteModel';
import { FrontFacingHtml } from './FrontFacingHtml';

const BODY_COLOR = '#c9d1e8';
const PANEL_COLOR = '#16305c';
const LIT_COLOR = '#5eead4';
const ECLIPSED_COLOR = '#64748b';

export interface LiveSatellite {
  satnum: string;
  name: string;
  sample: SkySample;
  trail: Array<[number, number, number]>;
  nextPassTime: string | null;
}

/** Generic low-poly bus: box body plus two solar panel wings. */
function GenericSatBody() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.55, 0.5, 0.8]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.95, 0, 0]}>
          <boxGeometry args={[1.25, 0.04, 0.55]} />
          <meshStandardMaterial color={PANEL_COLOR} metalness={0.35} roughness={0.5} emissive="#0b1e3d" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Recognisably ISS-shaped: long truss with four solar array pairs. */
function IssBody() {
  return (
    <group>
      {/* Main truss */}
      <mesh>
        <boxGeometry args={[3.0, 0.12, 0.12]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Pressurised modules along the flight axis */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.5, 0.42, 1.5]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.55} roughness={0.4} />
      </mesh>
      {/* Four solar array pairs */}
      {[-1.25, -0.7, 0.7, 1.25].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[0, 0, side * 0.72]}>
              <boxGeometry args={[0.42, 0.03, 1.15]} />
              <meshStandardMaterial
                color={PANEL_COLOR}
                metalness={0.35}
                roughness={0.5}
                emissive="#0b1e3d"
                emissiveIntensity={0.55}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

const glowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const glowFragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 glowColor;
  uniform float intensity;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float falloff = pow(max(0.0, 1.0 - d), 2.5);
    gl_FragColor = vec4(glowColor, falloff * intensity);
  }
`;

/**
 * Soft halo that keeps a satellite findable against the sky. A flat disc reads
 * as an opaque grey blob once zoomed in, so the alpha falls off radially.
 */
function Glow({ color, intensity, radius }: { color: string; intensity: number; radius: number }) {
  const uniforms = useMemo(
    () => ({ glowColor: { value: new THREE.Color(color) }, intensity: { value: intensity } }),
    [color, intensity]
  );

  return (
    <Billboard>
      <mesh>
        <planeGeometry args={[radius * 2, radius * 2]} />
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={glowVertexShader}
          fragmentShader={glowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}

function Trail({ points, illuminated }: { points: Array<[number, number, number]>; illuminated: boolean }) {
  const colors = useMemo(() => {
    const base = new THREE.Color(illuminated ? LIT_COLOR : ECLIPSED_COLOR);
    return points.map((_, i) => {
      // Oldest sample fades to black, which reads as opacity against the dark sky.
      const t = points.length > 1 ? i / (points.length - 1) : 1;
      return base.clone().multiplyScalar(Math.pow(t, 1.6));
    });
  }, [points, illuminated]);

  if (points.length < 2) return null;

  return <Line points={points} vertexColors={colors} color="white" lineWidth={2} transparent opacity={0.85} />;
}

interface Props {
  sat: LiveSatellite;
  selected: boolean;
  onSelect: (satnum: string | null) => void;
}

export function SatelliteMarker({ sat, selected, onSelect }: Props) {
  const spinRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  // An external model when one is configured for this satellite; otherwise the
  // procedural geometry below.
  const model = useSatelliteModel(sat.satnum);

  const position = useMemo(
    () => azElToVec3(sat.sample.azimuthDeg, sat.sample.elevationDeg),
    [sat.sample.azimuthDeg, sat.sample.elevationDeg]
  );

  // A slow tumble so the objects read as alive rather than as static pins.
  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * 0.35;
  });

  const isIss = /ISS|ZARYA/i.test(sat.name);
  const scale = (isIss ? 2.6 : 3.2) * (hovered || selected ? 1.35 : 1);
  const glowColor = sat.sample.illuminated ? LIT_COLOR : ECLIPSED_COLOR;
  const displayName = sat.name.replace(/\s*\(.*?\)\s*/g, '').trim();

  return (
    <group>
      <Trail points={sat.trail} illuminated={sat.sample.illuminated} />

      <group position={position}>
        {/* Generous invisible hit target — the models are only ~20px on screen */}
        <mesh
          onClick={(e) => {
            e.stopPropagation();
            onSelect(selected ? null : sat.satnum);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(true);
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            setHovered(false);
            document.body.style.cursor = 'auto';
          }}
        >
          <sphereGeometry args={[7, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>

        <Glow
          color={glowColor}
          intensity={selected ? 0.75 : hovered ? 0.6 : 0.42}
          radius={selected || hovered ? 9 : 7}
        />

        <group ref={spinRef} scale={scale}>
          {model ? <primitive object={model} /> : isIss ? <IssBody /> : <GenericSatBody />}
        </group>

        {(selected || hovered) && (
          <FrontFacingHtml position={[0, 0, 0]} zIndexRange={[20, 0]} offsetYPx={-78}>
            <div className="glass-panel rounded-lg px-3 py-2 min-w-[190px] shadow-[var(--shadow-glow-sm)]">
              <div className="text-glow-400 font-semibold text-xs tracking-wide">{displayName}</div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
                <dt className="text-space-300">Altitude</dt>
                <dd className="font-mono text-space-100">{sat.sample.altitudeKm.toFixed(0)} km</dd>
                <dt className="text-space-300">Speed</dt>
                <dd className="font-mono text-space-100">{sat.sample.speedKmS.toFixed(2)} km/s</dd>
                <dt className="text-space-300">Position</dt>
                <dd className="font-mono text-space-100">
                  {sat.sample.elevationDeg.toFixed(0)}° {azToCompass(sat.sample.azimuthDeg)}
                </dd>
                <dt className="text-space-300">Sunlit</dt>
                <dd className="font-mono text-space-100">{sat.sample.illuminated ? 'yes' : 'in shadow'}</dd>
                <dt className="text-space-300">Next pass</dt>
                <dd className="font-mono text-space-100">
                  {sat.nextPassTime
                    ? new Date(sat.nextPassTime).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </dd>
              </dl>
            </div>
          </FrontFacingHtml>
        )}
      </group>
    </group>
  );
}
