import type { TleRecord } from "./celestrak.js";

/**
 * Space debris and derelicts.
 *
 * Two things share this screen and they are deliberately not one list with a
 * type filter, because they are not the same kind of thing and do not behave
 * the same way.
 *
 * A DEBRIS CLOUD is a breakup event. Its members have no individual identity
 * worth showing — nobody wants to read a list of two thousand fragments called
 * "COSMOS 2251 DEB" — and what matters is the event, its date, and how much of
 * it is still up there. It is fetched wholesale as a CelesTrak group.
 *
 * A NOTABLE DERELICT is one object with a name and a story: a spent upper
 * stage bright enough to watch, or a dead payload people still look for. It is
 * fetched individually by catalogue number, which also means one of them
 * disappearing from the catalogue is a normal per-object outcome rather than a
 * failure of the whole screen.
 *
 * They are fetched differently, cached differently, and displayed differently.
 * Collapsing them into one collection would force the wrong shape on both.
 */

export type ObjectType = "PAYLOAD" | "ROCKET BODY" | "DEBRIS" | "UNKNOWN";

/**
 * How an object's type was determined.
 *
 * Worth carrying, because the two routes do not have the same authority: an
 * explicit OBJECT_TYPE from the catalogue is a fact, while a type inferred
 * from a name is a convention that mostly holds.
 */
/**
 * Names that prove an object is a spent stage or a fragment.
 *
 * One definition, because there were three and they disagreed. The magnitude
 * model knew CENTAUR, BREEZE and FREGAT were upper stages; the classifier and
 * the dome did not, so Atlas Centaur 2 was estimated as a bright rocket body
 * and drawn as a working payload at the same time. It is on this app's own
 * derelict shortlist, and rendered active in a browser.
 *
 * Reliable in one direction only. A match proves the object is dead; no match
 * proves nothing, because plenty of debris predates the convention and a dead
 * payload never announces itself. See the catalogue layer for the other half.
 */
export const ROCKET_BODY_NAME =
  /R\/B|ROCKET BODY|\bAKM\b|\bPKM\b|\bCENTAUR\b|\bBREEZE\b|\bBRIZ\b|\bFREGAT\b|TRANSTAGE|\bAGENA\b|\bABLESTAR\b/;
export const DEBRIS_NAME = /\bDEB\b|DEBRIS|\bFRAG\b|\bCOOLANT\b|\bSHROUD\b|\bWESTFORD NEEDLES\b/;

export type ClassificationSource = "field" | "name";

export interface Classification {
  type: ObjectType;
  source: ClassificationSource;
}

/**
 * Classify an object.
 *
 * Prefers an explicit OBJECT_TYPE where the source provides one. CelesTrak's
 * GP endpoint serves OMM, which does not carry the field; its SATCAT does, as
 * does Space-Track. So the field is used when present and the naming
 * convention when it is not, rather than assuming either is always available.
 *
 * The naming convention is reliable in one direction and not the other: a name
 * ending "DEB" or containing "R/B" is definitely that thing, but a name
 * without either is only probably a payload — plenty of debris predates the
 * convention. That asymmetry is why an inferred PAYLOAD is reported as having
 * come from the name, so the interface can decline to make claims about it.
 */
export function classify(name: string, objectType?: string | null): Classification {
  const declared = normaliseObjectType(objectType);
  if (declared) return { type: declared, source: "field" };

  const upper = name.toUpperCase();
  if (DEBRIS_NAME.test(upper)) {
    return { type: "DEBRIS", source: "name" };
  }
  if (ROCKET_BODY_NAME.test(upper)) {
    return { type: "ROCKET BODY", source: "name" };
  }
  if (/\bUNKNOWN\b|^TBA\b|OBJECT [A-Z]$/.test(upper)) {
    return { type: "UNKNOWN", source: "name" };
  }
  return { type: "PAYLOAD", source: "name" };
}

