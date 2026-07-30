import * as THREE from 'three';
import type { PlanetPosition } from '../hooks/usePlanetPositions';

/**
 * Procedurally generated planet surfaces.
 *
 * Real texture maps would be sharper, but they are large binary assets with
 * their own licensing, and generating the surfaces in a shader keeps the app
 * self-contained — the same reasoning behind the hand-built ISS and Tiangong
 * geometry rather than downloaded models.
 *
 * These are *characteristic* rather than photographic: Jupiter gets banded
 * cloud belts with a red spot, Mars gets rust-coloured terrain with polar
 * caps, the Moon gets dark maria against bright highlands. Zoom in and there
 * is real detail to find, but nobody should mistake it for a Cassini image.
 *
 * The lighting, by contrast, is physically correct — see lib/phase.ts. The
 * terminator lands where it genuinely should, so a crescent Venus really is
 * a crescent, lit from the side the Sun actually is.
 */

/** Value noise and fbm, shared by every surface. */
const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p *= 2.02;
      amplitude *= 0.5;
    }
    return value;
  }
`;

/**
 * Each body supplies `vec3 surfaceColor(vec3 p)`, sampling in object space so
 * the pattern stays fixed to the sphere instead of swimming as it moves.
 */
const SURFACES: Record<PlanetPosition['body'], string> = {
  // Granulation, plus limb darkening applied in the main shader.
  Sun: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      float granules = fbm(p * 9.0);
      float hot = fbm(p * 3.0 + 4.0);
      vec3 base = mix(vec3(1.0, 0.55, 0.12), vec3(1.0, 0.94, 0.76), granules);
      return mix(base, vec3(1.0, 0.86, 0.45), hot * 0.4);
    }
  `,

  // Bright anorthosite highlands with darker basalt maria over them.
  Moon: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      float maria = smoothstep(0.50, 0.63, fbm(p * 1.7));
      float regolith = fbm(p * 15.0);
      vec3 highland = vec3(0.74, 0.72, 0.68);
      vec3 mare = vec3(0.30, 0.30, 0.33);
      vec3 c = mix(highland, mare, maria);
      // Speckle stands in for the crater field at this scale.
      c *= 0.80 + 0.34 * regolith;
      return c;
    }
  `,

  Mercury: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      float craters = fbm(p * 13.0);
      float basins = smoothstep(0.45, 0.60, fbm(p * 2.2));
      vec3 c = mix(vec3(0.55, 0.51, 0.47), vec3(0.74, 0.70, 0.65), craters);
      c = mix(c, vec3(0.44, 0.42, 0.40), basins * 0.5);
      return c * (0.86 + 0.28 * fbm(p * 32.0));
    }
  `,

  // An unbroken sulphuric acid cloud deck: no surface detail is visible.
  Venus: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      float swirl = fbm(p * 3.2 + vec3(0.0, fbm(p * 2.0) * 1.8, 0.0));
      float streaks = fbm(vec3(p.x * 1.5, p.y * 9.0, p.z * 1.5));
      vec3 c = mix(vec3(0.85, 0.74, 0.50), vec3(0.99, 0.97, 0.88), swirl);
      return mix(c, vec3(0.93, 0.87, 0.68), streaks * 0.35);
    }
  `,

  Mars: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      vec3 n = normalize(p);
      float terrain = fbm(p * 3.6);
      vec3 c = mix(vec3(0.56, 0.25, 0.13), vec3(0.82, 0.47, 0.28), terrain);
      // Dark albedo features, the markings that shift with the dust storms.
      c = mix(c, vec3(0.36, 0.23, 0.17), smoothstep(0.54, 0.74, fbm(p * 2.1 + 11.0)));
      // Polar caps, with a ragged edge rather than a drawn-on circle.
      float cap = smoothstep(0.84, 0.96, abs(n.y) + fbm(p * 7.0) * 0.07);
      return mix(c, vec3(0.94, 0.95, 0.98), cap);
    }
  `,

  // Belts and zones, warped by turbulence so the bands are not ruler-straight.
  Jupiter: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      vec3 n = normalize(p);
      float turbulence = fbm(p * 2.7) * 0.11;
      float bands = sin((n.y + turbulence) * 27.0);
      vec3 zone = vec3(0.91, 0.84, 0.70);
      vec3 belt = vec3(0.64, 0.46, 0.31);
      vec3 c = mix(belt, zone, smoothstep(-0.45, 0.45, bands));
      // Polar regions are hazier and less strongly banded.
      c = mix(c, vec3(0.60, 0.54, 0.48), smoothstep(0.62, 1.0, abs(n.y)));
      // The Great Red Spot, an anticyclone in the southern hemisphere.
      vec2 offset = vec2(atan(n.z, n.x), n.y) - vec2(2.15, -0.29);
      float spot = length(offset * vec2(0.52, 2.5));
      c = mix(c, vec3(0.76, 0.33, 0.21), smoothstep(0.32, 0.09, spot));
      return c;
    }
  `,

  // Softer, hazier banding than Jupiter's.
  Saturn: /* glsl */ `
    vec3 surfaceColor(vec3 p) {
      vec3 n = normalize(p);
      float turbulence = fbm(p * 2.3) * 0.08;
      float bands = sin((n.y + turbulence) * 19.0);
      vec3 c = mix(vec3(0.75, 0.65, 0.45), vec3(0.94, 0.88, 0.70), smoothstep(-0.55, 0.55, bands));
      return mix(c, vec3(0.66, 0.60, 0.50), smoothstep(0.65, 1.0, abs(n.y)));
    }
  `,
};

const VERTEX = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vLocal;
  varying vec3 vViewDir;

  void main() {
    vLocal = position;
    // Uniform scale on these meshes, so the model matrix suffices for normals.
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

function fragmentFor(body: PlanetPosition['body']): string {
  const isSun = body === 'Sun';

  return /* glsl */ `
    varying vec3 vWorldNormal;
    varying vec3 vLocal;
    varying vec3 vViewDir;

    uniform vec3 uLightDir;
    uniform float uTerminatorSoftness;
    uniform vec3 uRimColor;
    uniform float uRimStrength;

    ${NOISE}
    ${SURFACES[body]}

    void main() {
      vec3 normal = normalize(vWorldNormal);
      vec3 colour = surfaceColor(normalize(vLocal) * 2.0);

      ${
        isSun
          ? /* glsl */ `
      // Self-luminous, so no terminator — just limb darkening, which is why
      // the Sun's edge looks softer than its centre.
      float mu = max(dot(normal, normalize(vViewDir)), 0.0);
      colour *= 0.62 + 0.38 * pow(mu, 0.45);
      `
          : /* glsl */ `
      // Lambertian, with the terminator where lib/phase.ts puts it.
      float lambert = dot(normal, normalize(uLightDir));
      float lit = smoothstep(-uTerminatorSoftness, uTerminatorSoftness, lambert);
      // A trace of ambient keeps the night side from being a black hole in
      // the sky rather than a body, without pretending it is illuminated.
      colour *= 0.035 + 0.965 * lit;
      `
      }

      // Rim light: a hint of atmosphere on the bodies that have one.
      float rim = pow(1.0 - max(dot(normal, normalize(vViewDir)), 0.0), 3.0);
      colour += uRimColor * rim * uRimStrength;

      gl_FragColor = vec4(colour, 1.0);
    }
  `;
}

/** Atmospheric rim tint per body; airless worlds get none. */
const RIM: Record<PlanetPosition['body'], { color: string; strength: number; softness: number }> = {
  Sun: { color: '#ff9d2f', strength: 0.55, softness: 0.05 },
  Moon: { color: '#000000', strength: 0.0, softness: 0.03 },
  Mercury: { color: '#000000', strength: 0.0, softness: 0.03 },
  Venus: { color: '#ffe9b0', strength: 0.5, softness: 0.14 },
  Mars: { color: '#e0885f', strength: 0.16, softness: 0.07 },
  Jupiter: { color: '#e8cfa8', strength: 0.3, softness: 0.1 },
  Saturn: { color: '#e6d6a8', strength: 0.28, softness: 0.1 },
};

export interface PlanetUniforms {
  uLightDir: { value: THREE.Vector3 };
  uTerminatorSoftness: { value: number };
  uRimColor: { value: THREE.Color };
  uRimStrength: { value: number };
}

export function createPlanetMaterial(body: PlanetPosition['body']): THREE.ShaderMaterial {
  const rim = RIM[body];
  const uniforms: PlanetUniforms = {
    uLightDir: { value: new THREE.Vector3(0, 0, 1) },
    uTerminatorSoftness: { value: rim.softness },
    uRimColor: { value: new THREE.Color(rim.color) },
    uRimStrength: { value: rim.strength },
  };

  return new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: fragmentFor(body),
    // These are emissive-looking objects against a night sky; tone mapping
    // would wash the brighter ones out.
    toneMapped: false,
  });
}

/**
 * Saturn's rings: concentric bands of ice with the Cassini division cut
 * through them. Drawn as a flat annulus, which is what they very nearly are
 * — they are only tens of metres thick across 280,000 km of span.
 */
export function createRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uLightDir: { value: new THREE.Vector3(0, 0, 1) },
      uInner: { value: 1.35 },
      uOuter: { value: 2.3 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorldNormal;
      void main() {
        vLocal = position;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorldNormal;
      uniform vec3 uLightDir;
      uniform float uInner;
      uniform float uOuter;

      ${NOISE}

      void main() {
        float r = length(vLocal.xy);
        float t = (r - uInner) / (uOuter - uInner);
        if (t < 0.0 || t > 1.0) discard;

        // Fine ringlet structure.
        float ringlets = 0.62 + 0.38 * noise(vec3(t * 220.0, 0.0, 0.0));
        float density = ringlets;

        // The Cassini division, and the fainter Encke gap further out.
        density *= smoothstep(0.02, 0.07, abs(t - 0.46));
        density *= 0.35 + 0.65 * smoothstep(0.005, 0.02, abs(t - 0.82));
        // Thin out toward both edges rather than ending abruptly.
        density *= smoothstep(0.0, 0.08, t) * smoothstep(1.0, 0.88, t);

        vec3 ice = mix(vec3(0.78, 0.72, 0.60), vec3(0.95, 0.92, 0.84), ringlets);

        // Lit from whichever face the Sun is on.
        float lambert = abs(dot(normalize(vWorldNormal), normalize(uLightDir)));
        vec3 colour = ice * (0.18 + 0.82 * lambert);

        gl_FragColor = vec4(colour, density);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
}
