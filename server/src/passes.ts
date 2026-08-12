import * as satellite from "satellite.js";
import * as AstronomyModule from "astronomy-engine";
import type { TleRecord } from "./celestrak.js";
import { DEBRIS_NAME, ROCKET_BODY_NAME } from "./debris.js";
import type { Observer, Pass, PassEvent } from "./types.js";

// astronomy-engine's ESM build exposes real named exports, while a loader that
// resolves its CJS build hands back a namespace whose whole API sits under
// `default`. Which one we get varies (tsx vs. plain node, ESM vs. CJS caller),
// so normalize both shapes into a single value binding. Types come from the
// namespace either way.
//
// The `default` lookup is deliberately computed rather than written as
// `AstronomyModule.default`: against the ESM build that named export genuinely
// does not exist, and a static reference makes bundlers warn about an import
// that "will always be undefined".
const DEFAULT_EXPORT = "default";
const astronomyNamespace = AstronomyModule as unknown as Record<string, unknown>;
const Astronomy: typeof AstronomyModule =
  (astronomyNamespace[DEFAULT_EXPORT] as typeof AstronomyModule | undefined) ?? AstronomyModule;

type AstroObserver = AstronomyModule.Observer;

const AU_KM = 149597870.7;
const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

// Above this fraction of the Sun's disc being covered by Earth, we treat the
// satellite as eclipsed rather than merely dimmed in the penumbra.
const ECLIPSE_THRESHOLD = 0.99;

export interface PassOptions {
  days: number; // how many days ahead to search
  minElevationDeg: number; // minimum peak elevation to count as a "pass"
  sunAltitudeThresholdDeg: number; // observer is "dark" when sun altitude is below this
  coarseStepMinutes: number; // resolution for the darkness scan
  fineStepSeconds: number; // resolution for the pass scan inside dark windows
  /**
   * Step for the cheap above-horizon pre-scan that decides where the fine scan
   * runs at all. Must stay well below the shortest pass worth reporting: a pass
   * peaking at the ten-degree cutoff is above the horizon for four minutes or
   * more, so a minute leaves a wide margin. Set to 0 to fine-scan everything,
   * which is what the equivalence test compares against.
   */
  horizonScanSeconds: number;
  /**
   * Instant the search starts from. Defaults to the real clock; overridable so
   * a search can be reproduced exactly, which is the only way to compare two
   * scanning strategies — otherwise each call samples a slightly different
   * grid and every timestamp disagrees by however long the first run took.
   */
  now?: Date;
  /**
   * Faintest peak magnitude still reported. Roughly the naked-eye limit under
   * suburban skies — without it, "visible passes" would include objects no
   * observer could actually pick out.
   */
  maxMagnitude: number;
}

export const DEFAULT_PASS_OPTIONS: PassOptions = {
  days: 10,
  minElevationDeg: 10,
  sunAltitudeThresholdDeg: -6, // civil twilight
  coarseStepMinutes: 5,
  fineStepSeconds: 10,
  horizonScanSeconds: 60,
  maxMagnitude: 5.5,
};

/**
 * Most objects a single pass search will scan.
 *
 * Selecting Starlink means asking about eight thousand satellites, and at
 * roughly six milliseconds each over a ten-day search that is a minute of
 * compute inside a thirty-second function. The cap is what stops a legitimate
 * choice in the picker from becoming a gateway timeout.
 */
export const MAX_SCANNED_SATELLITES = 900;

/**
 * Trim a catalogue to what can be scanned, keeping the objects most likely to
 * produce a visible pass.
 *
 * Truncating arbitrarily would be worse than useless — it would drop the ISS
 * because its catalogue number sorted late. Ranking by the same brightness
 * estimate the magnitude filter uses means the objects discarded are the ones
 * that would have been rejected as too faint anyway.
 */
export function rankForVisibility(tles: TleRecord[], limit = MAX_SCANNED_SATELLITES): {
  scanned: TleRecord[];
  skipped: number;
} {
  if (tles.length <= limit) return { scanned: tles, skipped: 0 };
  const byBrightness = [...tles].sort(
    (a, b) => standardMagnitude(a.name) - standardMagnitude(b.name)
  );
  return { scanned: byBrightness.slice(0, limit), skipped: tles.length - limit };
}

