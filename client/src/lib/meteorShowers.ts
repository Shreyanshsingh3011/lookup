/**
 * Annual meteor showers.
 *
 * Rates and radiants follow the IMO's published nominal figures. "Nominal" is
 * the important word: a shower's real strength varies year to year as Earth
 * crosses denser or thinner parts of the debris stream, and outbursts happen.
 * Everything here describes a typical year, not a forecast for this one.
 *
 * Activity windows are stored as day offsets either side of the peak rather
 * than as calendar dates. That keeps showers that straddle new year (the
 * Quadrantids, the Ursids) from needing special cases, and sidesteps leap
 * years entirely.
 */

export interface MeteorShower {
  id: string;
  name: string;
  /** Radiant position, J2000. Radiants drift a little across the shower; this is the peak position. */
  radiantRaDeg: number;
  radiantDecDeg: number;
  /** Peak date as [month, day], month being 1-based. */
  peak: [number, number];
  activeBeforeDays: number;
  activeAfterDays: number;
  /** Nominal maximum zenithal hourly rate. */
  zhr: number;
  /**
   * Population index: how much the count rises as fainter meteors are
   * included. A high value means the shower is dominated by faint meteors and
   * suffers badly under light pollution.
   */
  populationIndex: number;
  /**
   * Days either side of the peak at which activity has fallen by half.
   * Real profiles are measured in solar longitude and are not symmetric; this
   * is a deliberate simplification, good enough to answer "is it worth going
   * out tonight" and not intended for anything finer.
   */
  halfWidthDays: number;
  /** Atmospheric entry speed, which is what makes some showers fast and others slow. */
  speedKmS: number;
  parent: string;
}

export const METEOR_SHOWERS: MeteorShower[] = [
  {
    id: 'QUA',
    name: 'Quadrantids',
    radiantRaDeg: 230,
    radiantDecDeg: 49,
    peak: [1, 3],
    activeBeforeDays: 6,
    activeAfterDays: 9,
    zhr: 110,
    populationIndex: 2.1,
    halfWidthDays: 0.4,
    speedKmS: 41,
    parent: 'asteroid 2003 EH1',
  },
  {
    id: 'LYR',
    name: 'Lyrids',
    radiantRaDeg: 271,
    radiantDecDeg: 34,
    peak: [4, 22],
    activeBeforeDays: 6,
    activeAfterDays: 3,
    zhr: 18,
    populationIndex: 2.1,
    halfWidthDays: 1,
    speedKmS: 49,
    parent: 'comet C/1861 G1 Thatcher',
  },
  {
    id: 'ETA',
    name: 'Eta Aquariids',
    radiantRaDeg: 338,
    radiantDecDeg: -1,
    peak: [5, 6],
    activeBeforeDays: 17,
    activeAfterDays: 22,
    zhr: 50,
    populationIndex: 2.4,
    halfWidthDays: 4,
    speedKmS: 66,
    parent: 'comet 1P/Halley',
  },
  {
    id: 'SDA',
    name: 'Southern Delta Aquariids',
    radiantRaDeg: 340,
    radiantDecDeg: -16,
    peak: [7, 30],
    activeBeforeDays: 18,
    activeAfterDays: 24,
    zhr: 25,
    populationIndex: 3.2,
    halfWidthDays: 6,
    speedKmS: 41,
    parent: 'comet 96P/Machholz',
  },
  {
    id: 'PER',
    name: 'Perseids',
    radiantRaDeg: 48,
    radiantDecDeg: 58,
    peak: [8, 12],
    activeBeforeDays: 26,
    activeAfterDays: 12,
    zhr: 100,
    populationIndex: 2.2,
    halfWidthDays: 2,
    speedKmS: 59,
    parent: 'comet 109P/Swift-Tuttle',
  },
  {
    id: 'ORI',
    name: 'Orionids',
    radiantRaDeg: 95,
    radiantDecDeg: 16,
    peak: [10, 21],
    activeBeforeDays: 19,
    activeAfterDays: 17,
    zhr: 20,
    populationIndex: 2.5,
    halfWidthDays: 3,
    speedKmS: 66,
    parent: 'comet 1P/Halley',
  },
  {
    id: 'STA',
    name: 'Southern Taurids',
    radiantRaDeg: 52,
    radiantDecDeg: 15,
    peak: [11, 5],
    activeBeforeDays: 56,
    activeAfterDays: 15,
    zhr: 5,
    populationIndex: 2.3,
    halfWidthDays: 12,
    speedKmS: 27,
    parent: 'comet 2P/Encke',
  },
  {
    id: 'NTA',
    name: 'Northern Taurids',
    radiantRaDeg: 58,
    radiantDecDeg: 22,
    peak: [11, 12],
    activeBeforeDays: 23,
    activeAfterDays: 28,
    zhr: 5,
    populationIndex: 2.3,
    halfWidthDays: 12,
    speedKmS: 29,
    parent: 'comet 2P/Encke',
  },
  {
    id: 'LEO',
    name: 'Leonids',
    radiantRaDeg: 152,
    radiantDecDeg: 22,
    peak: [11, 17],
    activeBeforeDays: 11,
    activeAfterDays: 13,
    zhr: 15,
    populationIndex: 2.5,
    halfWidthDays: 1,
    speedKmS: 71,
    parent: 'comet 55P/Tempel-Tuttle',
  },
  {
    id: 'GEM',
    name: 'Geminids',
    radiantRaDeg: 112,
    radiantDecDeg: 33,
    peak: [12, 14],
    activeBeforeDays: 10,
    activeAfterDays: 6,
    zhr: 150,
    populationIndex: 2.6,
    halfWidthDays: 2,
    speedKmS: 35,
    parent: 'asteroid 3200 Phaethon',
  },
  {
    id: 'URS',
    name: 'Ursids',
    radiantRaDeg: 217,
    radiantDecDeg: 76,
    peak: [12, 22],
    activeBeforeDays: 5,
    activeAfterDays: 4,
    zhr: 10,
    populationIndex: 3,
    halfWidthDays: 1,
    speedKmS: 33,
    parent: 'comet 8P/Tuttle',
  },
];

