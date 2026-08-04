import { Astronomy } from './astronomy';
import { moonInterference } from './meteorShowers';
import type { Observer, Pass } from '../types';

/**
 * Is tonight worth going outside?
 *
 * The app already knew the answer and never said it. Darkness windows were
 * computed server-side to bound the pass search and thrown away; the cloud
 * forecast arrived attached to individual passes and was never summarised; the
 * Moon was drawn in the sky dome but never mentioned as the thing that will
 * ruin your evening. All of that is composed here into the one sentence
 * somebody standing by a window actually wants.
 *
 * Deliberately not a score out of ten. A single number implies a precision
 * none of these inputs have — a cloud forecast twelve hours out is a guess,
 * and "how dark is dark enough" depends on what you are looking for. What is
 * offered instead is a coarse verdict with its reasons stated, so a
 * disagreeable answer can be argued with rather than just disbelieved.
 */

export type TwilightKind = 'astronomical' | 'nautical' | 'civil';
export type Verdict = 'excellent' | 'good' | 'fair' | 'poor';

/** Sun altitudes defining each kind of twilight, in degrees. */
export const TWILIGHT_ALTITUDES: Record<TwilightKind, number> = {
  civil: -6,
  nautical: -12,
  astronomical: -18,
};

export interface DarknessWindow {
  start: Date;
  end: Date;
  kind: TwilightKind;
  /** Hours between the two. */
  hours: number;
}

export interface MoonConditions {
  /** 0 to 1. */
  illumination: number;
  phaseName: string;
  rise: Date | null;
  set: Date | null;
  /** Highest the Moon gets during the dark window, or null if it stays down. */
  peakElevationDeg: number | null;
  interference: ReturnType<typeof moonInterference>;
}

export interface TonightConditions {
  /** The darkest window tonight, or null under the midnight sun. */
  darkness: DarknessWindow | null;
  /** Nautical and civil windows, when true darkness never arrives. */
  fallbackDarkness: DarknessWindow | null;
  moon: MoonConditions;
  cloudCoverPercent: number | null;
  passes: Pass[];
  verdict: Verdict;
  reasons: string[];
}

const MS_PER_HOUR = 3_600_000;

/**
 * Hours between the viewer's clock and solar time where they are looking.
 *
 * Every time in this app is rendered on the reader's own clock, which was
 * invisible while everyone looked at their own sky and became glaring the
 * moment views became shareable: Singapore's night, read in London, starts at
 * "12:27 PM". The times are right and the label is missing.
 *
 * Longitude gives solar time, not civil time — political zones wander by hours
 * from the Sun, and there is no timezone database here to consult. So this is
 * only ever used to decide whether to warn that the clock is not the
 * observer's, never to restate a time as though it were theirs.
 */
export function clockOffsetHours(observerLongitudeDeg: number, viewerDate: Date = new Date()): number {
  const viewerOffsetHours = -viewerDate.getTimezoneOffset() / 60;
  const solarOffsetHours = observerLongitudeDeg / 15;
  return solarOffsetHours - viewerOffsetHours;
}

/** Far enough that the reader's clock would misdescribe the observer's night. */
export const FOREIGN_CLOCK_HOURS = 3;

export function clockIsForeign(observerLongitudeDeg: number, viewerDate: Date = new Date()): boolean {
  return Math.abs(clockOffsetHours(observerLongitudeDeg, viewerDate)) >= FOREIGN_CLOCK_HOURS;
}

/**
 * The next stretch of a given darkness, searched from a starting instant.
 *
 * Returns null where the Sun never gets that low — which is not an error but a
 * fact about high latitudes in summer, and the caller falls back to a shallower
 * twilight rather than reporting nothing.
 */
