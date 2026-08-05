import { estimateDecay, orbitalElementsFromTle, type DecayEstimate } from './decay';
import { footprintRadiusDeg } from './groundTrack';
import { maxGroundTrackLatitudeDeg } from './orbitalMechanics';
import { observerToGeodetic, parseSatrec, skySampleAt } from './sky';
import type { Observer, TleRecord } from '../types';

/**
 * Making a debris catalogue affordable to search.
 *
 * The curated satellite list is a few hundred objects. A single breakup cloud
 * is thousands, and all four together are the better part of ten thousand —
 * an order of magnitude more, against a pass search that costs milliseconds
 * per object. Run at that scale it stops being a web request.
 *
 * The saving comes from a fact SGP4 will happily confirm the expensive way:
 * most of those fragments can never appear above a given horizon at all,
 * because their orbits do not reach the observer's latitude. That is decidable
 * from two numbers in the TLE, with no propagation, so it is decided first.
 */

/** Inclination and mean motion, straight off the element lines. */
export function inclinationDeg(tle: TleRecord): number {
  return Number(tle.line2.slice(8, 16));
}

export interface ReachAssessment {
  reachable: boolean;
  /** Highest latitude the ground track reaches. */
  groundTrackLimitDeg: number;
  /** How far past that the object can still be seen, from its altitude. */
  footprintDeg: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
  /** Why it was rejected, when it was. */
  reason: 'reachable' | 'never-rises' | 'too-low' | 'too-high' | 'unreadable';
}

/**
 * Above this, an object is in sunlight essentially all night and is far
 * enough away to be faint — and, more to the point for a pass search, it does
 * not produce the discrete passes this app reports.
 */
export const MAX_USEFUL_ALTITUDE_KM = 6000;
/**
 * Below this, an orbit is measured in days rather than years. Elements that
 * low are stale almost as soon as they are published.
 */
export const MIN_USEFUL_PERIGEE_KM = 130;

/**
 * Can this object ever appear above the observer's horizon?
 *
 * An orbit's ground track never exceeds its inclination in latitude — folded
 * for retrograde orbits, where 98 degrees reaches only 82 — and the object is
 * visible from a ring around that track whose radius follows from its
 * altitude. Add the two and anything beyond is geometrically out of reach,
 * whatever the time of night.
 *
 * The apogee altitude is used for the footprint rather than the perigee: an
 * eccentric orbit is seen furthest when it is highest, and rejecting on the
 * perigee would discard real passes.
 */
export function assessReach(tle: TleRecord, observer: Observer): ReachAssessment {
  const inclination = inclinationDeg(tle);
  const elements = orbitalElementsFromTle(tle);
  const { perigeeAltitudeKm, apogeeAltitudeKm } = elements;

  const unreadable =
    !Number.isFinite(inclination) ||
    !Number.isFinite(perigeeAltitudeKm) ||
    !Number.isFinite(apogeeAltitudeKm);

  const groundTrackLimitDeg = unreadable ? 0 : maxGroundTrackLatitudeDeg(inclination);
  const footprintDeg = unreadable || apogeeAltitudeKm <= 0 ? 0 : footprintRadiusDeg(apogeeAltitudeKm);

  if (unreadable) {
    return {
      reachable: false,
      groundTrackLimitDeg,
      footprintDeg,
      perigeeAltitudeKm,
      apogeeAltitudeKm,
      reason: 'unreadable',
    };
  }

  const base = { groundTrackLimitDeg, footprintDeg, perigeeAltitudeKm, apogeeAltitudeKm };
  if (perigeeAltitudeKm < MIN_USEFUL_PERIGEE_KM) {
    return { ...base, reachable: false, reason: 'too-low' };
  }
  if (perigeeAltitudeKm > MAX_USEFUL_ALTITUDE_KM) {
    return { ...base, reachable: false, reason: 'too-high' };
  }
  if (Math.abs(observer.latitude) > groundTrackLimitDeg + footprintDeg) {
    return { ...base, reachable: false, reason: 'never-rises' };
  }
  return { ...base, reachable: true, reason: 'reachable' };
}

