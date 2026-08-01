import { useEffect, useMemo, useRef } from 'react';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { localSiderealTime, raDecToAzEl } from '../../lib/celestial';
import { sunwardDirection } from '../../lib/phase';
import { createPlanetMaterial, createRingMaterial } from '../../lib/planetShaders';
import {
  apparentDiameterDeg,
  describeApparentSize,
  drawnDiameterDeg,
  exaggerationFactor,
  sphereRadiusFor,
  type ScaleMode,
} from '../../lib/apparentSize';
import { galileanMoonOffsets, rotationState, saturnRingOpeningDeg } from '../../lib/planetGeometry';
import { usePlanetPositions, useSunDirection, type PlanetPosition } from '../../hooks/usePlanetPositions';
import { FrontFacingHtml } from './FrontFacingHtml';

/** Behind the satellite shell, alongside the stars. */
const PLANET_RADIUS = DOME_RADIUS * 1.005;

const JUPITER_RADIUS_KM = 71_492;

interface BodyStyle {
  label: string;
  /** Label and glow tint. */
  color: string;
}

const BODY_STYLES: Record<PlanetPosition['body'], BodyStyle> = {
  Sun: { label: 'Sun', color: '#ffd977' },
  Moon: { label: 'Moon', color: '#e8e6df' },
  Mercury: { label: 'Mercury', color: '#c9b8a8' },
  Venus: { label: 'Venus', color: '#fff3d4' },
  Mars: { label: 'Mars', color: '#e08060' },
  Jupiter: { label: 'Jupiter', color: '#e8d4a8' },
  Saturn: { label: 'Saturn', color: '#e0d0a0' },
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

/**
 * Orientation putting the body's north pole where it actually points.
 *
 * The pole's own sky position is converted to a scene direction and the
 * sphere's +Y rotated onto it, then spun about that axis by the body's real
 * rotation angle. This replaces a fixed slow turn that was, by its own
 * comment, decoration — it is why Mars's polar caps now face the right way and
 * why Jupiter turns once every ten hours instead of at whatever looked nice.
 */
function orientationFor(
  body: string,
  displayTime: Date,
  lstRad: number,
  latitude: number
): THREE.Quaternion | null {
  const rotation = rotationState(body, displayTime);
  if (!rotation) return null;

  const pole = raDecToAzEl(rotation.poleRaDeg, rotation.poleDecDeg, lstRad, latitude);
  const poleVector = new THREE.Vector3(...azElToVec3(pole.azimuthDeg, pole.elevationDeg, 1)).normalize();

  const toPole = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), poleVector);
  const spin = new THREE.Quaternion().setFromAxisAngle(
    poleVector,
    THREE.MathUtils.degToRad(rotation.spinDeg)
  );
  return spin.multiply(toPole);
}

/** One sphere, lit so its terminator falls where it really would. */
function PlanetBody({
  body,
  radius,
  lightDirection,
  orientation,
}: {
  body: PlanetPosition['body'];
  radius: number;
  lightDirection: THREE.Vector3;
  orientation: THREE.Quaternion | null;
}) {
  const material = useMemo(() => createPlanetMaterial(body), [body]);
  const ringMaterial = useMemo(() => (body === 'Saturn' ? createRingMaterial() : null), [body]);
  const groupRef = useRef<THREE.Group>(null);

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

  useEffect(() => {
    if (groupRef.current && orientation) groupRef.current.quaternion.copy(orientation);
  }, [orientation]);

  return (
    <group ref={groupRef}>
      <mesh material={material}>
        <sphereGeometry args={[radius, 48, 32]} />
      </mesh>

      {/* The rings lie in the equatorial plane, so once the body carries its
          real pole they need no tilt of their own — the opening angle seen
          from Earth falls out of that orientation rather than being applied
          a second time. */}
      {ringMaterial && (
        <mesh material={ringMaterial} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[radius * 1.35, radius * 2.3, 96]} />
        </mesh>
      )}
    </group>
  );
}

/**
 * The four moons Galileo saw, at their real positions.
 *
 * Offsets arrive in Jupiter radii, converted to a true angular separation and
 * then put through the same compression the discs use.
 *
 * Neither naive option works. At true separation the moons fall inside an
 * enlarged disc and vanish; scaled by the disc's own exaggeration they land up
 * to eleven degrees away, spreading a system that really spans a few arcminutes
 * across a quarter of the sky. Reusing the disc compression keeps one rule for
 * the whole view: strictly increasing, so Io through Callisto are always in the
 * right order, with the ratios squeezed to fit.
 */
