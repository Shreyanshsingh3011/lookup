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
  assert.equal(best(-0.1), "meteosat-0", "London");
  assert.equal(best(139.7), "himawari", "Tokyo");
  assert.equal(best(151.2), "himawari", "Sydney");
  assert.equal(best(55.3), "meteosat-iodc", "Dubai");
  assert.equal(best(77.2), "meteosat-iodc", "Delhi");
});

test("a location near the date line is served by a Pacific satellite", () => {
  // Fiji sits between Himawari and GOES-West; both should be candidates and
  // the nearer one should lead.
  const options = satellitesFor(178);
  assert.ok(options.length >= 1, 'the Pacific should not be a blind spot');
  assert.equal(options[0].id, 'himawari');
});

test("candidates come back ordered by how squarely the satellite faces you", () => {
  // London is nearly under Meteosat-0 and well off to the side of the others.
  const options = satellitesFor(-0.1);
  assert.equal(options[0].id, "meteosat-0");
  for (let i = 1; i < options.length; i++) {
    assert.ok(
      longitudeSeparation(options[i - 1].longitudeDeg, -0.1) <=
        longitudeSeparation(options[i].longitudeDeg, -0.1),
      "ordering should be by separation"
    );
  }
});

test("somewhere with several satellites overhead offers a fallback", () => {
  // The Atlantic is seen by both GOES-East and Meteosat, which is what lets
  // the probe fall through when one host is down.
  const options = satellitesFor(-40);
  assert.ok(options.length >= 2, `expected a fallback over the Atlantic, got ${options.length}`);
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

test("the belt has no large gap in coverage", () => {
  // Every longitude should be seen by something, or the feature would silently
  // be unavailable for whole regions.
  const uncovered: number[] = [];
  for (let lon = -180; lon < 180; lon += 5) {
    if (satellitesFor(lon).length === 0) uncovered.push(lon);
  }
  assert.deepEqual(uncovered, [], `no satellite covers longitudes ${uncovered.join(", ")}`);
});