export interface PreFilterResult {
  /** Objects worth propagating. */
  candidates: TleRecord[];
  /** How many were discarded, by why. */
  rejected: Record<Exclude<ReachAssessment['reason'], 'reachable'>, number>;
  examined: number;
}

/**
 * Cut a catalogue down to what could plausibly be seen, before propagating.
 *
 * Cheap by construction: two field reads and some trigonometry per object,
 * against a full SGP4 pass search that samples every dark minute of ten days.
 */
export function preFilter(tles: TleRecord[], observer: Observer): PreFilterResult {
  const candidates: TleRecord[] = [];
  const rejected = { 'never-rises': 0, 'too-low': 0, 'too-high': 0, unreadable: 0 };

  for (const tle of tles) {
    const assessment = assessReach(tle, observer);
    if (assessment.reachable) candidates.push(tle);
    else if (assessment.reason !== 'reachable') rejected[assessment.reason] += 1;
  }

  return { candidates, rejected, examined: tles.length };
}

/**
 * How old a TLE's own epoch is.
 *
 * Read off the element line rather than taken from when it was fetched: a
 * freshly downloaded file can contain month-old elements, and it is the epoch
 * that governs whether a prediction means anything.
 */
export function tleAgeDays(tle: TleRecord, now: Date = new Date()): number | null {
  const epoch = tleEpoch(tle);
  if (!epoch) return null;
  return (now.getTime() - epoch.getTime()) / 86_400_000;
}

/** The epoch encoded in line 1, columns 19-32. */
export function tleEpoch(tle: TleRecord): Date | null {
  const raw = tle.line1.slice(18, 32).trim();
  const yearField = Number(raw.slice(0, 2));
  const dayOfYear = Number(raw.slice(2));
  if (!Number.isFinite(yearField) || !Number.isFinite(dayOfYear) || dayOfYear <= 0) return null;

  // Two-digit years: the convention is 57-99 for the 1900s, 00-56 for the
  // 2000s, which is why objects launched in 1957 still parse correctly.
  const year = yearField < 57 ? 2000 + yearField : 1900 + yearField;
  const start = Date.UTC(year, 0, 1);
  return new Date(start + (dayOfYear - 1) * 86_400_000);
}

export type FreshnessLevel = 'fresh' | 'ageing' | 'stale' | 'unusable';

export interface Freshness {
  level: FreshnessLevel;
  ageDays: number | null;
  note: string;
}

/**
 * Whether a prediction from these elements is worth believing.
 *
 * SGP4's accuracy decays with the age of its elements, and it decays faster
 * the lower the orbit, because drag is what the model is least able to
 * extrapolate. A week-old element set for a 250 km fragment is worthless while
 * the same age for a 1400 km rocket body is fine — so the thresholds move with
 * perigee rather than being one number for everything.
 *
 * This matters far more here than elsewhere in the app. The tracked satellite
 * groups are mostly stable objects with fresh elements; debris is neither.
 */
