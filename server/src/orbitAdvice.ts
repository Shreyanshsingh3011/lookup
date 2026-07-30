import { askGrounded } from "./ai.js";

/**
 * "How should I launch this?" advisor.
 *
 * Deliberately scoped to real orbital mechanics, not launch shopping. There is
 * no public API for real launch pricing, provider manifests, or schedule
 * availability, so a tool that claimed to find "the cheapest real launch"
 * would just be presenting fabricated numbers as authoritative commercial
 * data. What the app *can* ground honestly is physics: which orbit regime and
 * inclination fit a mission, why a launch site's latitude makes some
 * inclinations cheap and others expensive, and what actually drives a launch
 * window. The system prompt below is the enforcement point for that boundary
 * — it explicitly forbids prices, providers, rockets, and calendar dates.
 */

export const MISSION_TYPES = [
  "earth-observation",
  "communications",
  "navigation",
  "technology-demo",
  "human-spaceflight",
  "scientific-research",
  "deep-space",
] as const;

export type MissionType = (typeof MISSION_TYPES)[number];

export interface OrbitAdviceRequest {
  missionType: MissionType;
  /** Free-text description of what the mission is trying to accomplish. */
  missionGoal: string;
  /** Approximate launch site latitude — sets the cheaply-reachable inclination range. */
  launchSiteLatitudeDeg: number;
  /** Optional free-text timing preference, used only as context, never validated against a real schedule. */
  timingNotes: string | null;
}

export interface OrbitAdviceResult {
  advice: string;
  source: "ai" | "template";
}

const MAX_GOAL_LENGTH = 500;
const MAX_TIMING_LENGTH = 200;

const DISCLAIMER =
  "This is general orbital-mechanics guidance, not a real launch quote — it doesn't know current providers, prices, rockets, or manifest availability.";

const MISSION_TEMPLATES: Record<MissionType, string> = {
  "earth-observation":
    "Earth observation missions typically fly low Earth orbit, roughly 400-700 km, often in a sun-synchronous near-polar orbit " +
    "(around 97-99° inclination) so the satellite crosses each point on the ground at the same local solar time every pass, " +
    "giving consistent lighting for imagery.",
  communications:
    "Communications satellites split into two very different regimes: geostationary orbit (about 35,786 km, 0° inclination) gives " +
    "one satellite continuous coverage of a fixed footprint but costs far more delta-v to reach; a LEO constellation (roughly " +
    "500-1,200 km) needs many satellites working together, but each one is cheaper to launch and easier to replace.",
  navigation:
    "Navigation constellations such as GPS, Galileo, and GLONASS fly medium Earth orbit, roughly 20,000-23,000 km, spread across " +
    "several orbital planes so multiple satellites are visible from any point on Earth at once — this is a whole-constellation " +
    "design problem, not a single-launch one.",
  "technology-demo":
    "Technology demonstrations usually don't have a strict orbit requirement, which makes them strong candidates for a rideshare " +
    "launch into whatever orbit the primary payload is already going to — commonly a mid-inclination LEO around 500-600 km.",
  "human-spaceflight":
    "Crewed missions to date have flown low Earth orbit, roughly 400-450 km — high enough that atmospheric drag doesn't decay the " +
    "orbit quickly, low enough to stay well inside the Van Allen belts. The ISS's 51.6° inclination was chosen so both US and " +
    "Russian launch sites can reach it without an expensive plane-change burn.",
  "scientific-research":
    "Scientific missions vary widely by instrument: an orbit chosen to minimize atmospheric drag and radiation for a telescope " +
    "looks nothing like one chosen to sample the magnetosphere or observe the poles, so the instrument's actual observing " +
    "requirement is what should drive the orbit choice.",
  "deep-space":
    "Anything leaving Earth orbit trades the 'which orbit' question for 'which departure trajectory and when' — the launch window " +
    "is set by the relative positions of Earth and the target body, not by a fixed altitude/inclination choice the way an " +
    "Earth-orbiting mission is.",
};

