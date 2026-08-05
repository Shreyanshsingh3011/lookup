import assert from "node:assert/strict";
import { test } from "node:test";
import { TLE_GROUPS, type TleRecord } from "./celestrak.js";
import {
  canEverRise,
  classify,
  DEBRIS_CLOUDS,
  filterByReach,
  footprintRadiusDeg,
  geometryFromTle,
  groundTrackLimitDeg,
  MIN_USEFUL_PERIGEE_KM,
  NOTABLE_DERELICTS,
  partitionByType,
  statusFromError,
} from "./debris.js";

function checksum(line: string): string {
  let sum = 0;
  for (const c of line.slice(0, 68)) {
    if (c >= "0" && c <= "9") sum += Number(c);
    else if (c === "-") sum += 1;
  }
  return line.slice(0, 68) + (sum % 10);
}

function makeTle(name: string, inclination: number, meanMotion = 15.0, eccentricity = 0.0001): TleRecord {
  const ecc = String(Math.round(eccentricity * 1e7)).padStart(7, "0");
  return {
    name,
    satnum: "99999",
    line1: checksum("1 99999U 98067A   26212.50000000  .00000000  00000-0  00000-0 0  999"),
    line2: checksum(
      `2 99999 ${inclination.toFixed(4).padStart(8)} 100.0000 ${ecc} 100.0000 260.0000 ${meanMotion
        .toFixed(8)
        .padStart(11)}    0`
    ),
  };
}

test("an explicit OBJECT_TYPE outranks the naming convention", () => {
  // The field is a fact; the name is a convention. Where both are present the
  // field wins, and the source is reported so the interface knows which it got.
  assert.deepEqual(classify("SOMETHING VAGUE", "DEB"), { type: "DEBRIS", source: "field" });
  assert.deepEqual(classify("COSMOS 2251 DEB", "PAY"), { type: "PAYLOAD", source: "field" });

  // Both spellings occur across CelesTrak's SATCAT and Space-Track.
  for (const [raw, expected] of [
    ["PAY", "PAYLOAD"],
    ["PAYLOAD", "PAYLOAD"],
    ["R/B", "ROCKET BODY"],
    ["ROCKET BODY", "ROCKET BODY"],
    ["DEB", "DEBRIS"],
    ["UNK", "UNKNOWN"],
    ["  deb  ", "DEBRIS"],
  ] as const) {
    assert.equal(classify("X", raw).type, expected, `${raw} should read as ${expected}`);
  }
});

test("the naming convention is used only when there is no field", () => {
  assert.deepEqual(classify("FENGYUN 1C DEB"), { type: "DEBRIS", source: "name" });
  assert.deepEqual(classify("SL-16 R/B"), { type: "ROCKET BODY", source: "name" });
  assert.deepEqual(classify("ISS (ZARYA)"), { type: "PAYLOAD", source: "name" });
  assert.deepEqual(classify("TBA - TO BE ASSIGNED"), { type: "UNKNOWN", source: "name" });

  // An unrecognised OBJECT_TYPE falls through to the name rather than being
  // trusted — a typo upstream must not silently reclassify an object.
  assert.deepEqual(classify("FENGYUN 1C DEB", "SOMETHING ELSE"), { type: "DEBRIS", source: "name" });
  assert.deepEqual(classify("FENGYUN 1C DEB", ""), { type: "DEBRIS", source: "name" });
  assert.deepEqual(classify("FENGYUN 1C DEB", null), { type: "DEBRIS", source: "name" });
});

test("an inferred payload is reported as inferred", () => {
  // The convention is reliable one way only: a name ending DEB is definitely
  // debris, but a name without one is only probably a payload — plenty of
  // debris predates the convention. The source lets the interface decline to
  // make a claim it cannot support.
  const guessed = classify("COSMOS 249");
  assert.equal(guessed.type, "PAYLOAD");
  assert.equal(guessed.source, "name", "must not be presented as a catalogued fact");
});

test("a mixed catalogue is split into separate lists, not annotated in place", () => {
  // Returned as distinct arrays so a caller cannot forget the filter and run a
  // pass search over everything.
  const parts = partitionByType([
    makeTle("FENGYUN 1C DEB", 98.6),
    makeTle("FENGYUN 1C DEB", 98.6),
    makeTle("SL-16 R/B", 71),
    makeTle("ISS (ZARYA)", 51.6),
  ]);
  assert.equal(parts.DEBRIS.length, 2);
  assert.equal(parts["ROCKET BODY"].length, 1);
  assert.equal(parts.PAYLOAD.length, 1);
  assert.equal(parts.UNKNOWN.length, 0);

  // An explicit type map overrides the names.
  const overridden = partitionByType([makeTle("FENGYUN 1C DEB", 98.6)], new Map([["99999", "PAY"]]));
  assert.equal(overridden.PAYLOAD.length, 1);
  assert.equal(overridden.DEBRIS.length, 0);
});