export interface PassSearchResult {
  passes: Pass[];
  /** Geometrically valid passes rejected for being fainter than the cutoff. */
  tooFaintCount: number;
  /** Brightest magnitude among the rejected passes, if any were rejected. */
  brightestRejectedMagnitude: number | null;
}

function azToCompass(azDeg: number): string {
  const idx = Math.round(((azDeg % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS[idx];
}

/**
 * Standard magnitude: apparent brightness at 1000 km range and 90 degree phase
 * angle, used as the base for the approximate brightness formula. Real values
 * vary with orientation and attitude; these are ballpark figures.
 *
 * Size matters enormously here. Celestrak's groups mix genuine spacecraft with
 * debris fragments and spent upper stages, and a fragment is orders of magnitude
 * fainter than a station. Treating an unknown object as bright as a 3rd
 * magnitude star would have the app confidently list passes of things nobody
 * could ever see.
 */
export function standardMagnitude(name: string): number {
  const n = name.toUpperCase();

  if (n.includes("ZARYA") || /\bISS\b/.test(n)) return -1.8;
  if (n.includes("TIANGONG") || /\bCSS\b/.test(n) || n.includes("TIANHE")) return 0.8;
  if (n.includes("HST") || n.includes("HUBBLE")) return 1.5;
  if (n.includes("STARLINK")) return 4.5;

  // Debris fragments: small, tumbling, effectively invisible to the eye.
  if (DEBRIS_NAME.test(n)) return 8.0;
  // Spent upper stages are large cylinders and often naked-eye objects.
  if (ROCKET_BODY_NAME.test(n)) return 3.5;

  // Unknown: assume a small satellite rather than a large one.
  return 4.5;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function mag(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Air mass by Kasten and Young (1989): how much atmosphere the line of sight
 * passes through, relative to straight up.
 *
 * The naive 1/sin(elevation) diverges at the horizon and is already several per
 * cent wrong by 10 degrees, which is exactly where satellite passes spend most
 * of their time. This form is well behaved all the way down: 1.0 at the zenith,
 * 5.6 at 10 degrees, 10.3 at 5, and about 38 at the horizon.
 */
export function airMass(elevationDeg: number): number {
  const h = Math.max(elevationDeg, 0);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * Magnitudes of atmospheric extinction at a given elevation.
 *
 * This was missing, and its absence was not a rounding error. Passes spend most
 * of their time low in the sky, low elevations happen to be where phase angles
 * are most favourable, and nothing offset that — so the app reported its
 * brightest moment of a pass at the point where the atmosphere was dimming the
 * object most. Checked against production before the fix: an ISS pass peaking at
 * 11.9 degrees was quoted at magnitude -1.0, with the headline figure -1.4 taken
 * from a sample lower still, through nearly five air masses of atmosphere.
 *
 * The coefficient is a nominal clear-sky sea-level value in V. Real extinction
 * depends on site altitude, humidity and haze and can be half this on a
 * mountain or double it in summer murk, so this is the right order rather than a
 * per-night truth — which is the same standing as the standard magnitudes it
 * corrects.
 */
export const EXTINCTION_MAG_PER_AIRMASS = 0.25;

export function extinctionMagnitudes(elevationDeg: number): number {
  return EXTINCTION_MAG_PER_AIRMASS * airMass(elevationDeg);
}

/**
 * Apparent visual magnitude approximation. Lower (more negative) = brighter.
 * `shadowFrac` dims the satellite as it crosses the penumbra into eclipse, and
 * `elevationDeg` sets how much atmosphere it is being seen through.
 */
function apparentMagnitude(
  name: string,
  satEci: Vec3,
  sunEciKm: Vec3,
  obsEci: Vec3,
  shadowFrac: number,
  elevationDeg: number
): number {
  const satToSun = sub(sunEciKm, satEci);
  const satToObs = sub(obsEci, satEci);
  const rangeKm = mag(satToObs);
  const cosPhase = dot(satToSun, satToObs) / (mag(satToSun) * rangeKm);
  const phaseAngle = Math.acos(Math.min(1, Math.max(-1, cosPhase)));
  const term = Math.sin(phaseAngle) + (Math.PI - phaseAngle) * Math.cos(phaseAngle);
  if (term <= 0) return 99; // essentially unlit from observer's viewpoint

  const stdMag = standardMagnitude(name);
  const base = stdMag - 15 + 5 * Math.log10(rangeKm) - 2.5 * Math.log10(term);

  // Penumbral dimming: only a fraction (1 - shadowFrac) of the Sun's disc
  // still illuminates the satellite.
  const litFraction = Math.max(1 - shadowFrac, 1e-3);
  return base - 2.5 * Math.log10(litFraction) + extinctionMagnitudes(elevationDeg);
}

function sunAltitudeDeg(date: Date, astroObserver: AstroObserver): number {
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, astroObserver, true, true);
  const hor = Astronomy.Horizon(date, astroObserver, eq.ra, eq.dec, "normal");
  return hor.altitude;
}

interface Sample {
  date: Date;
  azimuthDeg: number;
  elevationDeg: number;
  illuminated: boolean;
  observerDark: boolean;
  magnitude: number;
}

function sampleAt(
  satrec: satellite.SatRec,
  name: string,
  observerGd: satellite.GeodeticLocation,
  sunAltitudeAt: (ms: number) => number,
  date: Date,
  opts: PassOptions
): Sample | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv) return null; // decayed or SGP4 error

  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, positionEcf);
  const elevationDeg = satellite.radiansToDegrees(look.elevation);
  const azimuthDeg = satellite.radiansToDegrees(look.azimuth);

  // Sun position and shadow are computed in satellite.js's own (TEME) frame so
  // they stay self-consistent with the SGP4 output above.
  const sun = satellite.sunPos(satellite.jday(date));
  const shadowFrac = satellite.shadowFraction(sun.rsun, pv.position);
  const illuminated = shadowFrac < ECLIPSE_THRESHOLD;

  const sunEciKm: Vec3 = {
    x: sun.rsun.x * AU_KM,
    y: sun.rsun.y * AU_KM,
    z: sun.rsun.z * AU_KM,
  };

  const obsEcf = satellite.geodeticToEcf(observerGd);
  const obsEci = satellite.ecfToEci(obsEcf, gmst);

  const observerDark = sunAltitudeAt(date.getTime()) < opts.sunAltitudeThresholdDeg;
  const magnitude = apparentMagnitude(name, pv.position, sunEciKm, obsEci, shadowFrac, elevationDeg);

  return { date, azimuthDeg, elevationDeg, illuminated, observerDark, magnitude };
}

function toPassEvent(s: Sample): PassEvent {
  return {
    time: s.date.toISOString(),
    azimuthDeg: Math.round(s.azimuthDeg * 10) / 10,
    altitudeDeg: Math.round(s.elevationDeg * 10) / 10,
    direction: azToCompass(s.azimuthDeg),
    magnitude: Math.round(s.magnitude * 10) / 10,
  };
}

/** Padding around dark windows so fine scanning doesn't clip passes at the edge. */
const WINDOW_BUFFER_MS = 15 * 60 * 1000;

/**
 * Per-minute sun-altitude samples for interpolation.
 *
 * The sun moves at most ~0.25 degrees per minute, so linear interpolation
 * between one-minute samples is accurate to well under 0.01 degrees — far
 * tighter than the twilight threshold needs, and it replaces one
 * astronomy-engine call per satellite sample with an array lookup.
 */
const SUN_TABLE_STEP_MS = 60 * 1000;

/**
 * Everything about a pass search that depends only on the observer and the time
 * range, not on which satellite is being propagated.
 *
 * Hoisting this out matters: darkness is identical for every satellite, so
 * computing it per satellite repeated the same few thousand solar-position
 * calculations once per object.
 */
export interface ObserverContext {
  observerGd: satellite.GeodeticLocation;
  darkWindows: Array<[Date, Date]>;
  /** Interpolated sun altitude in degrees at an epoch-millisecond time. */
  sunAltitudeAt: (ms: number) => number;
  from: Date;
  to: Date;
}

export function buildObserverContext(
  observer: Observer,
  opts: PassOptions,
  from: Date,
  to: Date
): ObserverContext {
  const observerGd: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(observer.longitude),
    latitude: satellite.degreesToRadians(observer.latitude),
    height: observer.elevation / 1000,
  };
  const astroObserver = new Astronomy.Observer(observer.latitude, observer.longitude, observer.elevation);

  // Cover the buffered window edges, which extend past the search range.
  const baseMs = from.getTime() - WINDOW_BUFFER_MS - SUN_TABLE_STEP_MS;
  const lastMs = to.getTime() + WINDOW_BUFFER_MS + SUN_TABLE_STEP_MS;
  const count = Math.ceil((lastMs - baseMs) / SUN_TABLE_STEP_MS) + 1;

  const table = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    table[i] = sunAltitudeDeg(new Date(baseMs + i * SUN_TABLE_STEP_MS), astroObserver);
  }

  const sunAltitudeAt = (ms: number): number => {
    const x = (ms - baseMs) / SUN_TABLE_STEP_MS;
    if (x <= 0) return table[0];
    if (x >= count - 1) return table[count - 1];
    const i = Math.floor(x);
    return table[i] + (table[i + 1] - table[i]) * (x - i);
  };

  // Darkness windows, read off the same table.
  const stepMs = opts.coarseStepMinutes * 60 * 1000;
  const darkWindows: Array<[Date, Date]> = [];
  let windowStart: number | null = null;

  for (let t = from.getTime(); t <= to.getTime(); t += stepMs) {
    const dark = sunAltitudeAt(t) < opts.sunAltitudeThresholdDeg;
    if (dark && windowStart === null) {
      windowStart = t;
    } else if (!dark && windowStart !== null) {
      darkWindows.push([new Date(windowStart - WINDOW_BUFFER_MS), new Date(t + WINDOW_BUFFER_MS)]);
      windowStart = null;
    }
  }
  if (windowStart !== null) {
    darkWindows.push([
      new Date(windowStart - WINDOW_BUFFER_MS),
      new Date(to.getTime() + WINDOW_BUFFER_MS),
    ]);
  }

  return { observerGd, darkWindows, sunAltitudeAt, from, to };
}

