import assert from "node:assert/strict";
import { test } from "node:test";
import { explainObject, parseExplainSubject, type ExplainSubject } from "./explain.js";

const ISS: ExplainSubject = {
  kind: "satellite",
  name: "ISS (ZARYA)",
  altitudeKm: 422,
  speedKmS: 7.66,
  elevationDeg: 45.3,
  azimuthDeg: 210.5,
  direction: "SSW",
  illuminated: true,
  nextPassTime: "2026-08-01T20:15:00.000Z",
};

const MOON = {
  kind: "planet" as const,
  name: "Moon",
  elevationDeg: 30.2,
  azimuthDeg: 90,
  direction: "E",
  magnitude: -12.3,
  illuminatedFraction: 0.72,
};

const VEGA = {
  kind: "star" as const,
  name: "Vega",
  elevationDeg: 60.1,
  azimuthDeg: 45.0,
  direction: "NE",
  magnitude: 0.03,
  constellation: "Lyra",
};

const AIRCRAFT = {
  kind: "aircraft" as const,
  name: "BAW123",
  elevationDeg: 32.5,
  azimuthDeg: 210.0,
  direction: "SSW",
  altitudeM: 10668,
  rangeKm: 18.4,
  originCountry: "United Kingdom",
  groundSpeedKmH: 880,
};

test("parseExplainSubject accepts a well-formed aircraft body", () => {
  assert.deepEqual(parseExplainSubject(AIRCRAFT), AIRCRAFT);
  // originCountry and groundSpeedKmH are both nullable.
  const sparse = { ...AIRCRAFT, originCountry: null, groundSpeedKmH: null };
  assert.deepEqual(parseExplainSubject(sparse), sparse);
});

test("parseExplainSubject rejects an aircraft missing its geometry", () => {
  assert.equal(parseExplainSubject({ ...AIRCRAFT, altitudeM: "high" }), null);
  assert.equal(parseExplainSubject({ ...AIRCRAFT, rangeKm: null }), null);
});

test("explainObject template for an aircraft states altitude, range and the blinking giveaway", async () => {
  const result = await explainObject(AIRCRAFT);
  assert.equal(result.source, "template");
  assert.match(result.explanation, /BAW123/);
  assert.match(result.explanation, /10,668 m/);
  assert.match(result.explanation, /18 km/);
  assert.match(result.explanation, /880 km\/h/);
  // The whole point of the layer: how to tell a plane from a satellite.
  assert.match(result.explanation, /blink/i);
});

test("explainObject template omits ground speed when it was not reported", async () => {
  const result = await explainObject({ ...AIRCRAFT, groundSpeedKmH: null });
  assert.doesNotMatch(result.explanation, /over the ground/);
  assert.match(result.explanation, /BAW123/);
});

test("parseExplainSubject accepts a well-formed satellite body", () => {
  const parsed = parseExplainSubject(ISS);
  assert.deepEqual(parsed, ISS);
});

test("parseExplainSubject accepts a well-formed planet body, including null fields", () => {
  const withNulls = { ...MOON, magnitude: null, illuminatedFraction: null };
  assert.deepEqual(parseExplainSubject(withNulls), withNulls);
});

test("parseExplainSubject accepts a well-formed star body", () => {
  assert.deepEqual(parseExplainSubject(VEGA), VEGA);
  // constellation is nullable
  assert.deepEqual(parseExplainSubject({ ...VEGA, constellation: null }), { ...VEGA, constellation: null });
});

test("parseExplainSubject rejects missing shared fields", () => {
  assert.equal(parseExplainSubject({ ...ISS, name: "" }), null);
  assert.equal(parseExplainSubject({ ...ISS, elevationDeg: "45" }), null);
  assert.equal(parseExplainSubject({ ...ISS, elevationDeg: NaN }), null);
  assert.equal(parseExplainSubject({ ...ISS, direction: undefined }), null);
});

test("parseExplainSubject rejects a kind-specific field of the wrong type", () => {
  assert.equal(parseExplainSubject({ ...ISS, illuminated: "yes" }), null);
  assert.equal(parseExplainSubject({ ...ISS, altitudeKm: "422" }), null);
  assert.equal(parseExplainSubject({ ...VEGA, magnitude: "bright" }), null);
});

test("parseExplainSubject rejects an unknown or missing kind", () => {
  assert.equal(parseExplainSubject({ ...ISS, kind: "asteroid" }), null);
  assert.equal(parseExplainSubject({ ...ISS, kind: undefined }), null);
  assert.equal(parseExplainSubject(null), null);
  assert.equal(parseExplainSubject("ISS"), null);
  assert.equal(parseExplainSubject([]), null);
});

// No ANTHROPIC_API_KEY is set in this test run, so explainObject always takes
// the template path here — which is exactly what should be verified without
// spending real API credit on every test run. The live AI path has its own
// smoke test (check-explain.ts) for when a key is available.
test("explainObject falls back to a template with no API key configured, satellite", async () => {
  const result = await explainObject(ISS);
  assert.equal(result.source, "template");
  assert.match(result.explanation, /ISS \(ZARYA\)/);
  assert.match(result.explanation, /422 km/);
  assert.match(result.explanation, /7\.7 km\/s/);
  assert.match(result.explanation, /sunlit/i);
  assert.match(result.explanation, /next viewing opportunity/i);
});

test("explainObject template omits the pass sentence when there is no next pass", async () => {
  const result = await explainObject({ ...ISS, nextPassTime: null });
  assert.doesNotMatch(result.explanation, /next viewing opportunity/i);
});

test("explainObject template distinguishes an eclipsed satellite", async () => {
  const result = await explainObject({ ...ISS, illuminated: false });
  assert.match(result.explanation, /Earth's shadow/);
  assert.doesNotMatch(result.explanation, /steady, unblinking/);
});

test("explainObject template for a planet includes magnitude and phase when given", async () => {
  const result = await explainObject(MOON);
  assert.equal(result.source, "template");
  assert.match(result.explanation, /Moon/);
  assert.match(result.explanation, /-12\.3/);
  assert.match(result.explanation, /72% illuminated/);
});

test("explainObject template for a planet omits fields that are null", async () => {
  const result = await explainObject({ ...MOON, magnitude: null, illuminatedFraction: null });
  assert.doesNotMatch(result.explanation, /magnitude/i);
  assert.doesNotMatch(result.explanation, /illuminated/i);
});

test("explainObject template for a star includes its constellation when given", async () => {
  const result = await explainObject(VEGA);
  assert.equal(result.source, "template");
  assert.match(result.explanation, /Vega/);
  assert.match(result.explanation, /Lyra/);
  assert.match(result.explanation, /brightest stars/i); // magnitude 0.03 < 1
});

test("explainObject template for a fainter star does not overclaim brightness", async () => {
  const result = await explainObject({ ...VEGA, magnitude: 2.5 });
  assert.doesNotMatch(result.explanation, /brightest stars/i);
  assert.match(result.explanation, /useful naked-eye landmark/i);
});