const MS_PER_DAY = 86_400_000;

/**
 * Days from `date` to the nearest occurrence of this shower's peak, signed:
 * negative before the peak, positive after.
 *
 * Checking the adjacent years is what makes new-year showers work — on 30
 * December the Quadrantids' nearest peak is in January, not eleven months ago.
 */
export function daysFromPeak(shower: MeteorShower, date: Date): number {
  const [month, day] = shower.peak;
  const year = date.getUTCFullYear();
  let best = Infinity;
  for (const candidate of [year - 1, year, year + 1]) {
    // Peaks are quoted for the night, so anchor at local midnight-ish rather
    // than 00:00 UTC; the half-day makes no difference beyond tidiness.
    const peak = Date.UTC(candidate, month - 1, day, 12);
    const diff = (date.getTime() - peak) / MS_PER_DAY;
    if (Math.abs(diff) < Math.abs(best)) best = diff;
  }
  return best;
}

export interface ShowerActivity {
  shower: MeteorShower;
  /** Signed days from the peak; negative means the peak is still to come. */
  daysFromPeak: number;
  /** Zenithal hourly rate at this date, after the profile falloff. */
  zhrNow: number;
}

/**
 * Where a shower is in its activity profile on a given date, or null if it is
 * not running at all.
 */
export function showerActivity(shower: MeteorShower, date: Date): ShowerActivity | null {
  const offset = daysFromPeak(shower, date);
  if (offset < -shower.activeBeforeDays || offset > shower.activeAfterDays) return null;

  // Halving every halfWidthDays away from the peak. The real profiles are
  // closer to exponential in solar longitude, which this approximates.
  const zhrNow = shower.zhr * 2 ** (-Math.abs(offset) / shower.halfWidthDays);
  return { shower, daysFromPeak: offset, zhrNow };
}

/** Every shower running on a given date, strongest first. */
export function activeShowers(date: Date): ShowerActivity[] {
  return METEOR_SHOWERS.map((shower) => showerActivity(shower, date))
    .filter((activity): activity is ShowerActivity => activity !== null)
    .sort((a, b) => b.zhrNow - a.zhrNow);
}