export function computeVisiblePasses(
  tle: TleRecord,
  observer: Observer,
  options: Partial<PassOptions> = {}
): PassSearchResult {
  const opts: PassOptions = { ...DEFAULT_PASS_OPTIONS, ...options };
  const now = opts.now ?? new Date();
  const end = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);
  return passesForSatellite(tle, buildObserverContext(observer, opts, now, end), opts);
}

/**
 * Passes for many satellites sharing one observer.
 *
 * The observer context is built once rather than per satellite, which is where
 * nearly all of the time went: darkness is the same for every object.
 */
export function computePassesForMany(
  tles: TleRecord[],
  observer: Observer,
  options: Partial<PassOptions> = {}
): PassSearchResult {
  const opts: PassOptions = { ...DEFAULT_PASS_OPTIONS, ...options };
  const now = opts.now ?? new Date();
  const end = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);
  const context = buildObserverContext(observer, opts, now, end);

  const passes: Pass[] = [];
  let tooFaintCount = 0;
  let brightest: number | null = null;

  for (const tle of tles) {
    const result = passesForSatellite(tle, context, opts);
    passes.push(...result.passes);
    tooFaintCount += result.tooFaintCount;
    if (
      result.brightestRejectedMagnitude !== null &&
      (brightest === null || result.brightestRejectedMagnitude < brightest)
    ) {
      brightest = result.brightestRejectedMagnitude;
    }
  }

  passes.sort((a, b) => new Date(a.start.time).getTime() - new Date(b.start.time).getTime());
  return { passes, tooFaintCount, brightestRejectedMagnitude: brightest };
}