function inclinationNote(launchSiteLatitudeDeg: number): string {
  const lat = Math.abs(launchSiteLatitudeDeg).toFixed(1);
  return (
    `Launching from a site at ${lat}°, the cheapest inclinations to reach directly are at or above that latitude — going to a ` +
    `lower inclination (closer to the equator) needs a dogleg or plane-change maneuver that burns extra propellant. A ` +
    `sun-synchronous or polar orbit is reachable from anywhere, but always costs more delta-v than an inclination close to the ` +
    `launch site's own latitude.`
  );
}

function timingNote(): string {
  return (
    "Timing has a real physics component separate from any commercial schedule: to reach a specific orbital plane, the launch " +
    "has to happen when Earth's rotation brings the launch site through that plane, so there's a preferred time of day rather " +
    "than a preferred date. Sun-synchronous or eclipse-sensitive designs also care about the time of year, for lighting and " +
    "power reasons."
  );
}

function templateFor(request: OrbitAdviceRequest): string {
  const parts = [
    MISSION_TEMPLATES[request.missionType],
    inclinationNote(request.launchSiteLatitudeDeg),
    timingNote(),
    DISCLAIMER,
  ];
  return parts.join(" ");
}

function systemPromptFor(request: OrbitAdviceRequest): string {
  return [
    "You are an orbital-mechanics advisor inside a satellite-tracking app. Someone planning a space mission is asking what orbit",
    "fits their goal. You are NOT a launch broker: you have no data on real launch providers, rockets, prices, or schedule",
    "availability, and must never state or imply any of those as fact.",
    "",
    "Given their mission type, a free-text description of their goal, and their approximate launch site latitude, cover:",
    "1. What orbit regime and altitude range fits (LEO/MEO/GEO/HEO/sun-synchronous/polar/etc.) and why, using real orbital mechanics.",
    "2. What inclination makes sense, and how the launch site's latitude affects what's cheap vs costly to reach: a launch can reach",
    "   an inclination equal to or greater than the site's own latitude without an expensive plane-change burn; a lower inclination",
    "   needs a dogleg or plane change that costs extra delta-v.",
    "3. Qualitative, physics-based cost/complexity tradeoffs (higher orbits and bigger inclination changes cost more delta-v;",
    "   sun-synchronous needs near-polar inclination; rideshare vs dedicated launch) — with NO specific dollar figure, provider",
    "   name, rocket name, or real price.",
    "4. Timing considerations that are genuinely physics-based: launch windows are set by wanting to reach a specific orbital plane",
    "   (a preferred time of day, since Earth's rotation only lines up with a given plane periodically) and, for sun-synchronous or",
    "   eclipse-sensitive designs, time of year. Do NOT state or imply any specific calendar date or real launch opportunity.",
    "",
    "Write 4-6 short paragraphs of plain text — no markdown, no headings, no bullet lists. End by being explicit that this is",
    "general guidance, not a real cost or schedule quote, since that needs live commercial data this app doesn't have.",
    "",
    `Facts:\n${JSON.stringify(request, null, 2)}`,
  ].join("\n");
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseOrbitAdviceRequest(body: unknown): OrbitAdviceRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  if (!MISSION_TYPES.includes(b.missionType as MissionType)) return null;
  if (!isNonEmptyString(b.missionGoal) || b.missionGoal.length > MAX_GOAL_LENGTH) return null;
  if (!isFiniteNumber(b.launchSiteLatitudeDeg) || Math.abs(b.launchSiteLatitudeDeg) > 90) return null;
  if (b.timingNotes !== null && (!isNonEmptyString(b.timingNotes) || (b.timingNotes as string).length > MAX_TIMING_LENGTH)) {
    return null;
  }

  return {
    missionType: b.missionType as MissionType,
    missionGoal: b.missionGoal.trim(),
    launchSiteLatitudeDeg: b.launchSiteLatitudeDeg,
    timingNotes: b.timingNotes === null ? null : (b.timingNotes as string).trim(),
  };
}

export async function adviseOnOrbit(request: OrbitAdviceRequest): Promise<OrbitAdviceResult> {
  const ai = await askGrounded({
    system: systemPromptFor(request),
    user: "What orbit and launch approach fits this mission? Use the facts you were given.",
    maxTokens: 500,
  });

  if (ai) return { advice: ai, source: "ai" };
  return { advice: templateFor(request), source: "template" };
}