function normaliseObjectType(raw?: string | null): ObjectType | null {
  if (!raw || typeof raw !== "string") return null;
  const value = raw.trim().toUpperCase();
  // Both the long and short spellings occur: SATCAT uses PAY/R/B/DEB/UNK,
  // Space-Track's satcat uses the words.
  if (value === "PAY" || value === "PAYLOAD") return "PAYLOAD";
  if (value === "R/B" || value === "ROCKET BODY") return "ROCKET BODY";
  if (value === "DEB" || value === "DEBRIS") return "DEBRIS";
  if (value === "UNK" || value === "UNKNOWN") return "UNKNOWN";
  return null;
}

/** A breakup event whose fragments are still catalogued as a group. */
export interface DebrisCloud {
  /** Our key. Appears in permalinks, so it is stable. */
  id: string;
  /** CelesTrak's group name. */
  celestrakGroup: string;
  label: string;
  /** What happened, in a sentence. */
  event: string;
  /** When it happened, ISO date. */
  eventDate: string;
  /**
   * Fragments catalogued in the years after the event — a historical figure,
   * not a current one, and the two differ by a lot.
   *
   * Drag removes fragments continuously, fastest from the lowest orbits, so a
   * cloud shrinks from the bottom up. Taken from Space-Track's SATCAT on
   * 2026-08-05, counting every catalogued fragment including those that have
   * since reentered:
   *
   *   Fengyun-1C   3531 catalogued, 1214 reentered, 2317 still up
   *   Cosmos 2251  1714 catalogued, 1096 reentered,  618 still up
   *   Iridium 33    656 catalogued,  539 reentered,  117 still up
   *   Cosmos 1408  1806 catalogued, 1802 reentered,    4 still up
   *
   * Cosmos 1408 is the case that proves the mechanism rather than merely
   * illustrating it: a 2021 test into orbits low enough that all but four
   * fragments carry a decay date already. Earlier versions of this file guessed
   * 1500 for it and showed that as the present population.
   *
   * So this must never be presented as "what is up there" — that is
   * `stillInOrbit`, and what CelesTrak can currently propagate is smaller again.
   */
  peakCatalogued: number;
  /**
   * Fragments catalogued and not yet reentered, from Space-Track's SATCAT.
   *
   * A third number, and genuinely distinct from the other two. Space-Track
   * counts everything catalogued without a decay date; CelesTrak's per-event
   * group counts only what currently has published element sets, which is
   * consistently fewer — 1,932 against 2,317 for Fengyun-1C. Neither is wrong.
   * One is "still up there", the other is "still trackable", and the gap is
   * objects the catalogue knows about but cannot presently propagate.
   */
  stillInOrbit: number;
  /** When the two counts above were taken, since both move. */
  countsAsOf: string;
  /** Typical altitude band of the cloud, km. */
  altitudeBandKm: [number, number];
}

/**
 * The four breakup events CelesTrak publishes as their own groups.
 *
 * These need no account and are the events that actually changed the debris
 * environment. Nothing else is listed, because inventing a group name
 * CelesTrak does not serve would produce an empty panel with no explanation.
 */