/**
 * Elevation only — no sun, no shadow, no magnitude.
 *
 * The coarse scan below asks one question of a great many instants ("is this
 * thing above the horizon at all?"), and answering it does not need the solar
 * geometry that dominates the cost of a full sample.
 */
function elevationDegAt(
  satrec: satellite.SatRec,
  observerGd: satellite.GeodeticLocation,
  date: Date
): number | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  const positionEcf = satellite.eciToEcf(pv.position, satellite.gstime(date));
  const elevation = satellite.radiansToDegrees(satellite.ecfToLookAngles(observerGd, positionEcf).elevation);
  return Number.isFinite(elevation) ? elevation : null;
}

/**
 * Spans where the satellite is above the horizon, bracketed generously.
 *
 * A low-orbit satellite is above any given horizon for roughly a tenth of the
 * time, so sampling every dark second at ten-second resolution spends about
 * ninety percent of its effort on a satellite that is underground. This walks
 * the window at a coarse step and returns only the stretches worth looking at
 * closely, padded by two coarse steps either side so the fine scan always
 * starts before the true rise and continues past the true set — which is what
 * makes the two-stage result identical to scanning everything.
 */
function aboveHorizonSpans(
  satrec: satellite.SatRec,
  observerGd: satellite.GeodeticLocation,
  winStart: number,
  winEnd: number,
  coarseMs: number
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const pad = 2 * coarseMs;
  let openedAt: number | null = null;

  for (let t = winStart; t <= winEnd + coarseMs; t += coarseMs) {
    const elevation = elevationDegAt(satrec, observerGd, new Date(Math.min(t, winEnd)));
    // A null reading means SGP4 declined; treat it as "not up" but do not let
    // it split a span, since the fine scan skips those instants anyway.
    const up = elevation !== null && elevation > 0;

    if (up && openedAt === null) openedAt = t;
    else if (!up && openedAt !== null) {
      spans.push([Math.max(winStart, openedAt - pad), Math.min(winEnd, t + pad)]);
      openedAt = null;
    }
  }
  if (openedAt !== null) spans.push([Math.max(winStart, openedAt - pad), winEnd]);

  // Merge spans whose padding made them overlap, so no instant is scanned twice.
  const merged: Array<[number, number]> = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push(span);
  }
  return merged;
}