test("every named cloud is actually fetchable", () => {
  // A cloud whose CelesTrak group is not wired into the fetch layer would
  // render as a button that produces an empty panel with no explanation.
  for (const cloud of DEBRIS_CLOUDS) {
    assert.equal(
      TLE_GROUPS[cloud.celestrakGroup],
      cloud.celestrakGroup,
      `${cloud.label} names a group the fetcher does not know`
    );
    assert.match(cloud.id, /^[a-z0-9-]+$/, `${cloud.id} is not URL-safe, and ids go in permalinks`);
    assert.ok(cloud.peakCatalogued > 0 && cloud.event.length > 0, `${cloud.label} is under-described`);
    assert.ok(!Number.isNaN(Date.parse(cloud.eventDate)), `${cloud.label} has an unparseable date`);
    const [low, high] = cloud.altitudeBandKm;
    assert.ok(low > 0 && high > low, `${cloud.label} has a nonsense altitude band`);
  }
  // The two collections must not collide: a cloud id is not a catalogue number.
  const derelictIds = new Set(NOTABLE_DERELICTS.map((d) => d.satnum));
  for (const cloud of DEBRIS_CLOUDS) assert.ok(!derelictIds.has(cloud.id));
});

test("the notable derelicts are well-formed catalogue references", () => {
  const seen = new Set<string>();
  for (const derelict of NOTABLE_DERELICTS) {
    assert.match(derelict.satnum, /^\d{1,9}$/, `${derelict.label} has a non-numeric catalogue number`);
    assert.ok(!seen.has(derelict.satnum), `${derelict.satnum} is listed twice`);
    seen.add(derelict.satnum);
    assert.ok(derelict.note.length > 20, `${derelict.label} needs a reason to be on the list`);
    assert.ok(["rocket-body", "payload"].includes(derelict.kind));
  }
});

test("a vanished catalogue number is a normal outcome, not a failure", () => {
  // Debris and low rocket bodies are struck from the catalogue constantly. The
  // distinction that matters is between "gone" and "could not ask" — telling
  // somebody their bookmarked object has reentered when a proxy was down would
  // be a lie the app can easily avoid.
  assert.equal(statusFromError("No satellite found for NORAD ID 12345"), "not-in-catalogue");
  assert.equal(statusFromError("Celestrak fetch failed for NORAD ID 12345: 404"), "not-in-catalogue");
  assert.equal(statusFromError("Not Found"), "not-in-catalogue");

  assert.equal(statusFromError("fetch failed: ETIMEDOUT"), "unavailable");
  assert.equal(statusFromError("Celestrak fetch failed for NORAD ID 12345: 503"), "unavailable");
  assert.equal(statusFromError("socket hang up"), "unavailable");
});

test("the ground-track limit folds past ninety degrees", () => {
  assert.equal(groundTrackLimitDeg(51.6), 51.6);
  assert.equal(groundTrackLimitDeg(90), 90);
  assert.ok(Math.abs(groundTrackLimitDeg(98.6) - 81.4) < 1e-9);
  assert.ok(Math.abs(groundTrackLimitDeg(160) - 20) < 1e-9);
  assert.equal(groundTrackLimitDeg(180), 0);
});

test("the footprint grows with altitude", () => {
  assert.ok(footprintRadiusDeg(400) > 19 && footprintRadiusDeg(400) < 21);
  assert.ok(footprintRadiusDeg(1400) > footprintRadiusDeg(400));
  assert.equal(footprintRadiusDeg(0), 0);
  assert.equal(footprintRadiusDeg(-5), 0);
});

test("geometry is read off the element lines, and refused when it cannot be", () => {
  const geometry = geometryFromTle(makeTle("X", 51.6, 15.5))!;
  assert.ok(Math.abs(geometry.inclinationDeg - 51.6) < 0.001);
  assert.ok(geometry.perigeeAltitudeKm > 380 && geometry.perigeeAltitudeKm < 460);
  assert.ok(geometry.apogeeAltitudeKm >= geometry.perigeeAltitudeKm);

  assert.equal(geometryFromTle({ name: "x", satnum: "1", line1: "junk", line2: "junk" }), null);
});