function GalileanMoons({
  displayTime,
  jupiterRadius,
  jupiterAzimuthDeg,
  jupiterElevationDeg,
  jupiterTrueDiameterDeg,
  scaleMode,
}: {
  displayTime: Date;
  jupiterRadius: number;
  jupiterAzimuthDeg: number;
  jupiterElevationDeg: number;
  jupiterTrueDiameterDeg: number;
  scaleMode: ScaleMode;
}) {
  const placed = useMemo(() => {
    const moons = galileanMoonOffsets(displayTime);
    const trueRadiusDeg = jupiterTrueDiameterDeg / 2;

    return moons.map((moon) => {
      // True separation on the sky, then compressed exactly as a disc would be.
      const trueSeparationDeg = Math.hypot(moon.x, moon.y) * trueRadiusDeg;
      const drawnSeparationDeg = drawnDiameterDeg(trueSeparationDeg, scaleMode);
      const scale = trueSeparationDeg > 0 ? drawnSeparationDeg / trueSeparationDeg : 1;

      const eastDeg = moon.x * trueRadiusDeg * scale;
      const northDeg = moon.y * trueRadiusDeg * scale;
      const elevationDeg = jupiterElevationDeg + northDeg;
      // Azimuth lines converge toward the zenith, so an east-west offset is
      // worth more degrees of azimuth the higher the planet sits.
      const azimuthDeg =
        jupiterAzimuthDeg - eastDeg / Math.max(0.05, Math.cos(THREE.MathUtils.degToRad(elevationDeg)));

      return {
        ...moon,
        position: azElToVec3(azimuthDeg, elevationDeg, PLANET_RADIUS),
        // Behind the disc and within its outline: genuinely hidden.
        occluded: moon.depth > 0 && Math.hypot(moon.x, moon.y) < 1,
      };
    });
  }, [displayTime, jupiterAzimuthDeg, jupiterElevationDeg, jupiterTrueDiameterDeg, scaleMode]);

  return (
    <>
      {placed.map((moon) =>
        moon.occluded ? null : (
          <group key={moon.id} position={moon.position}>
            <mesh>
              {/* Sized from the real radius ratio against Jupiter, with a floor
                  so a moon never falls below a pixel and vanishes. */}
              <sphereGeometry
                args={[
                  Math.max(jupiterRadius * 0.07, jupiterRadius * (moon.radiusKm / JUPITER_RADIUS_KM)),
                  10,
                  8,
                ]}
              />
              <meshBasicMaterial color="#f4efe4" toneMapped={false} />
            </mesh>
          </group>
        )
      )}
    </>
  );
}

interface Props {
  displayTime: Date;
  observerLatitude: number;
  observerLongitude: number;
  observerElevation: number;
  scaleMode: ScaleMode;
}

export function PlanetLayer({
  displayTime,
  observerLatitude,
  observerLongitude,
  observerElevation,
  scaleMode,
}: Props) {
  const positions = usePlanetPositions(displayTime, observerLatitude, observerLongitude, observerElevation);

  // Every phase is measured against where the Sun actually is, which at night
  // means below the horizon and absent from `positions`. Computed separately
  // so a planet's terminator stays correct after dark.
  const sun = useSunDirection(displayTime, observerLatitude, observerLongitude, observerElevation);

  const lstRad = useMemo(
    () => localSiderealTime(displayTime, observerLongitude),
    [displayTime, observerLongitude]
  );

  const ringOpeningDeg = useMemo(() => saturnRingOpeningDeg(displayTime), [displayTime]);

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

        const trueDeg = apparentDiameterDeg(p.body, displayTime);
        if (trueDeg === null) return null;
        const drawnDeg = drawnDiameterDeg(trueDeg, scaleMode);
        const radius = sphereRadiusFor(drawnDeg, PLANET_RADIUS);
        const exaggeration = exaggerationFactor(trueDeg, drawnDeg);

        const orientation = orientationFor(p.body, displayTime, lstRad, observerLatitude);

        // A glow floor keeps a true-scale planet visible as the point of light
        // it genuinely is, rather than disappearing altogether.
        const glowRadius = Math.max(radius * (isSun ? 4.5 : 3.2), 0.9);

        return (
          <group key={p.body}>
            <group position={position}>
              <BodyGlow color={style.color} radius={glowRadius} intensity={isSun ? 0.8 : 0.28} />

              <PlanetBody
                body={p.body}
                radius={radius}
                lightDirection={lightDirection}
                orientation={orientation}
              />

              <FrontFacingHtml position={[0, 0, 0]} offsetYPx={-Math.max(radius * 5, 14) - 12}>
                <div className="text-center whitespace-nowrap">
                  <div className="text-[10px] font-semibold tracking-wide" style={{ color: style.color }}>
                    {style.label}
                  </div>
                  <div className="text-[9px] text-space-300 font-mono">
                    {describeApparentSize(trueDeg)}
                    {p.magnitude !== null && ` · mag ${p.magnitude.toFixed(1)}`}
                  </div>
                  {exaggeration > 1.5 && (
                    // Stated rather than hidden: the disc is not life size, and
                    // this says by how much.
                    <div className="text-[9px] text-space-400">
                      drawn {Math.round(exaggeration)}× life size
                    </div>
                  )}
                  {p.body === 'Saturn' && ringOpeningDeg !== null && (
                    <div className="text-[9px] text-space-400">
                      rings {Math.abs(ringOpeningDeg).toFixed(1)}° open
                    </div>
                  )}
                  {p.phase !== null && p.body === 'Moon' && (
                    <div className="text-[9px] text-space-400">{Math.round(p.phase * 100)}% lit</div>
                  )}
                </div>
              </FrontFacingHtml>
            </group>

            {p.body === 'Jupiter' && (
              <GalileanMoons
                displayTime={displayTime}
                jupiterRadius={radius}
                jupiterAzimuthDeg={p.azimuthDeg}
                jupiterElevationDeg={p.elevationDeg}
                jupiterTrueDiameterDeg={trueDeg}
                scaleMode={scaleMode}
              />
            )}
          </group>
        );
      })}
    </>
  );
}
