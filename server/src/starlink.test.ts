import { strict as assert } from "node:assert";
import test from "node:test";
import {
  DEFAULT_TRAIN_CRITERIA,
  altitudeKmFromMeanMotion,
  angularDelta,
  elementsFromLine2,
  findTrains,
} from "./starlink";
import type { TleRecord } from "./celestrak";

/**
 * Synthetic elements, since a real Starlink catalogue is far too large to
 * check in and would go stale the moment it was. The point of these tests is
 * the clustering logic, which is entirely a function of the element values.
 */
function tle(
  name: string,
  {
    inclination = 53.05,
    raan = 120.5,
    meanAnomaly = 0,
    meanMotion = 15.9,
    satnum = "50000",
  }: Partial<{
    inclination: number;
    raan: number;
    meanAnomaly: number;
    meanMotion: number;
    satnum: string;
  }> = {}
): TleRecord {
  const pad = (value: number, width: number, decimals: number) =>
    value.toFixed(decimals).padStart(width, "0");

  // Columns must land exactly where a real TLE puts them.
  const line2 =
    `2 ${satnum.padStart(5, "0")} ` +
    `${pad(inclination, 8, 4)} ` +
    `${pad(raan, 8, 4)} ` +
    `0001000 ` +
    `${pad(90, 8, 4)} ` +
    `${pad(meanAnomaly, 8, 4)} ` +
    `${meanMotion.toFixed(8).padStart(11, "0")}00000`;

  return {
    name,
    satnum,
    line1: `1 ${satnum.padStart(5, "0")}U 24001A   26210.50000000  .00001000  00000-0  10000-3 0  9990`,
    line2,
  };
}

/** A batch strung out along one plane at a fixed spacing. */
function batch(
  prefix: string,
  count: number,
  spacingDeg: number,
  overrides: Parameters<typeof tle>[1] = {}
): TleRecord[] {
  return Array.from({ length: count }, (_, i) =>
    tle(`${prefix}-${i}`, {
      ...overrides,
      meanAnomaly: (((overrides.meanAnomaly ?? 0) + i * spacingDeg) % 360 + 360) % 360,
      satnum: String(50_000 + i + prefix.length * 1000),
    })
  );
}

test("element fields are read from the right TLE columns", () => {
  // A real ISS line 2, whose values are independently known.
  const line2 = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";
  const elements = elementsFromLine2(line2);
  assert.ok(Math.abs(elements.inclinationDeg - 51.6416) < 1e-4);
  assert.ok(Math.abs(elements.raanDeg - 247.4627) < 1e-4);
  assert.ok(Math.abs(elements.eccentricity - 0.0006703) < 1e-9);
  assert.ok(Math.abs(elements.argPerigeeDeg - 130.536) < 1e-4);
  assert.ok(Math.abs(elements.meanAnomalyDeg - 325.0288) < 1e-4);
  assert.ok(Math.abs(elements.meanMotionRevPerDay - 15.72125391) < 1e-6);
});

test("altitude follows from mean motion", () => {
  // Checked against Kepler's third law directly: 15.72 rev/day is a period of
  // 91.6 minutes, which is a semi-major axis of about 6731 km, so roughly
  // 353 km up. (The ISS today is nearer 15.5 rev/day and 420 km — this is the
  // altitude the mean motion implies, not a claim about any particular
  // spacecraft.)
  const fast = altitudeKmFromMeanMotion(15.72125391);
  assert.ok(Math.abs(fast - 353) < 5, `expected roughly 353 km, got ${fast}`);

  // A fresh Starlink insertion is lower still, and therefore faster.
  const fresh = altitudeKmFromMeanMotion(15.95);
  assert.ok(fresh < fast, "a faster orbit must be a lower one");
  assert.ok(fresh > 250 && fresh < 320, `insertion altitude looks wrong: ${fresh}`);

  // The operational shell sits well above the train cutoff, which is what
  // keeps raised batches out of the results.
  const operational = altitudeKmFromMeanMotion(15.06);
  assert.ok(operational > 500, `expected the ~550 km shell, got ${operational}`);
  assert.ok(operational > DEFAULT_TRAIN_CRITERIA.maxAltitudeKm);
});

test("angular differences wrap the circle", () => {
  assert.equal(angularDelta(10, 350), 20);
  assert.equal(angularDelta(350, 10), 20);
  assert.equal(angularDelta(0, 180), 180);
  assert.equal(angularDelta(5, 5), 0);
});

