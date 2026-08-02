/**
 * The arithmetic of getting somewhere.
 *
 * Everything here is closed-form orbital mechanics — the rocket equation,
 * Hohmann transfers, plane changes, and the geometry of launch windows. No
 * trajectory is integrated and no vehicle is modelled, which is deliberate: a
 * real ascent simulation needs thrust curves, staging and an atmosphere model
 * that this app has no source for, and a fake one dressed up as physics would
 * be worse than none.
 *
 * What these formulae give is exact for the idealised case, and the idealised
 * case is what the textbook figures are. Where reality diverges — drag and
 * gravity losses on ascent, finite burn times, non-coplanar real transfers —
 * it is said so rather than absorbed silently.
 */

/** Standard gravitational parameter of Earth, km^3/s^2. */
export const MU_EARTH = 398_600.4418;
/** ...and of the Sun. */
export const MU_SUN = 1.327_124_400_18e11;

export const EARTH_RADIUS_KM = 6378.137;
export const EARTH_SIDEREAL_DAY_S = 86_164.0905;
export const AU_KM = 149_597_870.7;

const DEG = Math.PI / 180;

/** Circular orbital speed at a given radius from the centre, km/s. */
export function circularSpeed(radiusKm: number, mu = MU_EARTH): number {
  return Math.sqrt(mu / radiusKm);
}

/** Orbital period for a semi-major axis, seconds. */
export function orbitalPeriod(semiMajorAxisKm: number, mu = MU_EARTH): number {
  return 2 * Math.PI * Math.sqrt(semiMajorAxisKm ** 3 / mu);
}

/**
 * Speed a surface point carries from Earth's rotation, km/s.
 *
 * This is why launch sites are near the equator and why launching eastward is
 * nearly free speed: at the equator the ground is already moving at 465 m/s.
 */
export function rotationalAssistKmS(latitudeDeg: number): number {
  return ((2 * Math.PI * EARTH_RADIUS_KM) / EARTH_SIDEREAL_DAY_S) * Math.cos(latitudeDeg * DEG);
}

/**
 * Lowest inclination reachable directly from a launch site.
 *
 * A launch site sits on a circle of latitude, and every orbit passes over the
 * launch point, so the orbit cannot be inclined less than that latitude
 * without a plane change after launch. This is the single hardest constraint
 * in launch planning and the reason equatorial sites are prized.
 */
export function minimumInclinationDeg(latitudeDeg: number): number {
  return Math.abs(latitudeDeg);
}

/**
 * Highest latitude an orbit's ground track ever reaches.
 *
 * For a prograde orbit this is just the inclination, which is why it is easy to
 * assume they are the same thing. They are not: a retrograde orbit inclined 98
 * degrees — the sun-synchronous case, and a large share of the catalogue —
 * reaches only 82 degrees, because past 90 the track leans back toward the
 * equator. Comparing a site's latitude against the raw inclination therefore
 * tells an observer inside that 82-to-98 band that an orbit is reachable when
 * it never passes overhead at all.
 */
export function maxGroundTrackLatitudeDeg(inclinationDeg: number): number {
  const wrapped = normaliseDeg(inclinationDeg);
  const folded = wrapped > 180 ? 360 - wrapped : wrapped;
  return folded > 90 ? 180 - folded : folded;
}

/** Whether a site can reach an inclination directly, retrograde orbits included. */
export function inclinationReachableFrom(latitudeDeg: number, inclinationDeg: number): boolean {
  return Math.abs(latitudeDeg) <= maxGroundTrackLatitudeDeg(inclinationDeg) + 1e-9;
}

/**
 * Launch azimuth needed to reach a given inclination from a given latitude.
 *
 * Returns null when the inclination is unreachable — the geometry has no
 * solution below the site's latitude, and returning a plausible-looking
 * number there would be inventing one. Also null at the geographic poles,
 * where the answer is indeterminate rather than absent: every direction from
 * the North Pole is south, and any of them enters a polar orbit. Use
 * `inclinationReachableFrom` to ask whether an orbit is reachable at all.
 */
