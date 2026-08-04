import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILTIN_BODIES, getSmallBodies, julianToIso, parseRow, parseSbdb } from "./smallBodies.js";

const FIELDS = ["full_name", "pdes", "e", "q", "tp", "i", "om", "w", "H", "G", "M1", "K1"];

test("Julian dates convert to the calendar", () => {
  // J2000.0 is JD 2451545.0 at 2000-01-01 12:00 UT, by definition.
  assert.equal(julianToIso(2_451_545.0), "2000-01-01T12:00:00.000Z");
  assert.equal(julianToIso(2_440_587.5), "1970-01-01T00:00:00.000Z");
});

test("an asteroid row becomes an asteroid", () => {
  const body = parseRow(FIELDS, ["1 Ceres", "1", 0.0785, 2.5489, 2_461_124.5, 10.588, 80.26, 73.7, 3.34, 0.12, null, null])!;
  assert.equal(body.kind, "asteroid");
  assert.equal(body.name, "1 Ceres");
  assert.equal(body.absoluteMagnitude, 3.34, "H, not M1");
  assert.equal(body.slope, 0.12, "G, not K1");
  assert.equal(body.e, 0.0785);
});

test("a comet row becomes a comet, with the other photometry", () => {
  const body = parseRow(FIELDS, ["1P/Halley", "1P", 0.9671, 0.586, 2_446_470.5, 162.26, 58.42, 111.33, null, null, 5.5, 8])!;
  assert.equal(body.kind, "comet");
  assert.equal(body.absoluteMagnitude, 5.5, "M1, not H");
  assert.equal(body.slope, 8, "K1, not G");

  // A designation alone is enough, even without photometry.
  const bare = parseRow(FIELDS, ["C/2026 A1 (Test)", "C/2026 A1", 1.0, 0.8, 2_461_200.5, 90, 10, 20, null, null, null, null])!;
  assert.equal(bare.kind, "comet");
  assert.equal(bare.absoluteMagnitude, null, "no photometry is null, not zero");
});

test("an element set that cannot be propagated is refused, not patched", () => {
  // A body placed from incomplete elements appears somewhere confidently
  // wrong, which is worse than not appearing.
  assert.equal(parseRow(FIELDS, ["No eccentricity", "x", null, 2, 2_461_124.5, 10, 80, 73, 3, 0.1, null, null]), null);
  assert.equal(parseRow(FIELDS, ["No perihelion time", "x", 0.1, 2, null, 10, 80, 73, 3, 0.1, null, null]), null);
  // Both name columns empty — the first column is full_name, the second pdes.
  assert.equal(parseRow(FIELDS, ["", "", 0.1, 2, 2_461_124.5, 10, 80, 73, 3, 0.1, null, null]), null);
  // Physically impossible values are refused too.
  assert.equal(parseRow(FIELDS, ["Negative q", "x", 0.1, -2, 2_461_124.5, 10, 80, 73, 3, 0.1, null, null]), null);
  assert.equal(parseRow(FIELDS, ["Negative e", "x", -0.1, 2, 2_461_124.5, 10, 80, 73, 3, 0.1, null, null]), null);
});

test("junk from JPL cannot crash the endpoint", () => {
  assert.deepEqual(parseSbdb(null), []);
  assert.deepEqual(parseSbdb({ error: "rate limited" }), []);
  assert.deepEqual(parseSbdb({ fields: FIELDS, data: "not an array" }), []);
  assert.deepEqual(parseSbdb({ fields: FIELDS, data: [null, 7, {}] }), []);
  // A good row alongside bad ones still comes through.
  const mixed = parseSbdb({
    fields: FIELDS,
    data: [null, ["1 Ceres", "1", 0.0785, 2.5489, 2_461_124.5, 10.588, 80.26, 73.7, 3.34, 0.12, null, null]],
  });
  assert.equal(mixed.length, 1);
});

test("an unreachable JPL falls back and says so", async () => {
  // This sandbox has no route to ssd-api.jpl.nasa.gov, which is the failure
  // the fallback exists for.
  const result = await getSmallBodies();
  assert.ok(["live", "cache", "builtin"].includes(result.source));
  assert.ok(result.bodies.length > 0, "the sky must not be empty with no explanation");
  if (result.source === "builtin") {
    assert.ok(result.error && result.error.length > 0, "a fallback must explain itself");
    assert.ok(result.bodies.every((b) => b.kind === "asteroid"), "only well-known asteroids are compiled in");
  }
});

test("the built-in bodies are usable element sets", () => {
  // Compiled-in data gets no validation from the parser, so it is checked here.
  for (const body of BUILTIN_BODIES) {
    assert.ok(body.e >= 0 && body.e < 1, `${body.name} eccentricity ${body.e}`);
    assert.ok(body.q > 0 && body.q < 5, `${body.name} perihelion ${body.q} AU`);
    assert.ok(body.i >= 0 && body.i <= 180, `${body.name} inclination ${body.i}`);
    assert.ok(body.node >= 0 && body.node < 360, `${body.name} node ${body.node}`);
    assert.ok(body.peri >= 0 && body.peri < 360, `${body.name} argument ${body.peri}`);
    assert.ok(!Number.isNaN(Date.parse(body.tp)), `${body.name} perihelion time ${body.tp}`);
    assert.ok(body.absoluteMagnitude !== null, `${body.name} must have photometry to be worth listing`);
  }
});
