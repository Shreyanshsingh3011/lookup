import assert from "node:assert/strict";
import { test } from "node:test";
import { getTransmitters, parseSatnogs } from "./radio.js";

test("the register's payload is read into something an operator can use", () => {
  const parsed = parseSatnogs([
    { description: "Mode V/U FM", uplink_low: 145_850_000, downlink_low: 436_795_000, mode: "FM", alive: true, type: "Transponder" },
    { description: "Beacon", downlink_low: 145_935_000, mode: "CW", alive: true, type: "Transmitter" },
  ]);
  assert.equal(parsed.length, 2);
  // Looked up by name: entries are ordered for the reader (working first, then
  // by downlink), which is not the order the register happened to send them.
  const transponder = parsed.find((t) => t.description === "Mode V/U FM")!;
  const beacon = parsed.find((t) => t.description === "Beacon")!;
  assert.equal(transponder.uplinkHz, 145_850_000);
  assert.equal(transponder.downlinkHz, 436_795_000);
  assert.equal(transponder.mode, "FM");
  assert.equal(beacon.uplinkHz, null, "a beacon has no uplink, and null is not zero");
});

test("entries that could not help anybody are dropped", () => {
  // A transmitter with neither frequency tells an operator nothing, and would
  // render as a row of dashes.
  const parsed = parseSatnogs([
    { description: "Nothing useful", alive: true },
    { description: "Real", downlink_low: 437_000_000, alive: true },
  ]);
  assert.deepEqual(parsed.map((t) => t.description), ["Real"]);
});

test("dead transmitters are kept but marked, not silently dropped", () => {
  // "This used to work" is more useful than an unexplained absence when
  // somebody is hunting for a satellite they read about.
  const parsed = parseSatnogs([
    { description: "Old", downlink_low: 145_900_000, alive: false },
    { description: "Working", downlink_low: 437_100_000, alive: true },
  ]);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].description, "Working", "working services must lead");
  assert.equal(parsed[1].alive, false);
});

test("a status of dead counts even when alive was not set", () => {
  const [only] = parseSatnogs([{ description: "Gone", downlink_low: 145_900_000, status: "dead" }]);
  assert.equal(only.alive, false);
});

test("junk from the register cannot crash the endpoint", () => {
  assert.deepEqual(parseSatnogs(null), []);
  assert.deepEqual(parseSatnogs({ detail: "Not found" }), []);
  assert.deepEqual(parseSatnogs([null, undefined, 42, "nonsense"]), []);
  assert.deepEqual(parseSatnogs([{ downlink_low: "not a number" }]), []);
});

test("the ISS still answers when the register cannot be reached", async () => {
  // This sandbox has no route to db.satnogs.org, which is exactly the failure
  // the built-in fallback exists for. The three ISS services have been on the
  // same frequencies for years and are the ones people look up.
  const result = await getTransmitters("25544");
  assert.ok(["live", "cache", "builtin"].includes(result.source), `source was ${result.source}`);
  assert.ok(result.transmitters.length >= 3, "the ISS carries at least three amateur services");
  const packet = result.transmitters.find((t) => /APRS|packet/i.test(t.description));
  if (result.source === "builtin") {
    assert.equal(packet?.downlinkHz, 145_825_000, "the ISS digipeater is on 145.825");
    assert.equal(packet?.uplinkHz, 145_825_000, "and it is simplex");
  }
});

test("a satellite with no amateur payload says so rather than inventing one", async () => {
  const result = await getTransmitters("99999");
  assert.ok(Array.isArray(result.transmitters));
  if (result.source === "unavailable") {
    assert.deepEqual(result.transmitters, []);
    assert.ok(result.error && result.error.length > 0, "an unavailable register must explain itself");
  }
});