export function launchAzimuthDeg(latitudeDeg: number, inclinationDeg: number): number | null {
  const cosLat = Math.cos(latitudeDeg * DEG);
  if (Math.abs(cosLat) < 1e-9) return null;
  const ratio = Math.cos(inclinationDeg * DEG) / cosLat;
  // A site sitting exactly at the orbit's turning latitude is a real, launchable
  // case — the heading there is due east, or due west for a retrograde orbit —
  // but the ratio lands a few ulps outside the domain of asin, so rejecting it
  // outright would refuse a launch that geometry permits. Admit that slop, then
  // clamp; anything genuinely beyond it is still unreachable.
  if (ratio < -1 - 1e-9 || ratio > 1 + 1e-9) return null;
  // Measured clockwise from north; the ascending (north-easterly) solution.
  return (Math.asin(Math.max(-1, Math.min(1, ratio))) / DEG + 360) % 360;
}

/**
 * Delta-v to change an orbital plane by a given angle at a given speed.
 *
 * Brutally expensive, which is the point: turning a 7.7 km/s orbit by 30
 * degrees costs about 4 km/s, comparable to reaching orbit in the first
 * place. It is why you launch into the plane you want.
 */
export function planeChangeDeltaV(speedKmS: number, angleDeg: number): number {
  return 2 * speedKmS * Math.sin((angleDeg * DEG) / 2);
}

export interface HohmannTransfer {
  /** Burn to leave the inner orbit, km/s. */
  departureDeltaV: number;
  /** Burn to circularise at the outer orbit, km/s. */
  arrivalDeltaV: number;
  totalDeltaV: number;
  /** Half the transfer ellipse's period — the actual flight time, seconds. */
  flightTimeSeconds: number;
}

/**
 * The two-burn minimum-energy transfer between coplanar circular orbits.
 *
 * Works in either direction: raising or lowering. The delta-v figures come out
 * positive both ways because what matters is the magnitude of the burn, not
 * its sign.
 */
export function hohmannTransfer(fromRadiusKm: number, toRadiusKm: number, mu = MU_EARTH): HohmannTransfer {
  const a = (fromRadiusKm + toRadiusKm) / 2;

  const v1 = circularSpeed(fromRadiusKm, mu);
  const v2 = circularSpeed(toRadiusKm, mu);
  // Vis-viva at each end of the transfer ellipse.
  const vTransfer1 = Math.sqrt(mu * (2 / fromRadiusKm - 1 / a));
  const vTransfer2 = Math.sqrt(mu * (2 / toRadiusKm - 1 / a));

  return {
    departureDeltaV: Math.abs(vTransfer1 - v1),
    arrivalDeltaV: Math.abs(v2 - vTransfer2),
    totalDeltaV: Math.abs(vTransfer1 - v1) + Math.abs(v2 - vTransfer2),
    flightTimeSeconds: orbitalPeriod(a, mu) / 2,
  };
}

/**
 * Wet-to-dry mass ratio required for a given delta-v — the rocket equation.
 *
 * This is where the exponential cruelty actually shows. Doubling the delta-v
 * *squares* the mass ratio: 4.7 km/s needs about 2.9 times the dry mass, and
 * 9.4 km/s needs about 8.4, not 5.8.
 */
export function massRatio(deltaVKmS: number, exhaustVelocityKmS: number): number {
  return Math.exp(deltaVKmS / exhaustVelocityKmS);
}

/**
 * Fraction of the starting mass that has to be propellant.
 *
 * Note this saturates toward 1 rather than growing without bound — a vehicle
 * cannot be more than all propellant — so it is the mass ratio above, not this,
 * that shows how the cost compounds.
 */
export function propellantMassFraction(deltaVKmS: number, exhaustVelocityKmS: number): number {
  return 1 - 1 / massRatio(deltaVKmS, exhaustVelocityKmS);
}

/** Exhaust velocity from specific impulse, km/s. */
export function exhaustVelocityKmS(specificImpulseSeconds: number): number {
  return (specificImpulseSeconds * 9.80665) / 1000;
}

export interface LaunchWindow {
  /** When the site's rotation carries it into the target's orbital plane. */
  time: Date;
  /** Compass bearing to launch along to enter that plane. */
  azimuthDeg: number;
  /** Which of the two daily crossings this is. */
  node: 'ascending' | 'descending';
}