function passesForSatellite(
  tle: TleRecord,
  context: ObserverContext,
  opts: PassOptions
): PassSearchResult {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const { observerGd, darkWindows, sunAltitudeAt } = context;

  const passes: Pass[] = [];
  const rejected: number[] = [];
  const stepMs = opts.fineStepSeconds * 1000;
  const coarseMs = opts.horizonScanSeconds * 1000;

  for (const [winStart, winEnd] of darkWindows) {
    const spans =
      coarseMs > 0
        ? aboveHorizonSpans(satrec, observerGd, winStart.getTime(), winEnd.getTime(), coarseMs)
        : [[winStart.getTime(), winEnd.getTime()] as [number, number]];

    for (const [spanStart, spanEnd] of spans) {
      let current: Sample[] | null = null;

      // Sample on the same grid the window would have used if it were scanned
      // end to end. Starting each span wherever its padding happened to fall
      // would shift every sample instant, and a pass peaking within a whisker
      // of the ten-degree cutoff would then be reported or not depending on
      // where the coarse scan opened the span — the same sky giving different
      // answers for no physical reason.
      const gridStart =
        winStart.getTime() + Math.ceil((spanStart - winStart.getTime()) / stepMs) * stepMs;

      // Off-grid sampling, for pinning a pass's peak between two grid instants.
      const resample = (date: Date) =>
        sampleAt(satrec, tle.name, observerGd, sunAltitudeAt, date, opts);

      // The last instant looked at before the current one, whatever it showed.
      // When a pass opens, this is the far side of the bracket its true start
      // lies in; see refineBoundary.
      let previousMs: number | null = null;
      let beforeStartMs: number | null = null;

      for (let t = gridStart; t <= spanEnd; t += stepMs) {
        const sample = sampleAt(satrec, tle.name, observerGd, sunAltitudeAt, new Date(t), opts);
        if (!sample) {
          previousMs = t;
          continue;
        }

        if (isVisible(sample)) {
          if (!current) {
            current = [];
            beforeStartMs = previousMs;
          }
          current.push(sample);
        } else if (current) {
          // This sample is why the pass ended, so it carries the reason, and it
          // is also the far side of the bracket the true end lies in.
          finalizePass(current, tle, opts, passes, rejected, sample, resample, beforeStartMs, t);
          current = null;
          beforeStartMs = null;
        }
        previousMs = t;
      }
      if (current) {
        finalizePass(current, tle, opts, passes, rejected, null, resample, beforeStartMs, null);
      }
    }
  }

  passes.sort((a, b) => new Date(a.start.time).getTime() - new Date(b.start.time).getTime());
  return {
    passes,
    tooFaintCount: rejected.length,
    brightestRejectedMagnitude: rejected.length ? Math.min(...rejected) : null,
  };
}

/**
 * Why a pass stopped being visible, derived from the first sample that failed
 * the visibility test.
 *
 * It has to come from the terminating sample, not the last visible one: every
 * sample inside a pass is illuminated and above the horizon by construction, so
 * inspecting the last visible sample can only ever report "set". Distinguishing
 * these matters — a satellite fading out at 40 degrees elevation because it
 * entered Earth's shadow looks like it vanished, and is worth flagging.
 */
