import assert from "node:assert/strict";
import { test } from "node:test";
import { boundingBox, parseStates } from "./aircraft.js";

/**
 * A state vector in OpenSky's documented positional-array form. Index order
 * matters far more than the values here, so this mirrors a real response
 * exactly rather than using a simplified shape.
 */
const LUFTHANSA = [
  "3c6444", // icao24
  "DLH9LF  ", // callsign, space-padded as OpenSky sends it
  "Germany", // origin_country
  1458564120, // time_position
  1458564120, // last_contact
  6.1546, // longitude
  50.1964, // latitude
  9639.3, // baro_altitude
  false, // on_ground
  232.88, // velocity
  98.26, // true_track
  4.55, // vertical_rate
  null, // sensors
  9547.86, // geo_altitude
  "1000", // squawk
  false, // spi
  0, // position_source
];

function response(states: unknown[]) {
  return { time: 1458564121, states };
}

test("parseStates reads a well-formed state vector by index", () => {
  const snapshot = parseStates(response([LUFTHANSA]));
  assert.equal(snapshot.time, 1458564121);
  assert.equal(snapshot.aircraft.length, 1);

  const [ac] = snapshot.aircraft;
  assert.equal(ac.icao24, "3c6444");
  assert.equal(ac.originCountry, "Germany");
  assert.equal(ac.latitudeDeg, 50.1964);
  assert.equal(ac.longitudeDeg, 6.1546);
  assert.equal(ac.velocityMS, 232.88);
  assert.equal(ac.trueTrackDeg, 98.26);
  assert.equal(ac.verticalRateMS, 4.55);
  assert.equal(ac.onGround, false);
  assert.equal(ac.lastContact, 1458564120);
});

test("parseStates trims the space-padded callsign", () => {
  const [ac] = parseStates(response([LUFTHANSA])).aircraft;
  assert.equal(ac.callsign, "DLH9LF");
});

test("parseStates reports a blank callsign as null rather than empty string", () => {
  const blank = [...LUFTHANSA];
  blank[1] = "        ";
  const [ac] = parseStates(response([blank])).aircraft;
  assert.equal(ac.callsign, null);
});

test("parseStates prefers geometric altitude over barometric", () => {
  const [ac] = parseStates(response([LUFTHANSA])).aircraft;
  assert.equal(ac.altitudeM, 9547.86); // geo, not the 9639.3 baro figure
});

test("parseStates falls back to barometric altitude when geometric is missing", () => {
  const noGeo = [...LUFTHANSA];
  noGeo[13] = null;
  const [ac] = parseStates(response([noGeo])).aircraft;
  assert.equal(ac.altitudeM, 9639.3);
});

test("parseStates skips an aircraft with no position rather than discarding the snapshot", () => {
  const noPosition = [...LUFTHANSA];
  noPosition[5] = null; // longitude
  noPosition[6] = null; // latitude
  const snapshot = parseStates(response([noPosition, LUFTHANSA]));
  assert.equal(snapshot.aircraft.length, 1);
  assert.equal(snapshot.aircraft[0].icao24, "3c6444");
});

test("parseStates skips an aircraft with neither altitude reading", () => {
  const noAltitude = [...LUFTHANSA];
  noAltitude[7] = null;
  noAltitude[13] = null;
  assert.equal(parseStates(response([noAltitude])).aircraft.length, 0);
});

test("parseStates ignores a malformed non-array state", () => {
  const snapshot = parseStates(response(["not-an-array", LUFTHANSA]));
  assert.equal(snapshot.aircraft.length, 1);
});

test("parseStates treats a null states list as a quiet sky, not an error", () => {
  const snapshot = parseStates({ time: 1458564121, states: null });
  assert.deepEqual(snapshot.aircraft, []);
  assert.equal(snapshot.time, 1458564121);
});

test("parseStates rejects a response that does not match the contract", () => {
  assert.throws(() => parseStates(null), /not an object/);
  assert.throws(() => parseStates({}), /no numeric 'time'/);
  assert.throws(() => parseStates({ time: 1, states: "nope" }), /neither an array nor null/);
});

test("boundingBox brackets the observer symmetrically in latitude", () => {
  const box = boundingBox(0, 0, 111.32);
  assert.ok(Math.abs(box.lamax - 1) < 0.01, `got ${box.lamax}`);
  assert.ok(Math.abs(box.lamin + 1) < 0.01, `got ${box.lamin}`);
});

test("boundingBox widens in longitude at higher latitude to stay square on the ground", () => {
  const equator = boundingBox(0, 0, 150);
  const northern = boundingBox(60, 0, 150);
  const equatorSpan = equator.lomax - equator.lomin;
  const northernSpan = northern.lomax - northern.lomin;
  // cos(60 deg) = 0.5, so the longitude span should roughly double.
  assert.ok(northernSpan > equatorSpan * 1.9, `expected ~2x, got ${northernSpan / equatorSpan}x`);
});

test("boundingBox stays within valid coordinate ranges near the poles", () => {
  const box = boundingBox(89.9, 179.9, 500);
  assert.ok(box.lamax <= 90);
  assert.ok(box.lamin >= -90);
  assert.ok(box.lomax <= 180);
  assert.ok(box.lomin >= -180);
});
