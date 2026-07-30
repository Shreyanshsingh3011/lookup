import { useMemo, useRef, useState } from 'react';
import { Billboard, Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { decayLabel, estimateDecay } from '../../lib/decay';
import { azElToVec3, azToCompass, type SkySample } from '../../lib/sky';
import { useSatelliteModel } from '../../hooks/useSatelliteModel';
import { FrontFacingHtml } from './FrontFacingHtml';
import type { TleRecord } from '../../types';

const BODY_COLOR = '#c9d1e8';
const PANEL_COLOR = '#16305c';
const RADIATOR_COLOR = '#eef2f8';
const LIT_COLOR = '#5eead4';
const ECLIPSED_COLOR = '#64748b';

/**
 * Solar-cell grid drawn once onto a canvas and reused across every satellite
 * that has panels. White lines on a white field, multiplied by PANEL_COLOR in
 * the material — cheap texture-space detail instead of extra geometry, and a
 * single shared instance so N satellites cost one canvas, not N.
 */
let solarPanelTexture: THREE.CanvasTexture | null = null;
function getSolarPanelTexture(): THREE.CanvasTexture {
  if (solarPanelTexture) return solarPanelTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#93a5cc';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 6; i++) {
    const p = (i / 6) * size;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();
  }
  for (let i = 0; i <= 2; i++) {
    const p = (i / 2) * size;
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }
  solarPanelTexture = new THREE.CanvasTexture(canvas);
  return solarPanelTexture;
}

export interface LiveSatellite {
  satnum: string;
  name: string;
  sample: SkySample;
  trail: Array<[number, number, number]>;
  nextPassTime: string | null;
}

function SolarWing({ position, args, rotation }: { position: [number, number, number]; args: [number, number, number]; rotation?: [number, number, number] }) {
  return (
    <mesh position={position} rotation={rotation}>
      <boxGeometry args={args} />
      <meshStandardMaterial
        map={getSolarPanelTexture()}
        color={PANEL_COLOR}
        metalness={0.35}
        roughness={0.5}
        emissive="#0b1e3d"
        emissiveIntensity={0.5}
      />
    </mesh>
  );
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
        <SolarWing key={side} position={[side * 0.95, 0, 0]} args={[1.25, 0.04, 0.55]} />
      ))}
    </group>
  );
}

/**
 * Recognisably ISS-shaped: a long integrated truss carrying four solar array
 * pairs, a chain of pressurised modules along the flight axis, and the large
 * white radiator panels that are one of the station's more distinctive
 * features (and a useful visual contrast against the blue solar arrays).
 */
function IssBody() {
  return (
    <group>
      {/* Integrated truss structure */}
      <mesh>
        <boxGeometry args={[3.4, 0.12, 0.12]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.75} roughness={0.3} />
      </mesh>

      {/* Pressurised module chain (Zarya-Unity-Destiny-Zvezda), rounded rather
          than boxy for a more spacecraft-like silhouette under the same budget */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.24, 0.24, 1.6, 10]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0.85, 0, 0]}>
        <sphereGeometry args={[0.22, 10, 8]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.5} roughness={0.45} />
      </mesh>

      {/* Four solar array pairs along the truss */}
      {[-1.4, -0.8, 0.8, 1.4].flatMap((x) =>
        [-1, 1].map((side) => (
          <SolarWing key={`${x}-${side}`} position={[x, 0, side * 0.72]} args={[0.42, 0.03, 1.15]} />
        ))
      )}

      {/* Radiator panels near the truss ends, offset vertically so they read
          as a separate structure rather than overlapping the solar arrays */}
      {[-1.6, 1.6].map((x) => (
        <mesh key={x} position={[x, 0.32, 0]}>
          <boxGeometry args={[0.06, 0.65, 0.5]} />
          <meshStandardMaterial
            color={RADIATOR_COLOR}
            metalness={0.5}
            roughness={0.25}
            emissive="#4a5568"
            emissiveIntensity={0.15}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Recognisably Tiangong-shaped: Wentian and Mengtian docked to Tianhe's radial
 * ports gives the real station a cross/windmill silhouette when its three
 * module pairs of solar wings are extended, which is what actually
 * distinguishes it from the ISS's single long truss — not just a smaller
 * generic bus with more panels.
 */
function TiangongBody() {
  return (
    <group>
      {/* Tianhe core module */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.28, 0.28, 1.6, 10]} />
        <meshStandardMaterial color={BODY_COLOR} metalness={0.6} roughness={0.35} />
      </mesh>

      {/* Wentian and Mengtian, docked radially to form the cross */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0.15, 0, side * 0.9]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 1.3, 10]} />
          <meshStandardMaterial color={BODY_COLOR} metalness={0.55} roughness={0.4} />
        </mesh>
      ))}

      {/* Tianhe's solar wings mount near its ends and extend in Z, perpendicular
          to the core's own X-aligned axis, sitting outside the X range the lab
          modules occupy so nothing clips. */}
      {[-1, 1].map((side) => (
        <SolarWing key={`core-${side}`} position={[side * 1.0, 0, 0]} args={[0.4, 0.03, 1.3]} />
      ))}

      {/* Wentian's and Mengtian's wings mount near their outer tips and extend
          in X, perpendicular to those modules' own Z-aligned axis — giving the
          whole assembly a windmill silhouette rather than one straight line. */}
      {[-1, 1].map((side) => (
        <SolarWing key={`lab-${side}`} position={[0.15, 0, side * 1.5]} args={[1.1, 0.03, 0.42]} />
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
  tle?: TleRecord;
  selected: boolean;
  onSelect: (satnum: string | null) => void;
}

export function SatelliteMarker({ sat, tle, selected, onSelect }: Props) {
  const spinRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  // An external model when one is configured for this satellite; otherwise the
  // procedural geometry below.
  const model = useSatelliteModel(sat.satnum);

  // Decay estimation forward-propagates SGP4 up to ~100 times, so it's only
  // worth computing while the panel showing it is actually visible.
  const showPanel = selected || hovered;
  const decay = useMemo(
    () => (showPanel && tle ? estimateDecay(tle, new Date()) : null),
    [showPanel, tle]
  );

  const position = useMemo(
    () => azElToVec3(sat.sample.azimuthDeg, sat.sample.elevationDeg),
    [sat.sample.azimuthDeg, sat.sample.elevationDeg]
  );

  // A slow tumble so the objects read as alive rather than as static pins.
  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * 0.35;
  });

  const isIss = /ISS|ZARYA/i.test(sat.name);
  // Consistent with the station-family names passes.ts's standardMagnitude
  // matches server-side for its brightness estimate (that one relies on CSS
  // alone catching Wentian/Mengtian too, since both carry a "CSS (...)" name).
  const isTiangong = /TIANGONG|\bCSS\b|TIANHE|WENTIAN|MENGTIAN/i.test(sat.name);
  const scale = (isIss || isTiangong ? 2.6 : 3.2) * (hovered || selected ? 1.35 : 1);
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
          {model ? (
            <primitive object={model} />
          ) : isIss ? (
            <IssBody />
          ) : isTiangong ? (
            <TiangongBody />
          ) : (
            <GenericSatBody />
          )}
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
                {decay && (
                  <>
                    <dt className="text-space-300">Decay</dt>
                    <dd className="font-mono text-space-100">{decayLabel(decay)}</dd>
                  </>
                )}
              </dl>
            </div>
          </FrontFacingHtml>
        )}
      </group>
    </group>
  );
}