function endReasonFor(terminator: Sample | null): Pass["endReason"] {
  // No terminating sample means nothing ended the pass: the search window did.
  // This used to be reported as "set", which the detail panel renders as "sets
  // below horizon" — a statement that was simply false. Rare, but not harmless:
  // over ten days of the bundled catalogue from Singapore, one pass of 155 was
  // still 26.7 degrees up and sunlit when its span closed, and the app said it
  // had set. Eccentric orbits are what produce it, since they can stay above the
  // horizon long enough to outlast the stretch being scanned.
  if (!terminator) return "window";
  if (terminator.elevationDeg <= 0) return "set";
  if (!terminator.illuminated) return "shadow";
  if (!terminator.observerDark) return "daylight";
  return "set";
}

/** Iterations of ternary search used to pin the peak of a pass. */
const PEAK_ITERATIONS = 40;

/**
 * Whether a sample is a visible one: up, sunlit, and seen from darkness.
 *
 * Extracted so the boundary search below tests exactly the same condition the
 * scan does. Two definitions of "visible" that drifted apart would put a pass's
 * reported start at a moment the scan itself would not have called a start.
 */
function isVisible(sample: Sample): boolean {
  return sample.elevationDeg > 0 && sample.illuminated && sample.observerDark;
}

/** Bracket tolerance for the boundary search, in milliseconds. */
const BOUNDARY_TOLERANCE_MS = 50;

/**
 * Pin the instant a pass becomes, or stops being, visible.
 *
 * Visibility is a boolean that flips once inside the bracket the scan hands
 * over — one end saw a visible sample, the other did not — so bisection finds
 * the flip without needing to know which of the three conditions moved. That
 * matters: a pass can start by rising, by leaving Earth's shadow, or by the sky
 * getting dark enough, and root-finding on any single one of those would be
 * wrong for the other two.
 *
 * Worth the trouble because the boundaries were the last thing still being read
 * straight off the ten-second grid. Measured over 19 real passes against the
 * same scan run twenty times finer, the start was reported up to 9 s late (4.4 s
 * on average), the end up to 9.5 s early, and one pass's duration was 16 s short
 * of the truth. The reported elevation at the boundary was wrong by as much as
 * the timing implies: passes that end by setting were ending at up to 0.6 degrees
 * rather than at the horizon, and one pass claimed to become visible at 10.5
 * degrees when it really did so at 9.7.
 *
 * A null sample counts as not visible, matching what the scan does with one.
 */
function refineBoundary(
  resample: (date: Date) => Sample | null,
  visibleMs: number,
  invisibleMs: number
): Sample | null {
  let visible = visibleMs;
  let invisible = invisibleMs;

  while (Math.abs(invisible - visible) > BOUNDARY_TOLERANCE_MS) {
    const mid = Math.round((visible + invisible) / 2);
    const sample = resample(new Date(mid));
    if (sample && isVisible(sample)) visible = mid;
    else invisible = mid;
  }

  return resample(new Date(visible));
}

/**
 * Pin the instant a pass actually peaks, rather than taking the best sample.
 *
 * Elevation rises to a single maximum across a pass, so discarding the outer
 * third of a bracket converges on it. The bracket may run past the pass's own
 * samples, which is harmless: elevation is lower out there, so the search cannot
 * be drawn away from the peak.
 *
 * The elevation this recovers is a small thing — measured over 180 real passes
 * from the current bright catalogue, the fine grid understated the peak by 0.035
 * degrees on average and 1.4 degrees at worst, which nobody standing outside
 * would notice. The direction is not a small thing. Azimuth sweeps fastest
 * exactly where elevation peaks, so locating the peak to within ten seconds put
 * the reported peak azimuth up to 65 degrees out, and 20 of those 180 passes
 * named the wrong compass point — 15 of them below 80 degrees elevation, where a
 * direction is still something an observer can act on. One pass peaking at 78
 * degrees was reported as peaking due west when it actually peaked west
 * -southwest, 13 degrees away. The pass table's whole job is telling someone
 * where to look.
 *
 * Above about 80 degrees the azimuth of the peak is ill-conditioned rather than
 * merely mis-sampled — at the zenith it has no value at all — so five of those
 * twenty were never meaningful either way. Refining does not make an overhead
 * pass's direction useful; it makes the other fifteen right.
 *
 * The bracket is clamped to the visible stretch, and that is not tidiness. A
 * pass can end in Earth's shadow well before the geometry peaks, and searching
 * past the last visible sample would then report a peak the observer never saw
 * lit — a worse answer than the coarse one it replaced.
 */
