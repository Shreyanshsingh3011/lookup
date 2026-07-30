import { useMemo } from 'react';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { usePlanetPositions, type PlanetPosition } from '../../hooks/usePlanetPositions';
import { FrontFacingHtml } from './FrontFacingHtml';

/** Behind the satellite shell, alongside the stars. */
const PLANET_RADIUS = DOME_RADIUS * 1.005;

interface BodyStyle {
  label: string;
  color: string;
  /** Apparent size on the dome, exaggerated so bodies are actually clickable. */
  scale: number;
}

const BODY_STYLES: Record<PlanetPosition['body'], BodyStyle> = {
  Sun: { label: 'Sun', color: '#ffd977', scale: 3.4 },
  Moon: { label: 'Moon', color: '#e8e6df', scale: 3.2 },
  Mercury: { label: 'Mercury', color: '#c9b8a8', scale: 1.5 },
  Venus: { label: 'Venus', color: '#fff3d4', scale: 2.2 },
  Mars: { label: 'Mars', color: '#e08060', scale: 1.8 },
  Jupiter: { label: 'Jupiter', color: '#e8d4a8', scale: 2.6 },
  Saturn: { label: 'Saturn', color: '#e0d0a0', scale: 2.2 },
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

  return (
    <>
      {positions.map((p) => {
        const style = BODY_STYLES[p.body];
        const position = azElToVec3(p.azimuthDeg, p.elevationDeg, PLANET_RADIUS);
        const isSun = p.body === 'Sun';

        return (
          <group key={p.body} position={position}>
            <BodyGlow
              color={style.color}
              radius={style.scale * (isSun ? 4.5 : 3.2)}
              intensity={isSun ? 0.95 : 0.6}
            />
            <Billboard>
              <mesh>
                <circleGeometry args={[style.scale, 20]} />
                <meshBasicMaterial color={style.color} toneMapped={false} />
              </mesh>
            </Billboard>

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