test("the reach filter removes what can never rise, and keeps what can", () => {
  // A 20 degree orbit never reaches London; a polar one reaches everywhere.
  assert.equal(canEverRise(makeTle("EQUATORIAL DEB", 5, 15.0), 51.5), false);
  assert.equal(canEverRise(makeTle("POLAR DEB", 90, 15.0), 51.5), true);
  // ...and the same equatorial object is fine from the tropics.
  assert.equal(canEverRise(makeTle("EQUATORIAL DEB", 5, 15.0), 1.35), true);

  // Elements too low to be worth propagating are dropped.
  assert.equal(canEverRise(makeTle("DECAYING DEB", 51.6, 16.6), 51.5), false);
  // As are unreadable ones, rather than throwing.
  assert.equal(canEverRise({ name: "x", satnum: "1", line1: "junk", line2: "junk" }, 51.5), false);
});

test("the reach filter accounts for everything it was given", () => {
  const catalogue = [
    makeTle("KEEP", 90, 15.0),
    makeTle("DROP", 5, 15.0),
    { name: "JUNK", satnum: "1", line1: "x", line2: "y" },
  ];
  const result = filterByReach(catalogue, 51.5);
  assert.equal(result.candidates.length + result.skipped, catalogue.length);
  assert.deepEqual(result.candidates.map((t) => t.name), ["KEEP"]);
  assert.equal(MIN_USEFUL_PERIGEE_KM > 0, true);
});

test("no derelict claims a catalogue number belonging to something else", () => {
  // Checked against what the live catalogue actually returned for each id.
  // 22195 was originally listed as Cosmos 2251 and is in fact LAGEOS 2 —
  // Cosmos 2251 is 22675, and it stopped being an intact object in 2009 when
  // it was destroyed, so it could never have belonged in a list of derelicts
  // you can go and look at. Production was the only place that error was
  // visible, because it needs the real catalogue to resolve the number.
  const knownNames: Record<string, RegExp> = {
    "00694": /ATLAS CENTAUR/i,
    "02802": /SL-8/i,
    "16182": /SL-16/i,
    "23705": /SL-16/i,
    "10967": /SEASAT/i,
    "00900": /CALSPHERE/i,
    "20580": /HST|HUBBLE/i,
    "22195": /LAGEOS/i,
  };

  for (const derelict of NOTABLE_DERELICTS) {
    const expected = knownNames[derelict.satnum];
    assert.ok(expected, `${derelict.satnum} has no verified catalogue name — check it against the live catalogue`);
    assert.ok(
      expected.test(derelict.label),
      `${derelict.satnum} is labelled "${derelict.label}" but the catalogue calls it something matching ${expected}`
    );
  }

  // The destroyed parent of the 2009 collision must not be listed as an intact
  // object, whatever its number.
  assert.ok(!NOTABLE_DERELICTS.some((d) => /cosmos 2251/i.test(d.label)));
});

/**
 * The peak count is history, and every cloud has shrunk since.
 *
 * Measured against the live catalogue on 2026-08-05, via production:
 *
 *   Fengyun-1C    3400 -> 1932
 *   Cosmos 2251   1700 ->  594
 *   Iridium 33     630 ->  111
 *   Cosmos 1408   1500 ->    3
 *
 * The app previously showed the left-hand column as though it were the right,
 * which overstated the population by 2.7x overall and by five hundred fold for
 * Cosmos 1408 — a 2021 test into orbits low enough that drag has taken almost
 * all of it back already. This test exists so the field's meaning cannot drift
 * back to being read as current: a peak below an observed live count would
 * mean the two have been confused again.
 */
test("peak fragment counts are consistent with the live populations observed in production", () => {
  const observed: Record<string, number> = {
    "fengyun-1c": 1932,
    "cosmos-2251": 594,
    "iridium-33": 111,
    "cosmos-1408": 3,
  };

  for (const cloud of DEBRIS_CLOUDS) {
    const live = observed[cloud.id];
    assert.ok(live !== undefined, `${cloud.id} has no observed live count recorded`);
    assert.ok(
      cloud.peakCatalogued >= live,
      `${cloud.label}: peak ${cloud.peakCatalogued} is below the observed live count ${live}, ` +
        `which means the field is being used as a current population again`
    );
  }
});

test("a cloud's altitude band is consistent with how much of it survives", () => {
  // Not a coincidence worth leaving unstated: the cloud that has almost
  // entirely gone is the one whose band starts lowest and ends lowest.
  const cosmos1408 = DEBRIS_CLOUDS.find((c) => c.id === "cosmos-1408");
  const fengyun = DEBRIS_CLOUDS.find((c) => c.id === "fengyun-1c");
  assert.ok(cosmos1408 && fengyun);

  assert.ok(
    cosmos1408.altitudeBandKm[1] < fengyun.altitudeBandKm[1],
    "Cosmos 1408 should reach lower than Fengyun-1C, which is why so little of it is left"
  );
});