test("a freshly deployed batch is detected as one train", () => {
  const trains = findTrains(batch("BATCH", 22, 3));
  assert.equal(trains.length, 1);
  assert.equal(trains[0].count, 22);
  assert.ok(Math.abs(trains[0].spreadDeg - 21 * 3) < 1e-6);
  assert.ok(trains[0].meanAltitudeKm < DEFAULT_TRAIN_CRITERIA.maxAltitudeKm);
  // 63 degrees of a ~90 minute orbit is roughly a quarter of an hour.
  assert.ok(
    trains[0].passDurationSeconds > 900 && trains[0].passDurationSeconds < 1000,
    `unexpected duration ${trains[0].passDurationSeconds}`
  );
});

test("two launches into different planes are two trains", () => {
  const trains = findTrains([
    ...batch("A", 20, 3, { raan: 120.5 }),
    ...batch("B", 14, 3, { raan: 200.1 }),
  ]);
  assert.equal(trains.length, 2);
  // Sorted longest first, which is the one most worth going outside for.
  assert.equal(trains[0].count, 20);
  assert.equal(trains[1].count, 14);
});

test("a batch that has spread around its plane is not a train", () => {
  // Same plane, same altitude, but 20 degrees between neighbours: they no
  // longer cross the sky as a string.
  const trains = findTrains(batch("SPREAD", 18, 20));
  assert.equal(trains.length, 0);
});

test("a plane containing both a tight run and stragglers reports only the run", () => {
  const tight = batch("TIGHT", 15, 2, { meanAnomaly: 0 });
  // Well clear of the run, and too few to be a train on their own.
  const stragglers = batch("OLD", 4, 25, { meanAnomaly: 180 });
  const trains = findTrains([...tight, ...stragglers]);
  assert.equal(trains.length, 1);
  assert.equal(trains[0].count, 15);
});

test("a string straddling zero degrees stays one train", () => {
  // Mean anomalies running 340, 343, ... through 0 and on to 26.
  const trains = findTrains(batch("WRAP", 16, 3, { meanAnomaly: 340 }));
  assert.equal(trains.length, 1, "the 0/360 boundary must not split the string");
  assert.equal(trains[0].count, 16);
});

test("raised satellites are excluded, since they no longer fly as a train", () => {
  // 15.06 rev/day is the operational Starlink shell, well above the cutoff.
  const trains = findTrains(batch("RAISED", 25, 3, { meanMotion: 15.06 }));
  assert.equal(trains.length, 0);
});

test("a handful of satellites is not reported as a train", () => {
  assert.equal(findTrains(batch("FEW", DEFAULT_TRAIN_CRITERIA.minMembers - 1, 3)).length, 0);
  assert.equal(findTrains(batch("ENOUGH", DEFAULT_TRAIN_CRITERIA.minMembers, 3)).length, 1);
});

test("unrelated satellites at similar altitudes are not swept in", () => {
  // Same altitude band, but scattered across planes and inclinations, which
  // is what most of the low catalogue looks like.
  const clutter = Array.from({ length: 40 }, (_, i) =>
    tle(`DEBRIS-${i}`, {
      inclination: 40 + i * 2,
      raan: (i * 37) % 360,
      meanAnomaly: (i * 53) % 360,
      meanMotion: 15.7 + (i % 5) * 0.03,
      satnum: String(80_000 + i),
    })
  );
  assert.equal(findTrains(clutter).length, 0);
});

test("a train is still found inside a large noisy catalogue", () => {
  const clutter = Array.from({ length: 300 }, (_, i) =>
    tle(`OTHER-${i}`, {
      inclination: 30 + ((i * 7) % 60),
      raan: (i * 13.7) % 360,
      meanAnomaly: (i * 29) % 360,
      meanMotion: 14.5 + ((i % 20) * 0.08),
      satnum: String(70_000 + i),
    })
  );
  const trains = findTrains([...clutter, ...batch("NEW", 21, 2.5, { raan: 88.4 })]);
  assert.equal(trains.length, 1);
  assert.equal(trains[0].count, 21);
  assert.ok(Math.abs(trains[0].raanDeg - 88.4) < 0.01);
});

test("malformed elements are skipped rather than crashing the scan", () => {
  const broken: TleRecord = { name: "BROKEN", satnum: "00001", line1: "1 junk", line2: "2 junk" };
  const trains = findTrains([broken, ...batch("GOOD", 12, 3)]);
  assert.equal(trains.length, 1);
  assert.equal(trains[0].count, 12);
});

test("members come back in along-track order", () => {
  const trains = findTrains(batch("ORDER", 12, 4, { meanAnomaly: 350 }));
  assert.equal(trains.length, 1);
  const anomalies = trains[0].members.map((m) => elementsFromLine2(m.line2).meanAnomalyDeg);
  // Increasing, allowing the single wrap through 360.
  let wraps = 0;
  for (let i = 1; i < anomalies.length; i++) {
    if (anomalies[i] < anomalies[i - 1]) wraps++;
  }
  assert.ok(wraps <= 1, `order should wrap at most once, saw ${wraps} breaks`);
});
