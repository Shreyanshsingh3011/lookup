import * as satellite from 'satellite.js';
import {
  EARTH_RADIUS_KM,
  MU_EARTH,
  circularSpeed,
  exhaustVelocityKmS,
  greenwichSiderealDeg,
  hohmannTransfer,
  launchAzimuthDeg,
  massRatio,
  rotationalAssistKmS,
} from './orbitalMechanics';

/**
 * When you could launch from here to catch something already in orbit.
 *
 * A rocket cannot meaningfully change its orbital plane after launch — turning
 * a low orbit by even thirty degrees costs about as much as reaching orbit in
 * the first place — so a rendezvous mission must lift off at the moment its pad
 * rotates through the target's plane. That is why crewed launches to the
 * station have instantaneous windows and why a scrub costs a day.
 *
 * The plane is taken from SGP4 at each instant rather than from the raw right
 * ascension in the elements. The distinction matters: Earth's equatorial bulge
 * drags the station's node westward by about five degrees a day, so a window
 * computed from a fixed node is already tens of minutes wrong by tomorrow and
 * badly wrong by next week.
 */

const DEG = Math.PI / 180;

export interface PlaneState {
  /** Unit normal to the orbital plane, TEME. */
  normal: [number, number, number];
  inclinationDeg: number;
  raanDeg: number;
}

/**
 * The orbital plane at an instant, from the propagated state vector.
 *
 * Returns null when SGP4 declines to produce a state — a decayed object or a
 * TLE propagated far past its usable span — rather than a plane derived from
 * whatever numbers came back.
 */
export function planeAt(satrec: satellite.SatRec, date: Date): PlaneState | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || !pv.velocity) return null;
  const r = pv.position as satellite.EciVec3<number>;
  const v = pv.velocity as satellite.EciVec3<number>;

  // Specific angular momentum: perpendicular to the orbit, so it *is* the plane.
  const hx = r.y * v.z - r.z * v.y;
  const hy = r.z * v.x - r.x * v.z;
  const hz = r.x * v.y - r.y * v.x;
  const h = Math.hypot(hx, hy, hz);
  if (!Number.isFinite(h) || h === 0) return null;

  const normal: [number, number, number] = [hx / h, hy / h, hz / h];
  const inclinationDeg = Math.acos(Math.max(-1, Math.min(1, normal[2]))) / DEG;
  // The ascending node lies along z cross h, which is (-h_y, h_x, 0).
  const raanDeg = ((Math.atan2(normal[0], -normal[1]) / DEG) % 360 + 360) % 360;

  return { normal, inclinationDeg, raanDeg };
}

/** Unit vector to a ground site in the same TEME frame, at a given time. */
export function siteDirection(latitudeDeg: number, longitudeDeg: number, date: Date): [number, number, number] {
  const theta = (greenwichSiderealDeg(date) + longitudeDeg) * DEG;
  const lat = latitudeDeg * DEG;
  return [Math.cos(lat) * Math.cos(theta), Math.cos(lat) * Math.sin(theta), Math.sin(lat)];
}

export interface RendezvousWindow {
  time: Date;
  /** Compass bearing to launch along. */
  azimuthDeg: number;
  node: 'ascending' | 'descending';
  /** The target's inclination at that moment. */
  inclinationDeg: number;
}

const STEP_MINUTES = 5;

/**
 * Times the site passes through the target's orbital plane.
 *
 * Root-finds the site's angular distance from the plane. That distance is zero
 * exactly when the pad is in the plane, and it changes sign there, so a sign
 * change between two samples brackets a window. Sampling every five minutes is
 * comfortably finer than the roughly six hours between the two daily crossings.
 */