export const DEBRIS_CLOUDS: DebrisCloud[] = [
  {
    id: "fengyun-1c",
    celestrakGroup: "fengyun-1c-debris",
    label: "Fengyun-1C",
    event:
      "China destroyed its own weather satellite in an anti-satellite test, the single worst debris-generating event on record.",
    eventDate: "2007-01-11",
    peakCatalogued: 3531,
    stillInOrbit: 2317,
    countsAsOf: "2026-08-05",
    altitudeBandKm: [200, 3800],
  },
  {
    id: "cosmos-2251",
    celestrakGroup: "cosmos-2251-debris",
    label: "Cosmos 2251",
    event:
      "A derelict Russian communications satellite collided with the working Iridium 33 — the first accidental collision between two intact satellites.",
    eventDate: "2009-02-10",
    peakCatalogued: 1714,
    stillInOrbit: 618,
    countsAsOf: "2026-08-05",
    altitudeBandKm: [200, 1700],
  },
  {
    id: "iridium-33",
    celestrakGroup: "iridium-33-debris",
    label: "Iridium 33",
    event: "The other half of the 2009 collision: an operational satellite, destroyed while working.",
    eventDate: "2009-02-10",
    peakCatalogued: 656,
    stillInOrbit: 117,
    countsAsOf: "2026-08-05",
    altitudeBandKm: [200, 1400],
  },
  {
    id: "cosmos-1408",
    celestrakGroup: "cosmos-1408-debris",
    label: "Cosmos 1408",
    event:
      "A Russian anti-satellite test that forced the ISS crew into their escape vehicles as the cloud passed.",
    eventDate: "2021-11-15",
    peakCatalogued: 1806,
    stillInOrbit: 4,
    countsAsOf: "2026-08-05",
    altitudeBandKm: [200, 1100],
  },
];

/** One derelict object worth looking at in its own right. */
export interface NotableDerelict {
  satnum: string;
  /** Our label, which may differ from the catalogue's terse name. */
  label: string;
  kind: "rocket-body" | "payload";
  /** Why this one is worth a look. */
  note: string;
}

/**
 * Derelicts worth naming.
 *
 * Chosen for being findable rather than for being numerous: big spent stages
 * that are genuinely naked-eye objects, and dead payloads with a story. Every
 * one of these is a long-catalogued object in a reasonably high orbit, so the
 * list does not rot the way a list of low debris would.
 *
 * Each is looked up individually by catalogue number, so one of them being
 * deorbited between releases costs that row and nothing else.
 */
export const NOTABLE_DERELICTS: NotableDerelict[] = [
  {
    satnum: "00694",
    label: "Atlas Centaur 2",
    kind: "rocket-body",
    // Not "one of the oldest object in orbit": 1958 Vanguard hardware is
    // still up there, five years older. The checkable claim is the narrower
    // one — it has the lowest catalogue number in CelesTrak's bright-objects
    // group, verified against the live group on 2026-08-05.
    note: "Launched 1963 and still up there — the oldest object in the catalogue of naked-eye satellites, though older, fainter hardware from 1958 is also still in orbit.",
  },
  {
    satnum: "02802",
    label: "SL-8 R/B (Cosmos 249)",
    kind: "rocket-body",
    note: "A 1967 Soviet upper stage, one of hundreds of SL-8 bodies that make up much of what people actually see pass over.",
  },
  {
    satnum: "16182",
    label: "SL-16 R/B (Zenit-2)",
    kind: "rocket-body",
    note: "A Zenit second stage: nine tonnes and eleven metres long, among the brightest derelicts in the sky.",
  },
  {
    satnum: "23705",
    label: "SL-16 R/B",
    kind: "rocket-body",
    note: "Another Zenit stage in the same crowded 850 km band, and a frequent close-approach partner.",
  },
  {
    satnum: "10967",
    label: "Seasat 1",
    kind: "payload",
    note: "NASA's first ocean-observing radar satellite, dead after 105 days in 1978 from a power fault, still in orbit.",
  },
  {
    satnum: "00900",
    label: "Calsphere 1",
    kind: "payload",
    note: "A calibration sphere from 1964 — no instruments, no power, just a metal ball still going round.",
  },
  {
    satnum: "20580",
    label: "Hubble Space Telescope",
    kind: "payload",
    note: "Not derelict, but included as the reference point: a large, bright, well-known object to compare the rest against.",
  },
  {
    satnum: "22195",
    label: "LAGEOS 2",
    kind: "payload",
    // The often-quoted "8.4 million years" is LAGEOS-1's figure, and this is
    // LAGEOS-2 in a slightly lower orbit. Rather than transplant a number
    // that belongs to the other satellite, state what this one's own
    // elements support: at ~5,800 km there is effectively no atmosphere, and
    // the app's own decay estimator returns "stable" for it.
    note: "Not derelict, and worth being clear about why: a passive sphere of brass and aluminium studded with retroreflectors, with no power and no instruments — so nothing aboard can fail, and ground stations still range it by laser today. SATCAT lists it operational. It is here as the far end of the scale: an orbit near 5,800 km, where there is effectively no atmosphere left to slow it, and which will outlast everything else on this list by millions of years.",
  },
];