export function assessFreshness(tle: TleRecord, now: Date = new Date()): Freshness {
  const ageDays = tleAgeDays(tle, now);
  if (ageDays === null) return { level: 'unusable', ageDays: null, note: 'The element epoch could not be read.' };
  if (ageDays < 0) {
    // An epoch in the future is not impossible — elements are sometimes
    // published slightly ahead — but a long way ahead means a bad parse.
    if (ageDays < -2) return { level: 'unusable', ageDays, note: 'The element epoch is in the future.' };
    return { level: 'fresh', ageDays, note: 'Elements published just ahead of now.' };
  }

  const { perigeeAltitudeKm } = orbitalElementsFromTle(tle);
  // Low orbits are dragged hardest, so their elements go off fastest.
  const scale = !Number.isFinite(perigeeAltitudeKm)
    ? 1
    : perigeeAltitudeKm < 300
      ? 0.3
      : perigeeAltitudeKm < 500
        ? 0.6
        : perigeeAltitudeKm < 900
          ? 1
          : 2;

  if (ageDays <= 3 * scale) {
    return { level: 'fresh', ageDays, note: 'Elements are current.' };
  }
  if (ageDays <= 7 * scale) {
    return { level: 'ageing', ageDays, note: 'Pass times may be a few seconds out.' };
  }
  if (ageDays <= 21 * scale) {
    return {
      level: 'stale',
      ageDays,
      note: 'Old enough that pass times could be minutes out — treat the position as approximate.',
    };
  }
  return {
    level: 'unusable',
    ageDays,
    note: 'Far too old to predict from. The object may already have reentered.',
  };
}

export interface DebrisRisk {
  freshness: Freshness;
  decay: DecayEstimate | null;
  /** True when the prediction should not be relied on at all. */
  unreliable: boolean;
  /** One line covering whichever problem is worse. */
  summary: string | null;
}

/**
 * The two ways a debris prediction goes wrong, together.
 *
 * Stale elements and a decaying orbit are different failures — one is about
 * the data, the other about the object — but they compound, and a reader only
 * needs to be told the worse of the two.
 */
export function assessRisk(tle: TleRecord, now: Date = new Date()): DebrisRisk {
  const freshness = assessFreshness(tle, now);
  const decay = estimateDecay(tle, now);

  const decayed = decay?.status === 'decayed';
  const decayingSoon = decay?.status === 'decaying-soon';
  const unreliable = freshness.level === 'unusable' || decayed;

  let summary: string | null = null;
  if (decayed) {
    summary = 'These elements no longer propagate — this object has very likely reentered.';
  } else if (freshness.level === 'unusable') {
    summary = freshness.note;
  } else if (decayingSoon) {
    const days = decay?.estimatedDaysRemaining;
    summary =
      days === null || days === undefined
        ? 'Decaying: this orbit will not last.'
        : `Decaying — perhaps ${Math.round(days)} days left, if drag stays as it is.`;
  } else if (freshness.level === 'stale') {
    summary = freshness.note;
  }

  return { freshness, decay, unreliable, summary };
}

/**
 * When the next tracked derelict comes over the horizon.
 *
 * The shortlist is eight objects, and eight objects in low orbit are almost
 * never all up at once — measured against live elements, at least one is above
 * the horizon only about 45% of the time, from anywhere on Earth. So an empty
 * debris layer is the ordinary case, not a failure, and a live view that draws
 * nothing and says nothing is indistinguishable from one that is broken.
 *
 * This is what turns "nothing right now" into an answer: the object, and when
 * to look. A coarse forward scan is enough — the caller wants a time to come
 * back at, not an ephemeris — and eight objects at a minute's step over a day
 * is a few thousand propagations, which is milliseconds.
 */
export interface NextRise {
  satnum: string;
  name: string;
  time: Date;
  /** Minutes from the search start, so a caller can phrase it either way. */
  minutesAway: number;
}

export function nextDerelictRise(
  tles: TleRecord[],
  observer: Observer,
  from: Date,
  { withinHours = 24, stepSeconds = 60 }: { withinHours?: number; stepSeconds?: number } = {}
): NextRise | null {
  const observerGd = observerToGeodetic(observer);
  const startMs = from.getTime();
  const stepMs = stepSeconds * 1000;
  const steps = Math.ceil((withinHours * 3600) / stepSeconds);

  let best: NextRise | null = null;

  for (const tle of tles) {
    const rec = parseSatrec(tle);
    if (!rec) continue;

    // Only a rise counts, not "already up". An object above the horizon at the
    // search start is the caller's business — they can see it — and reporting
    // it as the next thing to look for would be nonsense.
    let wasUp: boolean | null = null;
    const limit = best ? Math.min(steps, Math.ceil((best.time.getTime() - startMs) / stepMs)) : steps;

    for (let i = 0; i <= limit; i++) {
      const when = new Date(startMs + i * stepMs);
      const sample = skySampleAt(rec, observerGd, when);
      if (!sample) break;
      const up = sample.elevationDeg >= 0;
      if (wasUp === false && up) {
        best = {
          satnum: tle.satnum,
          name: tle.name.trim(),
          time: when,
          minutesAway: Math.round((when.getTime() - startMs) / 60_000),
        };
        break;
      }
      wasUp = up;
    }
  }

  return best;
}