export function rendezvousWindows(
  satrec: satellite.SatRec,
  latitudeDeg: number,
  longitudeDeg: number,
  from: Date,
  hours = 48
): RendezvousWindow[] {
  // Out-of-plane angle of the site, in degrees: positive on one side, negative
  // on the other, zero in the plane.
  const offset = (time: number): number | null => {
    const date = new Date(time);
    const plane = planeAt(satrec, date);
    if (!plane) return null;
    const site = siteDirection(latitudeDeg, longitudeDeg, date);
    const dot = site[0] * plane.normal[0] + site[1] * plane.normal[1] + site[2] * plane.normal[2];
    return Math.asin(Math.max(-1, Math.min(1, dot))) / DEG;
  };

  const windows: RendezvousWindow[] = [];
  const stepMs = STEP_MINUTES * 60_000;
  const end = from.getTime() + hours * 3600_000;

  let previousTime = from.getTime();
  let previous = offset(previousTime);
  if (previous === null) return [];

  for (let time = previousTime + stepMs; time <= end; time += stepMs) {
    const current = offset(time);
    if (current === null) break;

    if (previous !== 0 && previous < 0 !== current < 0) {
      const rising = current > previous;
      let lo = previousTime;
      let hi = time;
      for (let i = 0; i < 40 && hi - lo > 1000; i++) {
        const mid = (lo + hi) / 2;
        const value = offset(mid);
        if (value === null) break;
        if (rising ? value < 0 : value > 0) lo = mid;
        else hi = mid;
      }

      const when = new Date(hi);
      const plane = planeAt(satrec, when);
      if (plane) {
        const azimuth = launchAzimuthDeg(latitudeDeg, plane.inclinationDeg);
        if (azimuth !== null) {
          const node = nodeTypeAt(plane, latitudeDeg, longitudeDeg, when);
          windows.push({
            time: when,
            azimuthDeg: node === 'ascending' ? azimuth : (180 - azimuth + 360) % 360,
            node,
            inclinationDeg: plane.inclinationDeg,
          });
        }
      }
    }

    previous = current;
    previousTime = time;
  }

  return windows;
}

/**
 * Which of the two daily crossings this is.
 *
 * Measured by the site's argument of latitude — its angle round the orbit from
 * the ascending node. On the quarter-turn either side of that node the
 * satellite is climbing north over the site, which is the ascending
 * opportunity; the other crossing, half an orbit away, is descending.
 */
function nodeTypeAt(
  plane: PlaneState,
  latitudeDeg: number,
  longitudeDeg: number,
  date: Date
): 'ascending' | 'descending' {
  const site = siteDirection(latitudeDeg, longitudeDeg, date);
  const [nx, ny] = [Math.cos(plane.raanDeg * DEG), Math.sin(plane.raanDeg * DEG)];
  const [hx, hy, hz] = plane.normal;
  const alongNode = site[0] * nx + site[1] * ny;
  // A quarter turn further round the orbit in the direction of travel: the
  // plane normal crossed with the node direction.
  const [mx, my, mz] = [-hz * ny, hz * nx, hx * ny - hy * nx];
  const alongTravel = site[0] * mx + site[1] * my + site[2] * mz;
  const argument = Math.atan2(alongTravel, alongNode) / DEG;
  return argument > -90 && argument < 90 ? 'ascending' : 'descending';
}

export interface AscentBudget {
  /** Speed the orbit itself requires, km/s. */
  orbitalSpeedKmS: number;
  /** Free speed the site's rotation contributes along the launch heading. */
  rotationAssistKmS: number;
  /** Empirical allowance for gravity and drag losses — not derived. */
  lossesKmS: number;
  totalKmS: number;
  /** Wet-to-dry mass ratio this demands of the vehicle. */
  massRatio: number;
  propellantFraction: number;
}

/**
 * A first-order ascent budget.
 *
 * The orbital speed and the rotational assist are exact. The loss term is not:
 * gravity and drag losses depend on the vehicle's thrust-to-weight, its pitch
 * programme and the atmosphere it climbs through, none of which this app
 * models. 1.5 to 2.0 km/s is the range real launchers actually pay, and 1.7 is
 * taken as representative. It is an allowance quoted from practice, not a
 * number derived from anything here, and it is labelled as such wherever it is
 * shown.
 */
export const REPRESENTATIVE_LOSSES_KMS = 1.7;

export interface TargetOrbit {
  semiMajorAxisKm: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  meanAltitudeKm: number;
  eccentricity: number;
}

/**
 * Where the target actually is, from its own element set.
 *
 * Mean motion fixes the semi-major axis, and eccentricity splits that into
 * perigee and apogee. Reading these rather than assuming a low orbit is what
 * stops a budget for a satellite twenty thousand kilometres up being labelled
 * with someone else's altitude.
 */
