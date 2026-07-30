import { azElToVec3 } from './sky';

/**
 * Working out how a planet should actually be lit as seen from the ground.
 *
 * Two things have to be right for a rendered planet to match what a telescope
 * would show, and they come from different places:
 *
 *  - **How much of the disc is lit.** This is the illuminated fraction
 *    astronomy-engine reports, and it cannot be derived from sky positions
 *    alone. Venus near the Sun in the sky may be a thin crescent (near side
 *    of its orbit) or nearly full (far side); the two look identical on a
 *    star chart and completely different through an eyepiece.
 *
 *  - **Which way the lit side faces.** The bright limb always points toward
 *    the Sun's position on the sky. This is why a crescent Moon low after
 *    sunset is lit from below, and it is what makes a rendered phase look
 *    right rather than arbitrarily rotated.
 *
 * So the light direction is constructed rather than placed: take the angle
 * that produces the reported illuminated fraction, then swing it toward the
 * Sun's actual sky position. Simply putting a light at the Sun's dome
 * position would fix the orientation but always render a half-lit disc,
 * since the dome is a direction sphere and carries no real distances.
 */

export interface SkyDirection {
  azimuthDeg: number;
  elevationDeg: number;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Phase angle (Sun-planet-observer) that yields a given illuminated fraction.
 *
 * The classic relation for a sphere is f = (1 + cos alpha) / 2, so a fully
 * lit disc is a phase angle of zero and a fraction of 0.5 is a right angle.
 */
export function phaseAngleFor(illuminatedFraction: number): number {
  const clamped = Math.max(0, Math.min(1, illuminatedFraction));
  return Math.acos(2 * clamped - 1);
}

/**
 * Unit vector pointing from the body toward the Sun, in scene coordinates.
 *
 * Returned in the frame the dome uses (+X east, +Y up, -Z north), ready to be
 * handed to a shader as a light direction.
 */
export function sunwardDirection(
  body: SkyDirection,
  sun: SkyDirection,
  illuminatedFraction: number | null
): [number, number, number] {
  const toBody = normalise(azElToVec3(body.azimuthDeg, body.elevationDeg, 1));
  const toSun = normalise(azElToVec3(sun.azimuthDeg, sun.elevationDeg, 1));

  // Direction from the observer toward the body is also, to the accuracy that
  // matters here, the direction the observer sees the body's centre along.
  // The vector we want lies in the plane containing that and the Sun.
  let perpendicular = cross(cross(toBody, toSun), toBody);
  const perpendicularLength = Math.hypot(...perpendicular);

  if (perpendicularLength < 1e-6) {
    // The body sits essentially on top of the Sun (or exactly opposite it),
    // so the plane is undefined and there is no meaningful limb direction.
    // Light it head-on rather than picking an arbitrary rotation.
    return [-toBody[0], -toBody[1], -toBody[2]];
  }
  perpendicular = [
    perpendicular[0] / perpendicularLength,
    perpendicular[1] / perpendicularLength,
    perpendicular[2] / perpendicularLength,
  ];

  // With no reported phase, fall back to fully lit — better than inventing a
  // crescent for a body whose illumination we were never told.
  const alpha = illuminatedFraction === null ? 0 : phaseAngleFor(illuminatedFraction);

  // Start from "lit straight at the observer" (alpha = 0) and rotate by the
  // phase angle in the plane containing the Sun, so the bright limb ends up
  // facing the Sun's side of the sky.
  const towardObserver: [number, number, number] = [-toBody[0], -toBody[1], -toBody[2]];
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);

  return normalise([
    towardObserver[0] * cosA + perpendicular[0] * sinA,
    towardObserver[1] * cosA + perpendicular[1] * sinA,
    towardObserver[2] * cosA + perpendicular[2] * sinA,
  ]);
}

/**
 * Fraction of the disc that a given light direction actually lights, as seen
 * from the observer. Inverse of the construction above, used to verify it.
 */
export function illuminatedFractionFrom(
  body: SkyDirection,
  lightDirection: [number, number, number]
): number {
  const toBody = normalise(azElToVec3(body.azimuthDeg, body.elevationDeg, 1));
  const towardObserver: [number, number, number] = [-toBody[0], -toBody[1], -toBody[2]];
  const cosAlpha = dot(normalise(lightDirection), towardObserver);
  return (1 + Math.max(-1, Math.min(1, cosAlpha))) / 2;
}
