/**
 * Turning phone orientation sensors into a sky-viewing direction.
 *
 * The browser reports orientation as three intrinsic Z-X'-Y'' Euler angles
 * (alpha, beta, gamma) describing how the device is rotated out of a
 * reference frame in which it lies flat, screen up, with its top edge toward
 * the reference direction. Composing those gives a rotation matrix whose
 * third column is the world-space direction of the device's +Z axis — the
 * axis pointing out of the screen.
 *
 * A phone held up to the sky points its *back* at the target, so the viewing
 * direction is the negation of that: -Z, out through the camera.
 *
 * The one genuinely platform-dependent part is north. `alpha` is measured
 * from an arbitrary origin on most Android devices unless the "absolute"
 * event variant is used, while iOS exposes a separate `webkitCompassHeading`
 * that is already true-north referenced. Without one of those, the azimuth
 * is a relative bearing rather than a compass one.
 *
 * Screen rotation deliberately plays no part here. Which way the UI has been
 * rotated does not change where the phone is physically pointing; it only
 * affects roll, and the sky dome's camera is roll-free (its up vector is
 * always world up), so there is nothing to correct for.
 *
 * Accuracy caveat worth passing on to users: phone magnetometers are
 * genuinely mediocre. Even a well-calibrated handset is typically only good
 * to roughly 10-15 degrees, and nearby metal, magnets or cases make it
 * worse. This is a "point roughly there" aid, not an instrument.
 */

const DEG = Math.PI / 180;

export interface OrientationSample {
  /** Rotation about the vertical axis, degrees, counter-clockwise from the reference. */
  alpha: number;
  /** Front-to-back tilt, degrees. */
  beta: number;
  /** Left-to-right tilt, degrees. */
  gamma: number;
  /**
   * True-north-referenced heading in degrees clockwise, when the platform
   * supplies one directly (iOS `webkitCompassHeading`). When present this
   * replaces `alpha`, which is otherwise relative to an arbitrary origin.
   */
  compassHeading?: number | null;
}

export interface LookDirection {
  /** Degrees clockwise from true north. */
  azimuthDeg: number;
  /** Degrees above the horizon; negative means pointing at the ground. */
  elevationDeg: number;
}

/**
 * Where the back of the phone is pointing, as a sky azimuth and elevation.
 *
 * Written as an explicit matrix-column computation rather than via quaternion
 * helpers so the geometry stays checkable: the closed form below is the third
 * column of Rz(alpha)·Rx(beta)·Ry(gamma).
 */
export function lookDirectionFrom(sample: OrientationSample): LookDirection {
  // webkitCompassHeading runs clockwise from north; alpha runs counter-clockwise.
  const alphaDeg = sample.compassHeading != null ? 360 - sample.compassHeading : sample.alpha;

  const a = alphaDeg * DEG;
  const b = sample.beta * DEG;
  const g = sample.gamma * DEG;

  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);

  // World-space direction of the device's +Z axis (out of the screen).
  const zx = cA * sG + sA * sB * cG;
  const zy = sA * sG - cA * sB * cG;
  const zz = cB * cG;

  // The camera looks the other way, out of the back of the phone.
  const vx = -zx;
  const vy = -zy;
  const vz = -zz;

  // In this frame x is east, y is north, z is up. Normalised with a double
  // modulo rather than a single "+360 if negative": a tiny negative angle
  // would otherwise land on exactly 360 once rounded, which is out of range.
  const azimuthDeg = ((Math.atan2(vx, vy) / DEG) % 360 + 360) % 360;

  return {
    azimuthDeg,
    elevationDeg: Math.atan2(vz, Math.hypot(vx, vy)) / DEG,
  };
}

/**
 * How far the phone is rolled about the direction it is pointing.
 *
 * Zero means the top of the screen is as close to straight up as it can be for
 * this pointing direction; positive is a clockwise roll as the viewer sees it.
 * Portrait held normally gives roughly zero, landscape gives roughly ninety.
 *
 * Not currently applied to the rendered view, which is a real gap: the camera
 * is aimed through OrbitControls, and OrbitControls pins the camera's up vector
 * to world up. So the direction the dome shows is right at any attitude while
 * the rotation of the sky on screen is only right in portrait — hold the phone
 * sideways and the constellations appear turned by this angle relative to what
 * is actually behind the handset.
 *
 * Exported so the size of that error is measurable rather than assumed, and so
 * a fix has the value it needs.
 */