/**
 * When a launch site passes through a target orbital plane.
 *
 * This is the real constraint that makes launch windows instantaneous for
 * rendezvous missions. A rocket cannot meaningfully change plane after launch,
 * so it must lift off at the moment its site rotates through the target's
 * orbital plane — which for an inclined orbit happens twice a day, and for an
 * orbit inclined less than the site's latitude, never.
 *
 * The plane is specified by its inclination and right ascension of the
 * ascending node; both come straight out of a TLE.
 */
export function launchWindows(
  latitudeDeg: number,
  longitudeDeg: number,
  inclinationDeg: number,
  raanDeg: number,
  from: Date,
  hours = 24
): LaunchWindow[] {
  if (!inclinationReachableFrom(latitudeDeg, inclinationDeg)) return [];

  const azimuth = launchAzimuthDeg(latitudeDeg, inclinationDeg);
  if (azimuth === null) return [];

  const windows: LaunchWindow[] = [];
  // Angle from the ascending node to the site's latitude, along the orbit.
  const sinArg = Math.sin(latitudeDeg * DEG) / Math.sin(inclinationDeg * DEG);
  if (sinArg < -1 || sinArg > 1) return [];
  const argument = Math.asin(sinArg) / DEG;

  // Longitude, relative to the node, at which the ground track crosses this
  // latitude — once heading north, once heading south.
  for (const [node, arg] of [
    ['ascending', argument],
    ['descending', 180 - argument],
  ] as const) {
    const deltaLon =
      Math.atan2(
        Math.sin(arg * DEG) * Math.cos(inclinationDeg * DEG),
        Math.cos(arg * DEG)
      ) / DEG;

    // Sidereal time at which the site sits under that point, then stepped
    // forward into the requested window.
    const targetGst = raanDeg + deltaLon - longitudeDeg;
    const nowGst = greenwichSiderealDeg(from);
    const ahead = normaliseDeg(targetGst - nowGst);

    // The Earth turns 360 degrees of sidereal angle per sidereal day.
    for (let turn = 0; ; turn++) {
      const seconds = ((ahead + turn * 360) / 360) * EARTH_SIDEREAL_DAY_S;
      if (seconds > hours * 3600) break;
      windows.push({
        time: new Date(from.getTime() + seconds * 1000),
        azimuthDeg: node === 'ascending' ? azimuth : (180 - azimuth + 360) % 360,
        node,
      });
      if (turn > 10) break;
    }
  }

  return windows.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * Greenwich mean sidereal time in degrees.
 *
 * The standard polynomial in Julian centuries from J2000. Accurate to well
 * under a second of time over any span this app cares about.
 */
export function greenwichSiderealDeg(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const t = (jd - 2_451_545.0) / 36_525;
  const gmst =
    280.46061837 +
    360.98564736629 * (jd - 2_451_545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38_710_000;
  return ((gmst % 360) + 360) % 360;
}

/**
 * Synodic period between two circular orbits — how often their relative
 * geometry repeats, and therefore how often a transfer window comes round.
 */
export function synodicPeriodDays(periodADays: number, periodBDays: number): number {
  if (periodADays === periodBDays) return Infinity;
  return Math.abs(1 / (1 / periodADays - 1 / periodBDays));
}

/**
 * Where the target must be, relative to the departure body, at the moment of
 * departure — expressed as the angle it leads by.
 *
 * The transfer takes half the transfer ellipse's period, during which the
 * target moves on. Aim at where it is now and you arrive at empty space.
 */
export function phaseAngleAtDepartureDeg(
  departureRadiusKm: number,
  targetRadiusKm: number,
  mu = MU_SUN
): number {
  const transfer = hohmannTransfer(departureRadiusKm, targetRadiusKm, mu);
  const targetPeriod = orbitalPeriod(targetRadiusKm, mu);
  // How far the target travels during the flight, subtracted from the half
  // turn the spacecraft makes.
  const targetTravelDeg = (transfer.flightTimeSeconds / targetPeriod) * 360;
  return normaliseDeg(180 - targetTravelDeg);
}

export function normaliseDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}
