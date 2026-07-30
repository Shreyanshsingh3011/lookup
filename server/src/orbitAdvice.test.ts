import assert from "node:assert/strict";
import { test } from "node:test";
import { adviseOnOrbit, parseOrbitAdviceRequest, type OrbitAdviceRequest } from "./orbitAdvice.js";

const EARTH_OBSERVATION: OrbitAdviceRequest = {
  missionType: "earth-observation",
  missionGoal: "Monitor crop health over a specific region on a weekly cadence.",
  launchSiteLatitudeDeg: 28.5,
  timingNotes: "Would like to launch within the next year.",
};

test("parseOrbitAdviceRequest accepts a well-formed request", () => {
  assert.deepEqual(parseOrbitAdviceRequest(EARTH_OBSERVATION), EARTH_OBSERVATION);
});

test("parseOrbitAdviceRequest accepts null timingNotes", () => {
  const withNullTiming = { ...EARTH_OBSERVATION, timingNotes: null };
  assert.deepEqual(parseOrbitAdviceRequest(withNullTiming), withNullTiming);
});

test("parseOrbitAdviceRequest trims missionGoal and timingNotes", () => {
  const padded = { ...EARTH_OBSERVATION, missionGoal: "  goal  ", timingNotes: "  soon  " };
  const parsed = parseOrbitAdviceRequest(padded);
  assert.equal(parsed?.missionGoal, "goal");
  assert.equal(parsed?.timingNotes, "soon");
});

test("parseOrbitAdviceRequest rejects an unknown mission type", () => {
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, missionType: "asteroid-mining" }), null);
});

test("parseOrbitAdviceRequest rejects an empty or oversized missionGoal", () => {
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, missionGoal: "" }), null);
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, missionGoal: "  " }), null);
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, missionGoal: "x".repeat(501) }), null);
});

test("parseOrbitAdviceRequest rejects an out-of-range or non-finite latitude", () => {
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, launchSiteLatitudeDeg: 91 }), null);
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, launchSiteLatitudeDeg: -91 }), null);
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, launchSiteLatitudeDeg: NaN }), null);
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, launchSiteLatitudeDeg: "28.5" }), null);
});

test("parseOrbitAdviceRequest rejects an oversized timingNotes", () => {
  assert.equal(parseOrbitAdviceRequest({ ...EARTH_OBSERVATION, timingNotes: "x".repeat(201) }), null);
});

test("parseOrbitAdviceRequest rejects non-object or missing bodies", () => {
  assert.equal(parseOrbitAdviceRequest(null), null);
  assert.equal(parseOrbitAdviceRequest("go"), null);
  assert.equal(parseOrbitAdviceRequest([]), null);
});

// No ANTHROPIC_API_KEY is set in this test run, so adviseOnOrbit always takes
// the template path here. The live AI path has its own smoke test
// (check-orbit-advice.ts) for when a key is available.
test("adviseOnOrbit falls back to a template with no API key configured", async () => {
  const result = await adviseOnOrbit(EARTH_OBSERVATION);
  assert.equal(result.source, "template");
  assert.match(result.advice, /sun-synchronous/i);
  assert.match(result.advice, /28\.5/);
  assert.match(result.advice, /not a real launch quote/i);
});

test("adviseOnOrbit template never mentions a dollar figure", async () => {
  for (const missionType of [
    "earth-observation",
    "communications",
    "navigation",
    "technology-demo",
    "human-spaceflight",
    "scientific-research",
    "deep-space",
  ] as const) {
    const result = await adviseOnOrbit({ ...EARTH_OBSERVATION, missionType });
    assert.doesNotMatch(result.advice, /\$/);
  }
});

test("adviseOnOrbit template varies by mission type", async () => {
  const geo = await adviseOnOrbit({ ...EARTH_OBSERVATION, missionType: "communications" });
  assert.match(geo.advice, /geostationary/i);

  const deepSpace = await adviseOnOrbit({ ...EARTH_OBSERVATION, missionType: "deep-space" });
  assert.match(deepSpace.advice, /departure trajectory/i);
});