function refinePeak(
  resample: (date: Date) => Sample | null,
  centre: Date,
  stepMs: number,
  earliestMs: number,
  latestMs: number
): Sample | null {
  let lo = Math.max(earliestMs, centre.getTime() - stepMs);
  let hi = Math.min(latestMs, centre.getTime() + stepMs);
  if (hi <= lo) return null;

  for (let i = 0; i < PEAK_ITERATIONS && hi - lo > 20; i++) {
    const third = (hi - lo) / 3;
    const m1 = lo + third;
    const m2 = hi - third;
    const s1 = resample(new Date(m1));
    const s2 = resample(new Date(m2));
    if (!s1 || !s2) return null;
    if (s1.elevationDeg > s2.elevationDeg) hi = m2;
    else lo = m1;
  }

  return resample(new Date(Math.round((lo + hi) / 2)));
}

function finalizePass(
  samples: Sample[],
  tle: TleRecord,
  opts: PassOptions,
  out: Pass[],
  rejectedMagnitudes: number[],
  terminator: Sample | null,
  resample: (date: Date) => Sample | null,
  beforeStartMs: number | null,
  afterEndMs: number | null
): void {
  // Boundaries first, and the order is not arbitrary. The grid brackets both
  // ends — the sample before the first visible one, and the sample that ended
  // the pass — so bisection locates them, and they can land outside the grid
  // samples by up to a step. The peak then has to be searched over that wider,
  // true interval: pinning it against the grid samples instead let a pass that
  // ends by entering Earth's shadow while still climbing report a final
  // elevation above its own peak.
  //
  // Where the scan has no bracket — a pass still running when the span closed,
  // or one already visible at its first instant — the grid sample stands, since
  // there is nothing to bisect against.
  let start = samples[0];
  let end = samples[samples.length - 1];
  if (beforeStartMs !== null) {
    const refinedStart = refineBoundary(resample, start.date.getTime(), beforeStartMs);
    if (refinedStart) start = refinedStart;
  }
  if (afterEndMs !== null) {
    const refinedEnd = refineBoundary(resample, end.date.getTime(), afterEndMs);
    if (refinedEnd) end = refinedEnd;
  }

  let maxSample = samples[0];
  for (const s of samples) {
    if (s.elevationDeg > maxSample.elevationDeg) maxSample = s;
  }

  // Ternary search over the visible interval, bracketed around the best grid
  // sample. Done before the elevation gate below, so the gate tests the pass's
  // real peak rather than whichever sample happened to land nearest it.
  const refined = refinePeak(
    resample,
    maxSample.date,
    opts.fineStepSeconds * 1000,
    start.date.getTime(),
    end.date.getTime()
  );
  if (refined && refined.elevationDeg > maxSample.elevationDeg) maxSample = refined;

  // The peak of a pass cannot be lower than either of its ends. Ternary search
  // converges on an endpoint when elevation is monotonic across the visible
  // stretch, which is what a pass cut short by shadow looks like, but taking the
  // maximum explicitly makes that hold whatever the search does.
  for (const candidate of [start, end]) {
    if (candidate.elevationDeg > maxSample.elevationDeg) maxSample = candidate;
  }

  if (maxSample.elevationDeg < opts.minElevationDeg) return;

  const brightest = samples.reduce((min, s) => (s.magnitude < min ? s.magnitude : min), maxSample.magnitude);

  // Geometry is fine but nobody could see it: record it so the caller can say
  // so, rather than silently returning an empty list.
  if (brightest > opts.maxMagnitude) {
    rejectedMagnitudes.push(Math.round(brightest * 10) / 10);
    return;
  }

  out.push({
    satnum: tle.satnum,
    name: tle.name,
    start: toPassEvent(start),
    max: toPassEvent(maxSample),
    end: toPassEvent(end),
    magnitude: Math.round(brightest * 10) / 10,
    durationSeconds: Math.round((end.date.getTime() - start.date.getTime()) / 1000),
    endReason: endReasonFor(terminator),
  });
}
