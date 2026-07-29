import * as satellite from "satellite.js";
import * as Astronomy from "astronomy-engine";
import type { TleRecord } from "./celestrak.js";
import type { Observer, Pass, PassEvent } from "./types.js";

const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6371;
const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export interface PassOptions {
  days: number; // how many days ahead to search
  minElevationDeg: number; // minimum peak elevation to count as a "pass"
  sunAltitudeThresholdDeg: number; // observer is "dark" when sun altitude is below this
  coarseStepMinutes: number; // resolution for the darkness scan
  fineStepSeconds: number; // resolution for the pass scan inside dark windows
}

export const DEFAULT_PASS_OPTIONS: PassOptions = {
  days: 10,
  minElevationDeg: 10,
  sunAltitudeThresholdDeg: -6, // civil twilight
  coarseStepMinutes: 5,
  fineStepSeconds: 10,
};

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function azToCompass(azDeg: number): string {
  const idx = Math.round(((azDeg % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS[idx];
}

// Standard magnitude (apparent mag at 1000km range, 90deg phase angle) used
// as the base for the approximate brightness formula. Real values vary by
// satellite orientation/attitude; these are reasonable ballpark figures.
function standardMagnitude(name: string): number {
  const n = name.toUpperCase();
  if (n.includes("ZARYA") || n.includes("ISS")) return -1.8;
  if (n.includes("TIANGONG") || n.includes("CSS")) return 0.8;
  if (n.includes("HST") || n.includes("HUBBLE")) return 1.5;
  if (n.includes("STARLINK")) return 4.5;
  return 3.0;
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

function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

/** Geocentric equatorial (~ECI) position of the Sun in km. */
function sunEciKm(date: Date): Vec3 {
  const v = Astronomy.GeoVector(Astronomy.Body.Sun, date, false);
  return { x: v.x * AU_KM, y: v.y * AU_KM, z: v.z * AU_KM };
}

/** Simple cylindrical shadow model: is the satellite lit by the sun? */
function isIlluminated(satEci: Vec3, sunEci: Vec3): boolean {
  const sunDist = mag(sunEci);
  const sunUnit = scale(sunEci, 1 / sunDist);
  const satDotSun = dot(satEci, sunUnit);
  if (satDotSun > 0) return true; // day side of Earth
  const perp = sub(satEci, scale(sunUnit, satDotSun));
  return mag(perp) > EARTH_RADIUS_KM;
}

/** Apparent visual magnitude approximation. Lower (more negative) = brighter. */
function apparentMagnitude(name: string, satEci: Vec3, sunEci: Vec3, obsEci: Vec3): number {
  const satToSun = sub(sunEci, satEci);
  const satToObs = sub(obsEci, satEci);
  const rangeKm = mag(satToObs);
  const cosPhase = dot(satToSun, satToObs) / (mag(satToSun) * rangeKm);
  const phaseAngle = Math.acos(Math.min(1, Math.max(-1, cosPhase)));
  const term = Math.sin(phaseAngle) + (Math.PI - phaseAngle) * Math.cos(phaseAngle);
  if (term <= 0) return 99; // essentially unlit from observer's viewpoint
  const stdMag = standardMagnitude(name);
  return stdMag - 15 + 5 * Math.log10(rangeKm) - 2.5 * Math.log10(term);
}

function sunAltitudeDeg(date: Date, astroObserver: Astronomy.Observer): number {
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
  observerGd: { longitude: number; latitude: number; height: number },
  astroObserver: Astronomy.Observer,
  date: Date
): Sample | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv.position || typeof pv.position === "boolean") return null;

  const gmst = satellite.gstime(date);
  const positionEcf = satellite.eciToEcf(pv.position, gmst);
  const look = satellite.ecfToLookAngles(observerGd, positionEcf);
  const elevationDeg = radToDeg(look.elevation);
  const azimuthDeg = radToDeg(look.azimuth);

  const satEci: Vec3 = pv.position;
  const sunEci = sunEciKm(date);
  const illuminated = isIlluminated(satEci, sunEci);

  const obsEcf = satellite.geodeticToEcf(observerGd);
  const obsEci = satellite.ecfToEci(obsEcf, gmst);

  const observerDark = sunAltitudeDeg(date, astroObserver) < DEFAULT_PASS_OPTIONS.sunAltitudeThresholdDeg;
  const magnitude = apparentMagnitude(name, satEci, sunEci, obsEci);

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

/**
 * Find darkness windows (observer sun altitude below threshold) over the
 * search period, expanded with a buffer so fine-grained pass scanning
 * doesn't clip passes that start/end right at the window edge.
 */
function findDarkWindows(astroObserver: Astronomy.Observer, start: Date, end: Date, opts: PassOptions): Array<[Date, Date]> {
  const stepMs = opts.coarseStepMinutes * 60 * 1000;
  const bufferMs = 15 * 60 * 1000;
  const windows: Array<[Date, Date]> = [];
  let windowStart: Date | null = null;

  for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
    const date = new Date(t);
    const dark = sunAltitudeDeg(date, astroObserver) < opts.sunAltitudeThresholdDeg;
    if (dark && windowStart === null) {
      windowStart = date;
    } else if (!dark && windowStart !== null) {
      windows.push([new Date(windowStart.getTime() - bufferMs), new Date(t + bufferMs)]);
      windowStart = null;
    }
  }
  if (windowStart !== null) {
    windows.push([new Date(windowStart.getTime() - bufferMs), new Date(end.getTime() + bufferMs)]);
  }
  return windows;
}

export function computeVisiblePasses(
  tle: TleRecord,
  observer: Observer,
  options: Partial<PassOptions> = {}
): Pass[] {
  const opts: PassOptions = { ...DEFAULT_PASS_OPTIONS, ...options };
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);

  const observerGd = {
    longitude: satellite.degreesToRadians(observer.longitude),
    latitude: satellite.degreesToRadians(observer.latitude),
    height: observer.elevation / 1000,
  };
  const astroObserver = new Astronomy.Observer(observer.latitude, observer.longitude, observer.elevation);

  const now = new Date();
  const end = new Date(now.getTime() + opts.days * 24 * 60 * 60 * 1000);
  const darkWindows = findDarkWindows(astroObserver, now, end, opts);

  const passes: Pass[] = [];
  const stepMs = opts.fineStepSeconds * 1000;

  for (const [winStart, winEnd] of darkWindows) {
    let current: Sample[] | null = null;

    for (let t = winStart.getTime(); t <= winEnd.getTime(); t += stepMs) {
      const sample = sampleAt(satrec, tle.name, observerGd, astroObserver, new Date(t));
      if (!sample) continue;

      const visible = sample.elevationDeg > 0 && sample.illuminated && sample.observerDark;

      if (visible) {
        if (!current) current = [];
        current.push(sample);
      } else if (current) {
        finalizePass(current, tle, opts, passes);
        current = null;
      }
    }
    if (current) {
      finalizePass(current, tle, opts, passes);
    }
  }

  return passes.sort((a, b) => new Date(a.start.time).getTime() - new Date(b.start.time).getTime());
}

function finalizePass(samples: Sample[], tle: TleRecord, opts: PassOptions, out: Pass[]): void {
  let maxSample = samples[0];
  for (const s of samples) {
    if (s.elevationDeg > maxSample.elevationDeg) maxSample = s;
  }
  if (maxSample.elevationDeg < opts.minElevationDeg) return;

  const start = samples[0];
  const end = samples[samples.length - 1];
  const brightest = samples.reduce((min, s) => (s.magnitude < min ? s.magnitude : min), maxSample.magnitude);

  out.push({
    satnum: tle.satnum,
    name: tle.name,
    start: toPassEvent(start),
    max: toPassEvent(maxSample),
    end: toPassEvent(end),
    magnitude: Math.round(brightest * 10) / 10,
    durationSeconds: Math.round((end.date.getTime() - start.date.getTime()) / 1000),
    endReason: !end.illuminated ? "shadow" : "set",
  });
}