export function screenRollFrom(sample: OrientationSample): number {
  const alphaDeg = sample.compassHeading != null ? 360 - sample.compassHeading : sample.alpha;
  const a = alphaDeg * DEG;
  const b = sample.beta * DEG;
  const g = sample.gamma * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cG = Math.cos(g), sG = Math.sin(g);

  // Second column of Rz(alpha)·Rx(beta)·Ry(gamma): the device's +Y axis, which
  // is "up the screen", expressed in the east/north/up world frame.
  const yx = -sA * cB;
  const yy = cA * cB;
  const yz = sB;

  // Third column, negated: where the camera looks. Same as lookDirectionFrom.
  const vx = -(cA * sG + sA * sB * cG);
  const vy = -(sA * sG - cA * sB * cG);
  const vz = -(cB * cG);

  // World up, with the component along the view direction removed, is the
  // reference "up" in the image plane. The roll is the signed angle from that
  // reference to the screen's own up, measured about the view direction.
  const upDot = vz;
  const rx = -vx * upDot;
  const ry = -vy * upDot;
  const rz = 1 - vz * upDot;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-9) return 0; // Pointing at the zenith or nadir: roll is undefined.

  const ux = rx / rl, uy = ry / rl, uz = rz / rl;
  const cos = ux * yx + uy * yy + uz * yz;
  // Sign from whether screen-up leans along (view x reference-up).
  const crossX = vy * uz - vz * uy;
  const crossY = vz * ux - vx * uz;
  const crossZ = vx * uy - vy * ux;
  const sin = crossX * yx + crossY * yy + crossZ * yz;
  return (Math.atan2(sin, cos) / DEG);
}

/**
 * Whether this browser can report device orientation at all.
 *
 * Presence of the event constructor is necessary but not sufficient — a
 * desktop browser exposes it and simply never fires it — so callers should
 * also treat "no sample arrived within a second or two" as unsupported.
 */
export function orientationSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.DeviceOrientationEvent !== 'undefined';
}

/**
 * Whether this platform gates the sensor behind an explicit permission call.
 * iOS 13+ requires requestPermission() from inside a user gesture.
 */
export function orientationNeedsPermission(): boolean {
  return (
    orientationSupported() &&
    typeof (window.DeviceOrientationEvent as unknown as { requestPermission?: unknown })
      .requestPermission === 'function'
  );
}

export type OrientationPermission = 'granted' | 'denied' | 'unsupported';

/**
 * Ask for sensor access. Must be called from a user gesture on iOS, or the
 * request is rejected outright.
 */
export async function requestOrientationPermission(): Promise<OrientationPermission> {
  if (!orientationSupported()) return 'unsupported';
  if (!orientationNeedsPermission()) return 'granted';

  try {
    const request = (
      window.DeviceOrientationEvent as unknown as {
        requestPermission: () => Promise<'granted' | 'denied'>;
      }
    ).requestPermission;
    return (await request()) === 'granted' ? 'granted' : 'denied';
  } catch {
    // Thrown when not called from a user gesture, among other cases.
    return 'denied';
  }
}

/**
 * Shortest signed difference between two bearings, in degrees.
 * Keeps smoothing from taking the long way round past 360.
 */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  let delta = (toDeg - fromDeg) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/**
 * Exponential smoothing over the shortest path around the compass.
 *
 * Raw magnetometer output is noisy enough to make the view visibly jitter, so
 * samples are low-passed before they reach the camera. `factor` is the
 * fraction of the remaining gap closed per update.
 */
export function smoothAngle(currentDeg: number, targetDeg: number, factor: number): number {
  const next = currentDeg + shortestAngleDelta(currentDeg, targetDeg) * factor;
  return ((next % 360) + 360) % 360;
}