export function targetOrbit(satrec: satellite.SatRec): TargetOrbit | null {
  // satrec.no is mean motion in radians per minute.
  const n = satrec.no / 60;
  if (!Number.isFinite(n) || n <= 0) return null;
  const a = Math.cbrt(MU_EARTH / (n * n));
  if (!Number.isFinite(a) || a <= EARTH_RADIUS_KM) return null;
  const e = Number.isFinite(satrec.ecco) ? Math.max(0, Math.min(0.999, satrec.ecco)) : 0;

  return {
    semiMajorAxisKm: a,
    perigeeAltitudeKm: a * (1 - e) - EARTH_RADIUS_KM,
    apogeeAltitudeKm: a * (1 + e) - EARTH_RADIUS_KM,
    meanAltitudeKm: a - EARTH_RADIUS_KM,
    eccentricity: e,
  };
}

/**
 * Above this, a launcher does not fly straight there — it parks low and
 * transfers. Direct ascent to a high orbit wastes enormous amounts of energy
 * fighting gravity on the way up.
 */
const DIRECT_ASCENT_CEILING_KM = 2000;
const PARKING_ALTITUDE_KM = 200;

export interface MissionBudget {
  /** Altitude the ascent actually targets — the target's own, or a parking orbit. */
  parkingAltitudeKm: number;
  ascent: AscentBudget;
  /** Only when the target sits too high to fly to directly. */
  transfer: {
    toAltitudeKm: number;
    departureDeltaV: number;
    arrivalDeltaV: number;
    totalDeltaV: number;
    flightTimeSeconds: number;
  } | null;
  totalKmS: number;
  massRatio: number;
  propellantFraction: number;
}

/**
 * What it costs to reach a specific target, rather than a nominal orbit.
 *
 * Low targets are flown to directly. High ones get the profile real missions
 * use: ascend to a low parking orbit, then a Hohmann transfer up. Both legs are
 * summed into one mass ratio, because the rocket equation does not care which
 * burn is which — only the total.
 */
export function missionBudget(
  latitudeDeg: number,
  azimuthDeg: number,
  orbit: TargetOrbit,
  specificImpulseSeconds = 330,
  lossesKmS = REPRESENTATIVE_LOSSES_KMS
): MissionBudget {
  const direct = orbit.meanAltitudeKm <= DIRECT_ASCENT_CEILING_KM;
  const parkingAltitudeKm = direct ? Math.max(orbit.meanAltitudeKm, PARKING_ALTITUDE_KM) : PARKING_ALTITUDE_KM;
  const ascent = ascentBudget(latitudeDeg, parkingAltitudeKm, azimuthDeg, specificImpulseSeconds, lossesKmS);

  let transfer: MissionBudget['transfer'] = null;
  if (!direct) {
    const t = hohmannTransfer(
      EARTH_RADIUS_KM + parkingAltitudeKm,
      EARTH_RADIUS_KM + orbit.meanAltitudeKm
    );
    transfer = {
      toAltitudeKm: orbit.meanAltitudeKm,
      departureDeltaV: t.departureDeltaV,
      arrivalDeltaV: t.arrivalDeltaV,
      totalDeltaV: t.totalDeltaV,
      flightTimeSeconds: t.flightTimeSeconds,
    };
  }

  const totalKmS = ascent.totalKmS + (transfer?.totalDeltaV ?? 0);
  const ratio = massRatio(totalKmS, exhaustVelocityKmS(specificImpulseSeconds));

  return {
    parkingAltitudeKm,
    ascent,
    transfer,
    totalKmS,
    massRatio: ratio,
    propellantFraction: 1 - 1 / ratio,
  };
}

export function ascentBudget(
  latitudeDeg: number,
  altitudeKm: number,
  azimuthDeg: number,
  specificImpulseSeconds = 330,
  lossesKmS = REPRESENTATIVE_LOSSES_KMS
): AscentBudget {
  const orbitalSpeed = circularSpeed(EARTH_RADIUS_KM + altitudeKm);
  // Only the eastward component of the ground's motion counts: a due-north
  // polar launch gets none of it, which is part of why polar orbits cost more.
  const assist = rotationalAssistKmS(latitudeDeg) * Math.sin(azimuthDeg * DEG);
  const total = orbitalSpeed - assist + lossesKmS;
  const ve = exhaustVelocityKmS(specificImpulseSeconds);
  const ratio = massRatio(total, ve);

  return {
    orbitalSpeedKmS: orbitalSpeed,
    rotationAssistKmS: assist,
    lossesKmS,
    totalKmS: total,
    massRatio: ratio,
    propellantFraction: 1 - 1 / ratio,
  };
}