/**
 * Meteors per hour an observer would actually count.
 *
 * ZHR is defined for a radiant at the zenith under a sky with a limiting
 * magnitude of 6.5 — conditions almost nobody has. The standard correction is
 *
 *   HR = ZHR · sin(h) / r^(6.5 − lm)
 *
 * where h is the radiant's elevation and lm the faintest star visible. Both
 * terms matter enormously: a radiant 20° up costs you two thirds of the rate,
 * and a suburban sky costs most of the rest.
 *
 * Returns 0 with the radiant below the horizon — meteors from a shower whose
 * radiant has not risen do not appear.
 */
export function observedRatePerHour(
  zhrNow: number,
  radiantElevationDeg: number,
  limitingMagnitude: number,
  populationIndex: number
): number {
  if (radiantElevationDeg <= 0) return 0;
  const elevationFactor = Math.sin((radiantElevationDeg * Math.PI) / 180);
  const skyFactor = populationIndex ** (6.5 - limitingMagnitude);
  return (zhrNow * elevationFactor) / skyFactor;
}

/** Limiting magnitudes bracketing what people realistically observe under. */
export const DARK_SKY_LIMITING_MAGNITUDE = 6.5;
export const SUBURBAN_LIMITING_MAGNITUDE = 5.0;

/**
 * A range rather than a single number, because the app cannot know the
 * observer's sky. The low end is a suburban sky, the high end a genuinely dark
 * one — quoting the dark-sky figure alone would promise a show most people
 * will not get.
 */
export function expectedRateRange(
  activity: ShowerActivity,
  radiantElevationDeg: number
): { low: number; high: number } {
  const { zhrNow, shower } = activity;
  return {
    low: observedRatePerHour(zhrNow, radiantElevationDeg, SUBURBAN_LIMITING_MAGNITUDE, shower.populationIndex),
    high: observedRatePerHour(zhrNow, radiantElevationDeg, DARK_SKY_LIMITING_MAGNITUDE, shower.populationIndex),
  };
}

/**
 * How much the Moon will spoil it.
 *
 * Meteor watching is naked-eye and wide-field, so a bright Moon above the
 * horizon washes out the faint end of the distribution — which is most of it.
 * Deliberately coarse: this is a go/no-go hint, not photometry.
 */
export function moonInterference(
  illuminatedFraction: number | null,
  moonElevationDeg: number | null
): 'none' | 'slight' | 'moderate' | 'severe' {
  if (illuminatedFraction === null || moonElevationDeg === null) return 'none';
  if (moonElevationDeg <= 0) return 'none';
  // Brightness rises far faster than illuminated fraction: a full Moon is
  // roughly ten times a half Moon, not twice.
  const severity = illuminatedFraction ** 2 * Math.min(1, moonElevationDeg / 40 + 0.3);
  if (severity < 0.1) return 'slight';
  if (severity < 0.35) return 'moderate';
  return 'severe';
}

/**
 * The expected rate in words.
 *
 * Rounding a range like 0.4–1.3 to "0–1 an hour" reads as a promise of
 * nothing, which is both ugly and misleading — the low end is a sky quality,
 * not a floor. Sub-one rates are described rather than printed.
 */
export function describeRate(range: { low: number; high: number }): string {
  // Tested against the raw value, not the rounded one: 0.6 rounds up to 1,
  // which would turn "you will probably see nothing" into "up to 1 an hour".
  if (range.high < 1) return 'under 1 an hour';
  const low = Math.round(range.low);
  const high = Math.round(range.high);
  if (low < 1) return `up to ${high} an hour`;
  if (low === high) return `~${high} an hour`;
  return `~${low}–${high} an hour`;
}

export function describePeak(daysFrom: number): string {
  const rounded = Math.round(daysFrom);
  if (rounded === 0) return 'peaks tonight';
  if (rounded === -1) return 'peaks tomorrow';
  if (rounded === 1) return 'peaked last night';
  if (rounded < 0) return `peaks in ${-rounded} days`;
  return `peaked ${rounded} days ago`;
}
