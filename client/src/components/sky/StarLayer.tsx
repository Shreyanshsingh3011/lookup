import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import catalog from '../../data/skyCatalog.json';
import {
  bvToColor,
  equatorialToSceneMatrix,
  magnitudeToSize,
  raDecToAzEl,
  raDecToEquatorial,
} from '../../lib/celestial';
import { DOME_RADIUS, azElToVec3 } from '../../lib/sky';
import { FrontFacingHtml } from './FrontFacingHtml';

/** Just outside the satellite shell, so satellites always pass in front. */
const STAR_RADIUS = DOME_RADIUS * 1.01;

/** Only label stars bright enough to pick out without crowding the view. */
const STAR_LABEL_MAG_LIMIT = 1.7;

const starVertexShader = /* glsl */ `
  attribute float size;
  varying vec3 vColor;
  uniform float uPixelScale;
  void main() {
    vColor = color;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Scale with viewport and field of view so stars grow as you zoom in.
    gl_PointSize = max(1.0, size * uPixelScale / max(-mv.z, 0.001));
    gl_Position = projectionMatrix * mv;
  }
`;

const starFragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = smoothstep(1.0, 0.2, d);
    if (alpha <= 0.002) discard;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

/** All catalogue stars as a single draw call. */
function StarField() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const gl = useThree((s) => s.gl);

  const geometry = useMemo(() => {
    const { ra, dec, mag, bv } = catalog.stars;
    const count = ra.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const [x, y, z] = raDecToEquatorial(ra[i], dec[i]);
      positions[i * 3] = x * STAR_RADIUS;
      positions[i * 3 + 1] = y * STAR_RADIUS;
      positions[i * 3 + 2] = z * STAR_RADIUS;

      const color = bvToColor(bv[i]);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      sizes[i] = magnitudeToSize(mag[i], catalog.magnitudeLimit);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, []);

  const uniforms = useMemo(() => ({ uPixelScale: { value: 600 } }), []);

  useFrame(({ camera, size }) => {
    const material = materialRef.current;
    if (!material) return;
    const perspective = camera as THREE.PerspectiveCamera;
    const fovRad = THREE.MathUtils.degToRad(perspective.fov);
    // gl_PointSize is in framebuffer pixels, so fold in the device pixel ratio.
    material.uniforms.uPixelScale.value =
      (size.height * gl.getPixelRatio()) / (2 * Math.tan(fovRad / 2));
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={starVertexShader}
        fragmentShader={starFragmentShader}
        transparent
        vertexColors
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/** Every constellation stick figure merged into one LineSegments draw call. */
function ConstellationFigures() {
  const geometry = useMemo(() => {
    const points: number[] = [];
    for (const constellation of catalog.constellations) {
      for (const line of constellation.lines) {
        for (let i = 0; i < line.length - 1; i++) {
          for (const [ra, dec] of [line[i], line[i + 1]]) {
            const [x, y, z] = raDecToEquatorial(ra, dec);
            points.push(x * STAR_RADIUS, y * STAR_RADIUS, z * STAR_RADIUS);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geo;
  }, []);

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#4a7fa8" transparent opacity={0.32} depthWrite={false} />
    </lineSegments>
  );
}

interface Props {
  displayTime: Date;
  latitude: number;
  lstRad: number;
  showStars: boolean;
  showConstellations: boolean;
}

export function StarLayer({ displayTime, latitude, lstRad, showStars, showConstellations }: Props) {
  const groupRef = useRef<THREE.Group>(null);

  // The entire celestial sphere is one rigid rotation away from scene
  // coordinates, so the geometry never has to be rebuilt as time advances.
  const sceneMatrix = useMemo(
    () => equatorialToSceneMatrix(lstRad, latitude),
    [lstRad, latitude]
  );

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.matrixAutoUpdate = false;
    group.matrix.copy(sceneMatrix);
    group.matrixWorldNeedsUpdate = true;
  }, [sceneMatrix]);

  // Labels live outside the rotating group in plain horizontal coordinates, so
  // the front-facing guard can reason about their world direction directly.
  const starLabels = useMemo(() => {
    if (!showStars) return [];
    return catalog.namedStars
      .filter((s) => s.mag <= STAR_LABEL_MAG_LIMIT)
      .map((s) => ({ ...s, ...raDecToAzEl(s.ra, s.dec, lstRad, latitude) }))
      .filter((s) => s.elevationDeg > 3);
  }, [lstRad, latitude, showStars]);

  const constellationLabels = useMemo(() => {
    if (!showConstellations) return [];
    return catalog.constellationLabels
      .map((c) => ({ ...c, ...raDecToAzEl(c.ra, c.dec, lstRad, latitude) }))
      .filter((c) => c.elevationDeg > 10);
  }, [lstRad, latitude, showConstellations]);

  // displayTime is what drives lstRad upstream; referenced so the dependency is
  // explicit to readers even though the matrix keys off the derived value.
  void displayTime;

  return (
    <>
      <group ref={groupRef}>
        {showStars && <StarField />}
        {showConstellations && <ConstellationFigures />}
      </group>

      {starLabels.map((s) => (
        <FrontFacingHtml
          key={s.name}
          position={azElToVec3(s.azimuthDeg, s.elevationDeg, DOME_RADIUS * 0.97)}
          offsetYPx={-13}
        >
          <div className="text-[10px] text-space-200/85 font-medium whitespace-nowrap tracking-wide">
            {s.name}
          </div>
        </FrontFacingHtml>
      ))}

      {constellationLabels.map((c) => (
        <FrontFacingHtml
          key={c.id}
          position={azElToVec3(c.azimuthDeg, c.elevationDeg, DOME_RADIUS * 0.95)}
        >
          <div className="text-[9px] uppercase tracking-[0.18em] text-[#6f9dc0]/70 whitespace-nowrap">
            {c.name}
          </div>
        </FrontFacingHtml>
      ))}
    </>
  );
}