export function darknessWindow(
  observer: Observer,
  from: Date,
  kind: TwilightKind = 'astronomical'
): DarknessWindow | null {
  const site = new Astronomy.Observer(observer.latitude, observer.longitude, observer.elevation);
  const altitude = TWILIGHT_ALTITUDES[kind];

  try {
    // Search a day and a half so an evening query still finds tonight rather
    // than skipping to tomorrow when the Sun is already down.
    const dusk = Astronomy.SearchAltitude(Astronomy.Body.Sun, site, -1, from, 1.5, altitude);
    if (!dusk) return null;
    const dawn = Astronomy.SearchAltitude(Astronomy.Body.Sun, site, +1, dusk.date, 1.5, altitude);
    if (!dawn) return null;

    const start = dusk.date;
    const end = dawn.date;
    const hours = (end.getTime() - start.getTime()) / MS_PER_HOUR;
    if (hours <= 0) return null;
    return { start, end, kind, hours };
  } catch {
    return null;
  }
}

/** How far the Moon rises above the horizon between two instants. */
function peakMoonElevation(observer: Observer, start: Date, end: Date): number | null {
  const site = new Astronomy.Observer(observer.latitude, observer.longitude, observer.elevation);
  const spanHours = (end.getTime() - start.getTime()) / MS_PER_HOUR;
  if (spanHours <= 0) return null;

  // Sampled rather than solved: the Moon's altitude curve is smooth over a
  // night, and half-hourly samples locate its peak to well inside the accuracy
  // this is used at — a coarse go/no-go on moonlight.
  let peak: number | null = null;
  for (let hour = 0; hour <= spanHours; hour += 0.5) {
    const when = new Date(start.getTime() + hour * MS_PER_HOUR);
    const equatorial = Astronomy.Equator(Astronomy.Body.Moon, when, site, true, true);
    const horizon = Astronomy.Horizon(when, site, equatorial.ra, equatorial.dec, 'normal');
    if (peak === null || horizon.altitude > peak) peak = horizon.altitude;
  }
  return peak;
}

/**
 * Moon phase in the words people use.
 *
 * The boundaries are the conventional ones: the quarters are moments, not
 * weeks, so anything near them is named for the quarter and everything between
 * is crescent or gibbous.
 */
export function moonPhaseName(phaseAngleDeg: number): string {
  const angle = ((phaseAngleDeg % 360) + 360) % 360;
  if (angle < 11.25 || angle >= 348.75) return 'new';
  if (angle < 78.75) return 'waxing crescent';
  if (angle < 101.25) return 'first quarter';
  if (angle < 168.75) return 'waxing gibbous';
  if (angle < 191.25) return 'full';
  if (angle < 258.75) return 'waning gibbous';
  if (angle < 281.25) return 'last quarter';
  return 'waning crescent';
}

export function moonConditions(observer: Observer, window: DarknessWindow | null, from: Date): MoonConditions {
  const site = new Astronomy.Observer(observer.latitude, observer.longitude, observer.elevation);
  const illumination = Astronomy.Illumination(Astronomy.Body.Moon, from).phase_fraction;
  const phaseName = moonPhaseName(Astronomy.MoonPhase(from));

  const rise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, site, +1, from, 1.5)?.date ?? null;
  const set = Astronomy.SearchRiseSet(Astronomy.Body.Moon, site, -1, from, 1.5)?.date ?? null;

  const peakElevationDeg = window ? peakMoonElevation(observer, window.start, window.end) : null;

  return {
    illumination,
    phaseName,
    rise,
    set,
    peakElevationDeg,
    interference: moonInterference(illumination, peakElevationDeg),
  };
}

/** Passes falling inside a darkness window, brightest first. */
export function passesTonight(passes: Pass[], window: DarknessWindow | null, limit = 5): Pass[] {
  if (!window) return [];
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  return passes
    .filter((p) => {
      const at = new Date(p.max.time).getTime();
      return at >= startMs && at <= endMs;
    })
    .sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99))
    .slice(0, limit);
}

/** Mean cloud cover across the passes that matter, when the forecast reached us. */
function meanCloudCover(passes: Pass[]): number | null {
  const values = passes
    .map((p) => p.cloudCoverPercent)
    .filter((c): c is number => typeof c === 'number');
  if (values.length === 0) return null;
  return values.reduce((sum, c) => sum + c, 0) / values.length;
}

