import { useMemo } from 'react';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { Astronomy } from '../../lib/astronomy';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { FrontFacingHtml } from './FrontFacingHtml';

/** Behind the satellite shell, alongside the stars. */
const PLANET_RADIUS = DOME_RADIUS * 1.005;

interface BodyStyle {
  body: string;
  label: string;
  color: string;
  /** Apparent size on the dome, exaggerated so bodies are actually clickable. */
  scale: number;
}

/**
 * The classical naked-eye bodies. Uranus and Neptune are omitted: at mag 5.7+
 * they are not what someone scanning the sky is looking for, and they add
 * clutter next to the objects that matter.
 */
const BODIES: BodyStyle[] = [
  { body: 'Sun', label: 'Sun', color: '#ffd977', scale: 3.4 },
  { body: 'Moon', label: 'Moon', color: '#e8e6df', scale: 3.2 },
  { body: 'Mercury', label: 'Mercury', color: '#c9b8a8', scale: 1.5 },
  { body: 'Venus', label: 'Venus', color: '#fff3d4', scale: 2.2 },
  { body: 'Mars', label: 'Mars', color: '#e08060', scale: 1.8 },
  { body: 'Jupiter', label: 'Jupiter', color: '#e8d4a8', scale: 2.6 },
  { body: 'Saturn', label: 'Saturn', color: '#e0d0a0', scale: 2.2 },
];

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

interface PlanetPosition extends BodyStyle {
  azimuthDeg: number;
  elevationDeg: number;
  magnitude: number | null;
  /** Illuminated fraction, for the Moon and inner planets. */
  phase: number | null;
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
  const positions = useMemo<PlanetPosition[]>(() => {
    const observer = new Astronomy.Observer(observerLatitude, observerLongitude, observerElevation);
    const out: PlanetPosition[] = [];

    for (const style of BODIES) {
      try {
        const body = style.body as Parameters<typeof Astronomy.Equator>[0];
        // Apparent coordinates of date, including aberration.
        const eq = Astronomy.Equator(body, displayTime, observer, true, true);
        // Refraction is left off (an omitted argument means no correction) to
        // stay consistent with how satellite elevations are computed elsewhere.
        const hor = Astronomy.Horizon(displayTime, observer, eq.ra, eq.dec, undefined);
        if (hor.altitude < -2) continue;

        let magnitude: number | null = null;
        let phase: number | null = null;
        if (style.body !== 'Sun') {
          try {
            const illum = Astronomy.Illumination(body, displayTime);
            magnitude = illum.mag;
            phase = illum.phase_fraction;
          } catch {
            // Illumination is undefined for some body/time combinations.
          }
        }

        out.push({
          ...style,
          azimuthDeg: hor.azimuth,
          elevationDeg: hor.altitude,
          magnitude,
          phase,
        });
      } catch {
        // Skip any body astronomy-engine cannot place at this instant.
      }
    }
    return out;
  }, [displayTime, observerLatitude, observerLongitude, observerElevation]);

  return (
    <>
      {positions.map((p) => {
        const position = azElToVec3(p.azimuthDeg, p.elevationDeg, PLANET_RADIUS);
        const isSun = p.body === 'Sun';

        return (
          <group key={p.body} position={position}>
            <BodyGlow
              color={p.color}
              radius={p.scale * (isSun ? 4.5 : 3.2)}
              intensity={isSun ? 0.95 : 0.6}
            />
            <Billboard>
              <mesh>
                <circleGeometry args={[p.scale, 20]} />
                <meshBasicMaterial color={p.color} toneMapped={false} />
              </mesh>
            </Billboard>

            <FrontFacingHtml position={[0, 0, 0]} offsetYPx={-p.scale * 5 - 12}>
              <div className="text-center whitespace-nowrap">
                <div
                  className="text-[10px] font-semibold tracking-wide"
                  style={{ color: p.color }}
                >
                  {p.label}
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