/**
 * Split a mixed catalogue by object type.
 *
 * Returned as separate arrays rather than an annotated flat list, because
 * every caller wants one kind or another and a flat list makes it too easy to
 * forget the filter and quietly run a pass search against everything.
 */
export function partitionByType(
  tles: TleRecord[],
  objectTypes?: Map<string, string>
): Record<ObjectType, TleRecord[]> {
  const out: Record<ObjectType, TleRecord[]> = {
    PAYLOAD: [],
    "ROCKET BODY": [],
    DEBRIS: [],
    UNKNOWN: [],
  };
  for (const tle of tles) {
    const { type } = classify(tle.name, objectTypes?.get(tle.satnum));
    out[type].push(tle);
  }
  return out;
}

/**
 * A derelict that could not be resolved.
 *
 * Debris and low rocket bodies are deorbited and struck from the catalogue
 * constantly, so a catalogue number that no longer exists is an ordinary
 * outcome rather than a failure. It is reported as its own kind of result so
 * the interface can say "this one is gone" instead of either hiding the row or
 * turning the whole screen into an error.
 */
export type DerelictStatus = "resolved" | "not-in-catalogue" | "unavailable";

export interface ResolvedDerelict {
  entry: NotableDerelict;
  status: DerelictStatus;
  tle: TleRecord | null;
  /** Present only when the lookup failed for a reason worth showing. */
  error?: string;
}

/**
 * Whether an upstream failure means "gone" or "could not ask".
 *
 * The distinction matters: a 404 from the catalogue is a fact about the object,
 * while a timeout is a fact about the network, and telling somebody their
 * bookmarked rocket body has reentered when the truth is that a proxy was down
 * would be a lie the app could easily avoid.
 */
export function statusFromError(message: string): DerelictStatus {
  return /no satellite found|404|not found/i.test(message) ? "not-in-catalogue" : "unavailable";
}

const EARTH_RADIUS_KM = 6378.137;
const MU_EARTH = 398_600.4418;

/**
 * Highest latitude an orbit's ground track reaches.
 *
 * Not the inclination: past 90 degrees a track leans back toward the equator,
 * so a sun-synchronous orbit at 98 degrees reaches only 82.
 */
export function groundTrackLimitDeg(inclinationDeg: number): number {
  // The wrap is skipped for values already in range. Adding and subtracting
  // 360 is not lossless in binary — it turns 51.6 into 51.60000000000002 —
  // and an inclination read straight off an element line should come back
  // exactly as it went in.
  let wrapped = inclinationDeg;
  if (wrapped < 0 || wrapped >= 360) wrapped = ((wrapped % 360) + 360) % 360;
  const folded = wrapped > 180 ? 360 - wrapped : wrapped;
  return folded > 90 ? 180 - folded : folded;
}

/** Angular radius of the region an object at this altitude can be seen from. */
export function footprintRadiusDeg(altitudeKm: number): number {
  if (!(altitudeKm > 0)) return 0;
  return (Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm)) * 180) / Math.PI;
}

export interface TleGeometry {
  inclinationDeg: number;
  perigeeAltitudeKm: number;
  apogeeAltitudeKm: number;
}

