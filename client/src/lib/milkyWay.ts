import * as THREE from 'three';
import { raDecToEquatorial } from './celestial';

/**
 * The Milky Way, as a procedural band on the inside of the sky sphere.
 *
 * The geometry is a plain inward-facing sphere; all the structure comes from
 * the shader, which converts each fragment's direction into galactic
 * coordinates and shades from there. That is what puts the band in the right
 * place: it runs along galactic latitude zero by construction rather than
 * being drawn somewhere and hoped over, so it rotates correctly with the sky
 * and lands across the right constellations.
 *
 * The brightness structure — thicker and brighter toward the galactic centre,
 * split by a dark rift — is characteristic rather than photographic. It is
 * shaped noise that reads like the Milky Way to the eye, not a survey image.
 */

/** North galactic pole and galactic centre, J2000. */
const NORTH_GALACTIC_POLE = { ra: 192.85948, dec: 27.12825 };
const GALACTIC_CENTRE = { ra: 266.4051, dec: -28.936175 };

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    // Object space is the equatorial frame here: the layer is mounted inside
    // the same rotating group that carries the stars.
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec3 vDirection;

  uniform vec3 uPole;      // north galactic pole
  uniform vec3 uCentre;    // galactic centre (l = 0)
  uniform vec3 uQuarter;   // l = 90 degrees, completing the frame
  uniform float uIntensity;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i);
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  /**
   * Three octaves, not five.
   *
   * This shader is the most expensive thing in the scene by a wide margin —
   * it covers the whole sky and every fragment pays for it. Measured by
   * layer, it cost more than every satellite, star and constellation put
   * together. The fourth and fifth octaves contribute detail finer than the
   * band's own softness, so they were paying full price for nothing.
   */
  float fbm(vec3 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
      sum += amplitude * noise(p);
      p *= 2.03;
      amplitude *= 0.5;
    }
    return sum;
  }

  void main() {
    vec3 dir = normalize(vDirection);

    // Galactic coordinates from the equatorial direction.
    float sinB = clamp(dot(dir, uPole), -1.0, 1.0);
    float b = asin(sinB);
    float l = atan(dot(dir, uQuarter), dot(dir, uCentre));

    // The disc is thicker toward the centre, where the bulge is.
    float towardCentre = cos(l) * 0.5 + 0.5;
    float thickness = 0.085 + 0.10 * pow(towardCentre, 2.0);

    // Core band, plus a narrow halo so the edges do not end abruptly. The
    // halo is deliberately weak: the real Milky Way fades into darkness
    // within a couple of band-widths, and a broad glow reads as haze.
    float band = exp(-(b * b) / (2.0 * thickness * thickness));
    float halo = exp(-(b * b) / (2.0 * pow(thickness * 2.2, 2.0))) * 0.16;

    // Brighter toward Sagittarius, dimmer toward the anticentre.
    float longitudeGain = 0.3 + 0.95 * pow(towardCentre, 1.6);

    // Mottling. Sampled in direction space so the structure is fixed on the
    // sky rather than swimming as the view moves. Weighted so most of the
    // band's brightness comes from the clouds rather than a flat floor —
    // that contrast is what stops it looking like fog.
    //
    // Two scales, from two fbm calls rather than three: the rift below reuses
    // the coarse one instead of sampling its own field, which is one fewer
    // full noise evaluation on every fragment of the sky.
    float coarse = fbm(dir * 4.5);
    float clouds = coarse * 0.8 + fbm(dir * 18.0) * 0.4;
    clouds = pow(clamp(clouds, 0.0, 1.0), 1.5);

    // The dark rift: dust lanes cutting the band lengthwise, strongest
    // between the centre and Cygnus. Driven by the coarse field offset in
    // value rather than by a third noise field — the lanes only need to be
    // decorrelated from the clouds, not independent of them.
    float riftNoise = fract(coarse * 3.7 + 0.31);
    float riftCore = exp(-pow((b + 0.035) / 0.075, 2.0));
    float rift = riftCore * smoothstep(0.3, 0.7, riftNoise) * (0.35 + 0.65 * towardCentre);

    float brightness = (band + halo) * longitudeGain * (0.2 + 1.4 * clouds);
    brightness *= (1.0 - 0.9 * rift);
    brightness *= uIntensity;

    if (brightness <= 0.001) discard;

    // Slightly warm toward the centre, cooler in the outer arms — the same
    // direction the real colour runs, though nothing like as saturated.
    vec3 warm = vec3(0.62, 0.60, 0.55);
    vec3 cool = vec3(0.48, 0.54, 0.66);
    vec3 colour = mix(cool, warm, towardCentre);

    // Alpha stays at one: with additive blending the source is scaled by
    // alpha, so folding brightness into both channels would square it and
    // make the falloff impossible to reason about.
    gl_FragColor = vec4(colour * brightness, 1.0);
  }
`;

/**
 * Default brightness. The Milky Way is a subtle thing even under a dark sky —
 * pushed any higher it stops reading as a band and starts reading as haze, and
 * it drowns the stars it is supposed to sit behind.
 */
const DEFAULT_INTENSITY = 0.16;

/**
 * The galactic frame, in equatorial coordinates.
 *
 * Shared by the shader's uniforms and by equatorialToGalactic below, so the
 * tests exercise the same axes the band is actually drawn from — two copies
 * would let one drift without the other complaining.
 */
function galacticFrame(): { pole: THREE.Vector3; centre: THREE.Vector3; quarter: THREE.Vector3 } {
  const pole = new THREE.Vector3(...raDecToEquatorial(NORTH_GALACTIC_POLE.ra, NORTH_GALACTIC_POLE.dec));
  const centre = new THREE.Vector3(...raDecToEquatorial(GALACTIC_CENTRE.ra, GALACTIC_CENTRE.dec));

  // The centre is not exactly perpendicular to the pole once both are rounded,
  // so orthogonalise before building the third axis. Skipping this would skew
  // galactic longitude by a fraction of a degree — invisible, but the frame
  // should be a frame.
  centre.sub(pole.clone().multiplyScalar(centre.dot(pole))).normalize();
  const quarter = new THREE.Vector3().crossVectors(pole, centre).normalize();
  return { pole, centre, quarter };
}

export function createMilkyWayMaterial(intensity = DEFAULT_INTENSITY): THREE.ShaderMaterial {
  const { pole, centre, quarter } = galacticFrame();

  return new THREE.ShaderMaterial({
    uniforms: {
      uPole: { value: pole },
      uCentre: { value: centre },
      uQuarter: { value: quarter },
      uIntensity: { value: intensity },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Galactic coordinates for a direction in the equatorial frame, in degrees.
 * Exported for testing the frame the shader is handed — the shader itself
 * cannot be asserted on directly.
 */
export function equatorialToGalactic(x: number, y: number, z: number): { l: number; b: number } {
  const { pole, centre, quarter } = galacticFrame();
  const dir = new THREE.Vector3(x, y, z).normalize();
  const b = Math.asin(THREE.MathUtils.clamp(dir.dot(pole), -1, 1));
  const l = Math.atan2(dir.dot(quarter), dir.dot(centre));
  return {
    l: ((THREE.MathUtils.radToDeg(l) % 360) + 360) % 360,
    b: THREE.MathUtils.radToDeg(b),
  };
}