/**
 * The verdict, and why.
 *
 * Cloud dominates everything else: under a solid overcast it does not matter
 * how dark it is or where the Moon has got to, and saying otherwise would be
 * sending somebody outside to look at nothing. Below that, the ordering is
 * darkness, then moonlight, then whether there is anything to see.
 */
export function judge(
  darkness: DarknessWindow | null,
  fallback: DarknessWindow | null,
  moon: MoonConditions,
  cloudCoverPercent: number | null,
  passes: Pass[]
): { verdict: Verdict; reasons: string[] } {
  const reasons: string[] = [];
  let verdict: Verdict = 'excellent';
  const demote = (to: Verdict) => {
    const order: Verdict[] = ['excellent', 'good', 'fair', 'poor'];
    if (order.indexOf(to) > order.indexOf(verdict)) verdict = to;
  };

  if (cloudCoverPercent !== null) {
    if (cloudCoverPercent >= 80) {
      demote('poor');
      reasons.push(`${Math.round(cloudCoverPercent)}% cloud — you will not see through that`);
    } else if (cloudCoverPercent >= 50) {
      demote('fair');
      reasons.push(`${Math.round(cloudCoverPercent)}% cloud, so it will be in and out`);
    } else if (cloudCoverPercent <= 20) {
      reasons.push(`${Math.round(cloudCoverPercent)}% cloud — the sky should be open`);
    }
  }

  if (!darkness) {
    if (!fallback) {
      demote('poor');
      reasons.push('the Sun never sets far enough tonight — it does not get dark here at this time of year');
    } else {
      demote('fair');
      reasons.push(
        `it never gets fully dark tonight, only as far as ${fallback.kind} twilight`
      );
    }
  } else if (darkness.hours < 3) {
    demote('fair');
    reasons.push(`only ${darkness.hours.toFixed(1)} hours of true darkness`);
  }

  if (moon.interference === 'severe') {
    demote('fair');
    reasons.push(
      `a ${Math.round(moon.illumination * 100)}% Moon is up and will wash out anything faint`
    );
  } else if (moon.interference === 'moderate') {
    reasons.push(`a ${Math.round(moon.illumination * 100)}% Moon will mute the fainter objects`);
  } else if (moon.interference === 'none' && moon.illumination < 0.3) {
    reasons.push('barely any Moon — good for faint things');
  }

  if (passes.length === 0 && darkness) {
    demote('fair');
    reasons.push('no bright satellite passes in the dark window');
  } else if (passes.length > 0) {
    const best = passes[0];
    reasons.push(
      `${passes.length} pass${passes.length === 1 ? '' : 'es'} to catch, the best being ${best.name} at magnitude ${best.magnitude}`
    );
  }

  return { verdict, reasons };
}

export function assessTonight(
  observer: Observer,
  passes: Pass[],
  from: Date = new Date()
): TonightConditions {
  const darkness = darknessWindow(observer, from, 'astronomical');
  // Above about 49 degrees latitude, astronomical twilight never ends in
  // midsummer. That is a real sky, not a missing answer, so a shallower
  // darkness is reported rather than nothing.
  const fallbackDarkness = darkness
    ? null
    : darknessWindow(observer, from, 'nautical') ?? darknessWindow(observer, from, 'civil');

  const window = darkness ?? fallbackDarkness;
  const moon = moonConditions(observer, window, from);
  const tonightPasses = passesTonight(passes, window);
  const cloudCoverPercent = meanCloudCover(tonightPasses.length > 0 ? tonightPasses : passes.slice(0, 5));
  const { verdict, reasons } = judge(darkness, fallbackDarkness, moon, cloudCoverPercent, tonightPasses);

  return {
    darkness,
    fallbackDarkness,
    moon,
    cloudCoverPercent,
    passes: tonightPasses,
    verdict,
    reasons,
  };
}