/** Inclination, perigee and apogee straight off the element lines. */
export function geometryFromTle(tle: TleRecord): TleGeometry | null {
  const inclinationDeg = Number(tle.line2.slice(8, 16));
  const eccentricity = Number(`0.${tle.line2.slice(26, 33).trim()}`);
  const meanMotionRevPerDay = Number(tle.line2.slice(52, 63));
  if (!Number.isFinite(inclinationDeg) || !Number.isFinite(eccentricity) || !(meanMotionRevPerDay > 0)) {
    return null;
  }
  const n = (meanMotionRevPerDay * 2 * Math.PI) / 86_400;
  const semiMajorAxisKm = Math.cbrt(MU_EARTH / (n * n));
  if (!Number.isFinite(semiMajorAxisKm)) return null;

  return {
    inclinationDeg,
    perigeeAltitudeKm: semiMajorAxisKm * (1 - eccentricity) - EARTH_RADIUS_KM,
    apogeeAltitudeKm: semiMajorAxisKm * (1 + eccentricity) - EARTH_RADIUS_KM,
  };
}

/** Below this an orbit is measured in days and its elements are already stale. */
export const MIN_USEFUL_PERIGEE_KM = 130;

/**
 * Could this object ever rise above the observer's horizon?
 *
 * Decidable from two fields with no propagation, which is the point: the
 * alternative is discovering the same thing by running a ten-day SGP4 search
 * per object and finding nothing.
 *
 * Honest about its own limits. Against the four named breakup clouds, whose
 * inclinations run from 74 to 99 degrees, this rejects almost nothing for a
 * mid-latitude observer — those orbits genuinely do pass over most of the
 * inhabited world. Its work is done on low-inclination objects seen from high
 * latitudes, and on the fragments whose perigees have already decayed below
 * anything usable. The brightness cap downstream is what bounds the cost in
 * the remaining cases; this narrows the field first, cheaply, and neither one
 * alone is enough.
 */
export function canEverRise(tle: TleRecord, observerLatitudeDeg: number): boolean {
  const geometry = geometryFromTle(tle);
  if (!geometry) return false;
  if (!(geometry.perigeeAltitudeKm >= MIN_USEFUL_PERIGEE_KM)) return false;

  // Apogee, not perigee: an eccentric orbit is seen furthest when highest, and
  // judging on perigee would discard real passes.
  const reach = groundTrackLimitDeg(geometry.inclinationDeg) + footprintRadiusDeg(geometry.apogeeAltitudeKm);
  return Math.abs(observerLatitudeDeg) <= reach;
}

export interface ReachFilterResult {
  candidates: TleRecord[];
  /** Objects that can never rise here, or whose elements are unusable. */
  skipped: number;
}

export function filterByReach(tles: TleRecord[], observerLatitudeDeg: number): ReachFilterResult {
  const candidates = tles.filter((tle) => canEverRise(tle, observerLatitudeDeg));
  return { candidates, skipped: tles.length - candidates.length };
}

/**
 * The object that broke up, found among its own fragments.
 *
 * Three of the four groups still carry their parent payload alongside the
 * debris, so it can be identified from the data rather than written down —
 * the difference between a fact and a claim that quietly goes stale.
 *
 * It must be matched by name, not merely by being the group's only payload.
 * Taking the first PAYLOAD in the list is right for every real debris group
 * and catastrophically wrong the moment the group is anything else: pointed at
 * a file of station keplerians during testing, that version announced the ISS
 * as the parent of the Iridium 33 cloud, with complete confidence. A claim
 * this specific has to be checked against the thing it names.
 *
 * Returns null when the parent has reentered or was never catalogued with its
 * fragments, which is an ordinary outcome — Cosmos 1408 and Fengyun-1C were
 * both destroyed, and what is left of them may not include the bus.
 */
function normaliseName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function findCloudParent(
  cloud: Pick<DebrisCloud, "label">,
  tles: Array<{ satnum: string; name: string }>
): { satnum: string; name: string } | null {
  const target = normaliseName(cloud.label);
  for (const tle of tles) {
    if (classify(tle.name).type !== "PAYLOAD") continue;
    if (normaliseName(tle.name) !== target) continue;
    return { satnum: tle.satnum, name: tle.name.trim() };
  }
  return null;
}
