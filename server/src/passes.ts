import * as satellite from "satellite.js";
import * as AstronomyModule from "astronomy-engine";
import type { TleRecord } from "./celestrak.js";
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
  maxMagnitude: 5.5,
};

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
function standardMagnitude(name: string): number {
  const n = name.toUpperCase();

  if (n.includes("ZARYA") || /\bISS\b/.test(n)) return -1.8;
  if (n.includes("TIANGONG") || /\bCSS\b/.test(n) || n.includes("TIANHE")) return 0.8;
  if (n.includes("HST") || n.includes("HUBBLE")) return 1.5;
  if (n.includes("STARLINK")) return 4.5;

  // Debris fragments: small, tumbling, effectively invisible to the eye.
  if (/\bDEB\b|DEBRIS|\bFRAG\b/.test(n)) return 8.0;
  // Spent upper stages are large cylinders and often naked-eye objects.
  if (/R\/B|ROCKET BODY|\bAKM\b|CENTAUR|\bBREEZE\b|\bFREGAT\b/.test(n)) return 3.5;

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
 * Apparent visual magnitude approximation. Lower (more negative) = brighter.
 * `shadowFrac` dims the satellite as it crosses the penumbra into eclipse.
 */
function apparentMagnitude(
  name: string,
  satEci: Vec3,
  sunEciKm: Vec3,
  obsEci: Vec3,
  shadowFrac: number
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
  return base - 2.5 * Math.log10(litFraction);
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
  const magnitude = apparentMagnitude(name, pv.position, sunEciKm, obsEci, shadowFrac);

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
  const now = new Date();
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
  const now = new Date();
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

  for (const [winStart, winEnd] of darkWindows) {
    let current: Sample[] | null = null;

    for (let t = winStart.getTime(); t <= winEnd.getTime(); t += stepMs) {
      const sample = sampleAt(satrec, tle.name, observerGd, sunAltitudeAt, new Date(t), opts);
      if (!sample) continue;

      const visible = sample.elevationDeg > 0 && sample.illuminated && sample.observerDark;

      if (visible) {
        if (!current) current = [];
        current.push(sample);
      } else if (current) {
        // This sample is why the pass ended, so it carries the reason.
        finalizePass(current, tle, opts, passes, rejected, sample);
        current = null;
      }
    }
    if (current) {
      finalizePass(current, tle, opts, passes, rejected, null);
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
  if (!terminator) return "set"; // ran past the end of the search window
  if (terminator.elevationDeg <= 0) return "set";
  if (!terminator.illuminated) return "shadow";
  if (!terminator.observerDark) return "daylight";
  return "set";
}

function finalizePass(
  samples: Sample[],
  tle: TleRecord,
  opts: PassOptions,
  out: Pass[],
  rejectedMagnitudes: number[],
  terminator: Sample | null
): void {
  let maxSample = samples[0];
  for (const s of samples) {
    if (s.elevationDeg > maxSample.elevationDeg) maxSample = s;
  }
  if (maxSample.elevationDeg < opts.minElevationDeg) return;

  const start = samples[0];
  const end = samples[samples.length - 1];
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