/**
 * Whether an object's name already tells you it is dead.
 *
 * The naming convention is reliable in one direction only. A name containing
 * "R/B" or ending "DEB" is definitely a spent stage or a fragment — that is
 * what those names mean, and a spent stage is derelict by definition, with no
 * judgement call involved. A name without either is only *probably* a working
 * payload: Envisat, ERS-1, Seasat and Hitomi are all dead, and nothing in
 * their names says so.
 *
 * So this returns true only for the cases the name proves, and callers treat
 * everything else as active. That errs towards drawing a dead payload as
 * though it were alive, which is the wrong answer — but it is a wrong answer
 * the data supports, where the alternative would be guessing.
 *
 * This matters more than it looks. CelesTrak's "visual" group — the brightest
 * objects, and one of this app's defaults — is 157 objects of which 93 are
 * spent rocket bodies. Drawing those as working satellites would mean most of
 * what the dome shows is mislabelled.
 */
/**
 * Kept byte-identical to the server's copy in server/src/debris.ts.
 *
 * There were three of these and they disagreed: the magnitude model knew
 * CENTAUR, BREEZE and FREGAT were upper stages, the classifier and this file
 * did not. Atlas Centaur 2 was therefore estimated as a bright rocket body and
 * drawn as a working payload at the same time — it is on this app's own
 * derelict shortlist, and rendered active in a browser.
 */
export const ROCKET_BODY_NAME =
  /R\/B|ROCKET BODY|\bAKM\b|\bPKM\b|CENTAUR|\bBREEZE\b|\bBRIZ\b|\bFREGAT\b|TRANSTAGE|\bAGENA\b|\bABLESTAR\b/;
export const DEBRIS_NAME = /\bDEB\b|DEBRIS|\bFRAG\b|\bCOOLANT\b|\bSHROUD\b|\bWESTFORD NEEDLES\b/;

export function isDerelictByName(name: string): boolean {
  const upper = name.toUpperCase();
  if (DEBRIS_NAME.test(upper)) return true;
  return ROCKET_BODY_NAME.test(upper);
}

/**
 * The point field, minus anything already drawn as its own marker.
 *
 * Two populations share the dome and they must not overlap: fragments as a
 * violet point field, spent stages and dead payloads as amber markers. Today
 * they are disjoint because the field comes from Space-Track's
 * OBJECT_TYPE=DEBRIS while the markers are exactly the ROCKET BODY and PAYLOAD
 * rows that query excludes.
 *
 * That is a property of one URL, though, not of the design, and it fails in two
 * directions. A user pinning a fragment from catalogue search puts the same
 * object in both lists today. Widening the satcat query to include stages —
 * an obvious future improvement — would put thousands in both. Either way the
 * object is drawn twice, once as a point and once as a marker on top of it, and
 * counted in both status lines. So the overlap is removed here rather than
 * assumed away upstream.
 */
export function excludeDrawnAsMarkers(
  fieldTles: TleRecord[],
  markerTles: readonly TleRecord[][]
): TleRecord[] {
  const drawn = new Set<string>();
  for (const list of markerTles) for (const t of list) drawn.add(t.satnum);
  if (drawn.size === 0) return fieldTles;
  return fieldTles.filter((t) => !drawn.has(t.satnum));
}
