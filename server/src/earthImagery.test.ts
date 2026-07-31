import { strict as assert } from "node:assert";
import test from "node:test";
import {
  GEOSTATIONARY_SATELLITES,
  longitudeSeparation,
  satellitesFor,
} from "./earthImagery.js";

test("longitude separation wraps the globe the short way", () => {
  assert.equal(longitudeSeparation(0, 10), 10);
  assert.equal(longitudeSeparation(-175, 175), 10, "should cross the date line, not go the long way");
  assert.equal(longitudeSeparation(175, -175), 10);
  assert.equal(longitudeSeparation(-75, 105), 180);
  assert.equal(longitudeSeparation(45, 45), 0);
});

test("each region gets the satellite that is actually looking at it", () => {
  const best = (lon: number) => satellitesFor(lon)[0]?.id ?? null;

  assert.equal(best(-74), "goes-east", "New York");
  assert.equal(best(-122), "goes-west", "San Francisco");
  assert.equal(best(-43), "goes-east", "Rio de Janeiro");
  assert.equal(best(-157), "goes-west", "Honolulu");
  // London sits far out on the GOES-East limb, but the disk does include it.
  assert.equal(best(-0.1), "goes-east", "London");
});

test("longitudes with no source say so rather than picking a satellite that cannot see them", () => {
  // Only the GOES pair is available, so Asia genuinely has no source. This is
  // reported honestly instead of handing back a disk the observer is not on.
  assert.deepEqual(satellitesFor(139.7), [], "Tokyo");
  assert.deepEqual(satellitesFor(77.2), [], "Delhi");
  assert.deepEqual(satellitesFor(31.2), [], "Cairo");
});

test("candidates come back ordered by how squarely the satellite faces you", () => {
  const options = satellitesFor(-100);
  assert.ok(options.length >= 2, "the Americas should have a fallback");
  for (let i = 1; i < options.length; i++) {
    assert.ok(
      longitudeSeparation(options[i - 1].longitudeDeg, -100) <=
        longitudeSeparation(options[i].longitudeDeg, -100),
      "ordering should be by separation"
    );
  }
});

test("somewhere with several satellites overhead offers a fallback", () => {
  // The eastern Pacific is seen by both GOES spacecraft, which is what lets
  // the probe fall through when one host is down.
  const options = satellitesFor(-110);
  assert.ok(options.length >= 2, `expected a fallback, got ${options.length}`);
});

test("the satellite table is coherent", () => {
  const ids = new Set<string>();
  for (const s of GEOSTATIONARY_SATELLITES) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.longitudeDeg >= -180 && s.longitudeDeg <= 180, `${s.id} longitude`);
    assert.ok(s.candidates.length > 0, `${s.id} needs at least one candidate URL`);
    for (const url of s.candidates) {
      assert.match(url, /^https:\/\//, `${s.id} candidate must be https`);
    }
    assert.ok(s.name.length > 0 && s.operator.length > 0);
  }
});

test("coverage is exactly the half of the globe the GOES pair can see", () => {
  // Not a complaint about the gap — a record of it. Only the GOES satellites
  // have a verified public full-disk URL, so eastern Africa through the
  // western Pacific has no source, and the endpoint says so rather than
  // pretending otherwise.
  const covered: number[] = [];
  const uncovered: number[] = [];
  for (let lon = -180; lon < 180; lon += 5) {
    (satellitesFor(lon).length > 0 ? covered : uncovered).push(lon);
  }
  assert.ok(covered.length > 0 && uncovered.length > 0);
  // The Americas are covered; Asia is not.
  assert.ok(satellitesFor(-90).length > 0, "the Americas must be covered");
  assert.ok(satellitesFor(100).length === 0, "Asia has no verified source yet");
});
