import { Astronomy } from './astronomy';
import {
  AU_KM,
  MU_SUN,
  hohmannTransfer,
  normaliseDeg,
  phaseAngleAtDepartureDeg,
  synodicPeriodDays,
} from './orbitalMechanics';

/**
 * When you could actually leave for another planet.
 *
 * A Hohmann transfer only works if the target is in the right place when you
 * depart — you aim at where it will be after a crossing that takes months, not
 * at where it is. That requirement recurs at the synodic period, which is why
 * Mars windows come round every twenty-six months rather than whenever anyone
 * feels like going.
 *
 * The planets' positions come from the same ephemeris the sky view uses, so
 * the window dates are derived rather than quoted. Two honest simplifications:
 * orbits are treated as circular and coplanar, which is what a Hohmann
 * transfer assumes. Real missions fly Lambert arcs to eccentric, inclined
 * orbits and their true windows shift by days and their delta-v by a few
 * hundred metres a second. The figures here are the textbook idealisation,
 * which is the right thing to teach and the wrong thing to fly.
 */

export interface TransferTarget {
  body: string;
  label: string;
  /** Semi-major axis in AU. */
  semiMajorAxisAu: number;
  orbitalPeriodDays: number;
}

export const TRANSFER_TARGETS: TransferTarget[] = [
  { body: 'Mercury', label: 'Mercury', semiMajorAxisAu: 0.387098, orbitalPeriodDays: 87.969 },
  { body: 'Venus', label: 'Venus', semiMajorAxisAu: 0.723332, orbitalPeriodDays: 224.701 },
  { body: 'Mars', label: 'Mars', semiMajorAxisAu: 1.523679, orbitalPeriodDays: 686.980 },
  { body: 'Jupiter', label: 'Jupiter', semiMajorAxisAu: 5.2044, orbitalPeriodDays: 4332.589 },
  { body: 'Saturn', label: 'Saturn', semiMajorAxisAu: 9.5826, orbitalPeriodDays: 10759.22 },
];

const EARTH_SEMI_MAJOR_AU = 1.000001018;
const EARTH_PERIOD_DAYS = 365.256363;

/**
 * Heliocentric ecliptic longitude of a body, degrees.
 *
 * Deliberately not `atan2(v.y, v.x)` on a `HelioVector`: that vector is in the
 * J2000 *equatorial* frame, so taking its argument measures longitude around
 * the celestial equator rather than around the ecliptic. The two agree only at
 * the equinoxes and solstices and diverge by up to 2.5 degrees in between —
 * enough to shift a transfer window by days while looking entirely plausible.
 * `EclipticLongitude` applies the obliquity rotation first.
 */
export function heliocentricLongitudeDeg(body: string, date: Date): number | null {
  try {
    const lon = Astronomy.EclipticLongitude(
      body as Parameters<typeof Astronomy.EclipticLongitude>[0],
      date
    );
    if (!Number.isFinite(lon)) return null;
    return normaliseDeg(lon);
  } catch {
    return null;
  }
}

/** How far the target currently leads Earth around the Sun, degrees. */
export function currentPhaseAngleDeg(body: string, date: Date): number | null {
  const earth = heliocentricLongitudeDeg('Earth', date);
  const target = heliocentricLongitudeDeg(body, date);
  if (earth === null || target === null) return null;
  return normaliseDeg(target - earth);
}

export interface TransferWindow {
  target: TransferTarget;
  /** Next date the geometry is right to depart. */
  departure: Date;
  /** Angle the target must lead Earth by at departure. */
  requiredPhaseAngleDeg: number;
  currentPhaseAngleDeg: number;
  flightTimeDays: number;
  departureDeltaVKmS: number;
  arrivalDeltaVKmS: number;
  totalDeltaVKmS: number;
  /** How often the window recurs. */
  synodicPeriodDays: number;
  arrival: Date;
}

/**
 * Next departure window for a target, searched from real positions.
 *
 * Steps forward a day at a time looking for the moment the phase angle passes
 * through the required value, then refines by bisection. Stepping rather than
 * solving because the ephemeris is the authority here — inverting an
 * approximation of it would be faster and less true.
 */
export function nextTransferWindow(target: TransferTarget, from: Date): TransferWindow | null {
  const departureRadius = EARTH_SEMI_MAJOR_AU * AU_KM;
  const targetRadius = target.semiMajorAxisAu * AU_KM;

  const required = phaseAngleAtDepartureDeg(departureRadius, targetRadius, MU_SUN);
  const transfer = hohmannTransfer(departureRadius, targetRadius, MU_SUN);
  const synodic = synodicPeriodDays(EARTH_PERIOD_DAYS, target.orbitalPeriodDays);

  // Signed offset from the required geometry, wrapped to +/-180 so the search
  // is looking for a sign change rather than a wrap.
  const offset = (date: Date): number | null => {
    const phase = currentPhaseAngleDeg(target.body, date);
    if (phase === null) return null;
    return ((phase - required + 540) % 360) - 180;
  };

  const startOffset = offset(from);
  if (startOffset === null) return null;

  const dayMs = 86_400_000;
  let previous = startOffset;
  let previousTime = from.getTime();

  // One synodic period always contains exactly one crossing; a little margin
  // covers the case where the search starts just past one.
  const limit = Math.ceil(synodic) + 5;
  for (let day = 1; day <= limit; day++) {
    const time = from.getTime() + day * dayMs;
    const current = offset(new Date(time));
    if (current === null) return null;

    // A sign change in *either* direction. Which way the offset travels
    // depends on which side of Earth's orbit the target is: Earth outruns
    // Mars, so Mars's lead shrinks and the offset falls, while Venus outruns
    // Earth and its offset climbs. Looking only for a rising crossing finds
    // windows for the inner planets and never for the outer ones. The
    // magnitude guard skips the artificial jump where the wrap at +/-180
    // happens to land between two samples.
    const crossed = previous < 0 !== current < 0 && Math.abs(current - previous) < 180;
    if (crossed) {
      const rising = current > previous;
      let lo = previousTime;
      let hi = time;
      for (let i = 0; i < 40 && hi - lo > 60_000; i++) {
        const mid = (lo + hi) / 2;
        const value = offset(new Date(mid));
        if (value === null) break;
        // Keep the bracket straddling zero whichever way the offset runs.
        if (rising ? value < 0 : value > 0) lo = mid;
        else hi = mid;
      }
      const departure = new Date(hi);
      const currentPhase = currentPhaseAngleDeg(target.body, from);
      return {
        target,
        departure,
        requiredPhaseAngleDeg: required,
        currentPhaseAngleDeg: currentPhase ?? 0,
        flightTimeDays: transfer.flightTimeSeconds / 86_400,
        departureDeltaVKmS: transfer.departureDeltaV,
        arrivalDeltaVKmS: transfer.arrivalDeltaV,
        totalDeltaVKmS: transfer.totalDeltaV,
        synodicPeriodDays: synodic,
        arrival: new Date(departure.getTime() + transfer.flightTimeSeconds * 1000),
      };
    }
    previous = current;
    previousTime = time;
  }

  return null;
}

/** Next window for every target, soonest first. */
export function allTransferWindows(from: Date): TransferWindow[] {
  return TRANSFER_TARGETS.map((t) => nextTransferWindow(t, from))
    .filter((w): w is TransferWindow => w !== null)
    .sort((a, b) => a.departure.getTime() - b.departure.getTime());
}
