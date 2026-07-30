import { useEffect, useMemo, useRef } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { sunwardDirection } from '../../lib/phase';
import { createPlanetMaterial, createRingMaterial } from '../../lib/planetShaders';
import { usePlanetPositions, useSunDirection, type PlanetPosition } from '../../hooks/usePlanetPositions';
import { FrontFacingHtml } from './FrontFacingHtml';

/** Behind the satellite shell, alongside the stars. */
const PLANET_RADIUS = DOME_RADIUS * 1.005;

interface BodyStyle {
  label: string;
  /** Label and glow tint. */
  color: string;
  /**
   * Apparent size on the dome. Real planets are well under an arcminute
   * across — Jupiter is about 1/40 the Moon's width — so every one of these
   * is enormously exaggerated to be findable and clickable at all. The
   * relative ordering is kept roughly true to life.
   */
  scale: number;
  /** Axial tilt in degrees, so banded worlds are not drawn upright. */
  tilt: number;
}

const BODY_STYLES: Record<PlanetPosition['body'], BodyStyle> = {
  Sun: { label: 'Sun', color: '#ffd977', scale: 3.4, tilt: 7.2 },
  Moon: { label: 'Moon', color: '#e8e6df', scale: 3.2, tilt: 6.7 },
  Mercury: { label: 'Mercury', color: '#c9b8a8', scale: 1.5, tilt: 0.03 },
  Venus: { label: 'Venus', color: '#fff3d4', scale: 2.2, tilt: 177.4 },
  Mars: { label: 'Mars', color: '#e08060', scale: 1.8, tilt: 25.2 },
  Jupiter: { label: 'Jupiter', color: '#e8d4a8', scale: 2.6, tilt: 3.1 },
  Saturn: { label: 'Saturn', color: '#e0d0a0', scale: 2.2, tilt: 26.7 },
};

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
    float falloff = pow(max(0.0, 1.0 - d), 2.2);
    gl_FragColor = vec4(glowColor, falloff * intensity);
  }
`;

function BodyGlow({ color, radius, intensity }: { color: string; radius: number; intensity: number }) {
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

/** One sphere, lit so its terminator falls where it really would. */
function PlanetBody({
  body,
  style,
  lightDirection,
}: {
  body: PlanetPosition['body'];
  style: BodyStyle;
  lightDirection: THREE.Vector3;
}) {
  const material = useMemo(() => createPlanetMaterial(body), [body]);
  const ringMaterial = useMemo(() => (body === 'Saturn' ? createRingMaterial() : null), [body]);
  const spinRef = useRef<THREE.Group>(null);

  // Dispose the compiled programs when a body leaves the sky, rather than
  // leaking one per rise/set cycle.
  useEffect(() => {
    return () => {
      material.dispose();
      ringMaterial?.dispose();
    };
  }, [material, ringMaterial]);

  useEffect(() => {
    material.uniforms.uLightDir.value.copy(lightDirection);
    if (ringMaterial) ringMaterial.uniforms.uLightDir.value.copy(lightDirection);
  }, [material, ringMaterial, lightDirection]);

  // A slow rotation, so a zoomed-in gas giant is visibly turning rather than
  // frozen. Not tied to the body's real rotation period — at these speeds
  // that would be imperceptible — so it is decoration, not data.
  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * 0.06;
  });

  return (
    <group rotation={[0, 0, THREE.MathUtils.degToRad(style.tilt)]}>
      <group ref={spinRef}>
        <mesh material={material}>
          <sphereGeometry args={[style.scale, 48, 32]} />
        </mesh>
      </group>

      {ringMaterial && (
        <mesh material={ringMaterial} rotation={[Math.PI / 2, 0, 0]}>
          {/* Inner and outer radii track the shader's own uInner/uOuter. */}
          <ringGeometry args={[style.scale * 1.35, style.scale * 2.3, 96]} />
        </mesh>
      )}
    </group>
  );
}

interface Props {
  displayTime: Date;
  observerLatitude: number;
  observerLongitude: number;
  observerElevation: number;
}

export function PlanetLayer({
  displayTime,
  observerLatitude,
  observerLongitude,
  observerElevation,
}: Props) {
  const positions = usePlanetPositions(displayTime, observerLatitude, observerLongitude, observerElevation);

  // Every phase is measured against where the Sun actually is, which at night
  // means below the horizon and absent from `positions`. Computed separately
  // so a planet's terminator stays correct after dark.
  const sun = useSunDirection(displayTime, observerLatitude, observerLongitude, observerElevation);

  const lightDirections = useMemo(() => {
    const map = new Map<PlanetPosition['body'], THREE.Vector3>();
    for (const p of positions) {
      if (p.body === 'Sun') continue;
      // With no Sun position available there is nothing to reason from, so
      // fall back to fully lit rather than inventing a phase.
      const direction = sun
        ? sunwardDirection(
            { azimuthDeg: p.azimuthDeg, elevationDeg: p.elevationDeg },
            { azimuthDeg: sun.azimuthDeg, elevationDeg: sun.elevationDeg },
            p.phase
          )
        : (() => {
            const [x, y, z] = azElToVec3(p.azimuthDeg, p.elevationDeg, 1);
            return [-x, -y, -z] as [number, number, number];
          })();
      map.set(p.body, new THREE.Vector3(...direction));
    }
    return map;
  }, [positions, sun]);

  return (
    <>
      {positions.map((p) => {
        const style = BODY_STYLES[p.body];
        const position = azElToVec3(p.azimuthDeg, p.elevationDeg, PLANET_RADIUS);
        const isSun = p.body === 'Sun';
        const lightDirection = lightDirections.get(p.body) ?? new THREE.Vector3(0, 0, 1);

        return (
          <group key={p.body} position={position}>
            <BodyGlow
              color={style.color}
              radius={style.scale * (isSun ? 4.5 : 3.2)}
              // Dimmed relative to the old flat discs: the sphere is the
              // subject now, and a heavy halo would drown its detail.
              intensity={isSun ? 0.8 : 0.28}
            />

            <PlanetBody body={p.body} style={style} lightDirection={lightDirection} />

            <FrontFacingHtml position={[0, 0, 0]} offsetYPx={-style.scale * 5 - 12}>
              <div className="text-center whitespace-nowrap">
                <div
                  className="text-[10px] font-semibold tracking-wide"
                  style={{ color: style.color }}
                >
                  {style.label}
                </div>
                {p.magnitude !== null && (
                  <div className="text-[9px] text-space-300 font-mono">
                    mag {p.magnitude.toFixed(1)}
                    {p.phase !== null && p.body === 'Moon' && ` · ${Math.round(p.phase * 100)}%`}
                  </div>
                )}
              </div>
            </FrontFacingHtml>
          </group>
        );
      })}
    </>
  );
}
