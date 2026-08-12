import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as satellite from "satellite.js";
import { parseTle, type TleRecord } from "./celestrak.js";
import {
  airMass,
  computePassesForMany,
  DEFAULT_PASS_OPTIONS,
  extinctionMagnitudes,
  MAX_SCANNED_SATELLITES,
  rankForVisibility,
  standardMagnitude,
} from "./passes.js";
import type { Observer } from "./types.js";

/**
 * The bundled element set is from early 2024, so SGP4 refuses to propagate it
 * anywhere near the present and every scan comes back empty — which would make
 * these tests pass by finding nothing. Rewriting the epoch to now gives real
 * orbits to scan without needing the network.
 */
function checksum(line: string): string {
  let sum = 0;
  for (const c of line.slice(0, 68)) {
    if (c >= "0" && c <= "9") sum += Number(c);
    else if (c === "-") sum += 1;
  }
  return line.slice(0, 68) + (sum % 10);
}

function reEpoch(line1: string, when: Date): string {
  const year = String(when.getUTCFullYear() % 100).padStart(2, "0");
  const dayOfYear =
    (when.getTime() - Date.UTC(when.getUTCFullYear(), 0, 1)) / 86_400_000 + 1;
  return checksum(line1.slice(0, 18) + year + dayOfYear.toFixed(8).padStart(12, "0") + line1.slice(32));
}

function currentCatalogue(): TleRecord[] {
  const now = new Date();
  return parseTle(readFileSync(new URL("../elements.txt", import.meta.url), "utf8"))
    .map((t) => ({ ...t, line1: reEpoch(t.line1, now) }))
    .filter((t) => {
      const rec = satellite.twoline2satrec(t.line1, t.line2);
      return !rec.error && Boolean(satellite.propagate(rec, now));
    });
}

const CATALOGUE = currentCatalogue();

// Both scans must start from the same instant, or every sample lands on a
// different grid and the comparison measures the clock rather than the code.
const NOW = new Date();

// Somewhere with real nights and plenty of overhead traffic.
const OBSERVER: Observer = { latitude: 1.35, longitude: 103.8, elevation: 0 };

test("the element fixture still gives something to scan", () => {
  assert.ok(CATALOGUE.length > 5, `only ${CATALOGUE.length} objects propagate`);
});

test("the coarse pre-scan finds exactly the same passes as scanning everything", () => {
  // This is the only thing that makes the optimisation legitimate. The cheap
  // above-horizon scan exists to skip the ninety percent of the night the
  // satellite spends underground; if it skipped even one real pass, the app
  // would silently under-report and look merely "quiet" rather than broken.
  const days = 3;
  const exhaustive = computePassesForMany(CATALOGUE, OBSERVER, { days, horizonScanSeconds: 0, now: NOW });
  const staged = computePassesForMany(CATALOGUE, OBSERVER, { days, now: NOW });

  assert.ok(exhaustive.passes.length > 0, "the exhaustive scan must find passes to compare against");
  assert.equal(
    staged.passes.length,
    exhaustive.passes.length,
    `staged found ${staged.passes.length}, exhaustive found ${exhaustive.passes.length}`
  );
  assert.deepEqual(staged.passes, exhaustive.passes, "every field of every pass must match");
  assert.equal(staged.tooFaintCount, exhaustive.tooFaintCount);
  assert.equal(staged.brightestRejectedMagnitude, exhaustive.brightestRejectedMagnitude);
});

test("the pre-scan is what makes the search affordable", () => {
  // The endpoint runs against a ~170-object catalogue inside a 30 second
  // function limit, so the margin here is the difference between working and
  // an intermittent timeout on a slower production CPU.
  const days = 3;
  const start = process.hrtime.bigint();
  computePassesForMany(CATALOGUE, OBSERVER, { days, now: NOW });
  const stagedMs = Number(process.hrtime.bigint() - start) / 1e6;

  const exhaustiveStart = process.hrtime.bigint();
  computePassesForMany(CATALOGUE, OBSERVER, { days, horizonScanSeconds: 0, now: NOW });
  const exhaustiveMs = Number(process.hrtime.bigint() - exhaustiveStart) / 1e6;

  assert.ok(
    stagedMs * 2 < exhaustiveMs,
    `staged ${stagedMs.toFixed(0)}ms vs exhaustive ${exhaustiveMs.toFixed(0)}ms — expected at least a 2x saving`
  );
});

test("passes come back in time order and internally consistent", () => {
  const { passes } = computePassesForMany(CATALOGUE, OBSERVER, { days: 3, now: NOW });
  assert.ok(passes.length > 0);

  for (let i = 1; i < passes.length; i++) {
    assert.ok(
      new Date(passes[i].start.time) >= new Date(passes[i - 1].start.time),
      "passes must be sorted by start time"
    );
  }

  for (const pass of passes) {
    assert.ok(new Date(pass.end.time) >= new Date(pass.start.time), `${pass.name} ends before it starts`);
    assert.ok(
      pass.max.altitudeDeg >= DEFAULT_PASS_OPTIONS.minElevationDeg,
      `${pass.name} peaked at ${pass.max.altitudeDeg}°, below the reporting cutoff`
    );
    assert.ok(
      pass.max.altitudeDeg >= pass.start.altitudeDeg && pass.max.altitudeDeg >= pass.end.altitudeDeg,
      `${pass.name} peaks lower than it starts or ends`
    );
    assert.ok(
      pass.magnitude <= DEFAULT_PASS_OPTIONS.maxMagnitude,
      `${pass.name} at magnitude ${pass.magnitude} is fainter than the cutoff`
    );
    assert.ok(pass.durationSeconds > 0, `${pass.name} has no duration`);
    assert.ok(["set", "shadow", "daylight"].includes(pass.endReason));
  }
});

test("the far north is handled in both its extremes", () => {
  // Svalbard is the hard case at either end of the year: under the midnight sun
  // there is no dark window at all, and in polar night the whole search range
  // is one continuous dark window rather than a string of nights. Both used to
  // be reached only in production.
  const svalbard: Observer = { latitude: 78.22, longitude: 15.63, elevation: 0 };
  const year = NOW.getUTCFullYear();

  for (const [season, now] of [
    ["midnight sun", new Date(Date.UTC(year + 1, 5, 21))],
    ["polar night", new Date(Date.UTC(year + 1, 11, 21))],
  ] as const) {
    const result = computePassesForMany(CATALOGUE, svalbard, { days: 3, now });
    assert.ok(Array.isArray(result.passes), `${season} must return a list`);
    for (const pass of result.passes) {
      assert.ok(Number.isFinite(pass.max.altitudeDeg), `${season}: non-finite elevation`);
      assert.ok(Number.isFinite(pass.magnitude), `${season}: non-finite magnitude`);
      assert.ok(pass.durationSeconds > 0, `${season}: zero-length pass`);
    }
  }
});

test("the scan cap keeps the bright objects and drops the hopeless ones", () => {
  // Selecting Starlink means asking about thousands of satellites. The cap has
  // to be a ranking, not a truncation: chopping the list arbitrarily would drop
  // the ISS because its catalogue number happened to sort late.
  const filler: TleRecord[] = Array.from({ length: MAX_SCANNED_SATELLITES + 500 }, (_, i) => ({
    name: `COSMOS 1234 DEB ${i}`,
    satnum: String(90_000 + i),
    line1: CATALOGUE[0].line1,
    line2: CATALOGUE[0].line2,
  }));
  const station: TleRecord = { ...CATALOGUE[0], name: "ISS (ZARYA)", satnum: "25544" };
  // Deliberately last, where a plain slice would lose it.
  const oversized = [...filler, station];

  const { scanned, skipped } = rankForVisibility(oversized);
  assert.equal(scanned.length, MAX_SCANNED_SATELLITES);
  assert.equal(skipped, oversized.length - MAX_SCANNED_SATELLITES);
  assert.ok(
    scanned.some((t) => t.satnum === "25544"),
    "the brightest object in the catalogue must survive the cap"
  );

  // Under the cap nothing is touched at all.
  const small = rankForVisibility([station, ...filler.slice(0, 10)]);
  assert.equal(small.skipped, 0);
  assert.deepEqual(small.scanned.map((t) => t.satnum), [station, ...filler.slice(0, 10)].map((t) => t.satnum));
});

test("the brightness ranking knows a station from a fragment", () => {
  // The cap is only defensible if the ordering it uses is meaningful.
  assert.ok(standardMagnitude("ISS (ZARYA)") < standardMagnitude("STARLINK-1234"));
  assert.ok(standardMagnitude("SL-16 R/B") < standardMagnitude("COSMOS 1234 DEB"));
  assert.ok(standardMagnitude("CZ-6A DEB") > standardMagnitude("HST"));
});

// ---------------------------------------------------------------------------
// Atmospheric extinction
// ---------------------------------------------------------------------------

/**
 * The atmosphere was not in the brightness model at all, and its absence had a
 * direction: passes spend most of their time low in the sky, low elevations are
 * where phase angles happen to be most favourable, and nothing offset that. So
 * the app reported the brightest moment of a pass at the point where the
 * atmosphere was dimming the object most.
 */
test("air mass is one overhead and grows toward the horizon", () => {
  assert.ok(Math.abs(airMass(90) - 1) < 0.01, `zenith should be 1 air mass, got ${airMass(90)}`);
  // Published Kasten-Young values, to a per cent.
  assert.ok(Math.abs(airMass(30) - 2.0) < 0.05, `30 deg should be about 2, got ${airMass(30)}`);
  assert.ok(Math.abs(airMass(10) - 5.6) < 0.1, `10 deg should be about 5.6, got ${airMass(10)}`);
  assert.ok(Math.abs(airMass(5) - 10.3) < 0.2, `5 deg should be about 10.3, got ${airMass(5)}`);
  assert.ok(airMass(0) > 30 && airMass(0) < 45, `horizon should be tens of air masses, got ${airMass(0)}`);
});

test("air mass never diverges or goes negative, even below the horizon", () => {
  // The naive 1/sin(elevation) is what this replaces; it goes infinite at zero
  // and negative below it, either of which corrupts a magnitude.
  for (const el of [-10, -1, 0, 0.5, 1, 45, 89.9, 90]) {
    const x = airMass(el);
    assert.ok(Number.isFinite(x) && x > 0, `air mass at ${el} deg should be finite and positive, got ${x}`);
  }
});

test("extinction dims low passes far more than overhead ones", () => {
  const overhead = extinctionMagnitudes(90);
  const low = extinctionMagnitudes(10);
  assert.ok(Math.abs(overhead - 0.25) < 0.01, `overhead should be about 0.25 mag, got ${overhead}`);
  assert.ok(low > 1.3 && low < 1.5, `10 degrees should be about 1.4 mag, got ${low}`);
  assert.ok(
    low - overhead > 1,
    "the difference between a low pass and an overhead one is more than a magnitude, " +
      "which is the whole reason this cannot be folded into the standard magnitudes"
  );
});

test("extinction increases monotonically as an object sinks", () => {
  let previous = 0;
  for (const el of [90, 60, 45, 30, 20, 15, 10, 7, 5, 3, 1]) {
    const e = extinctionMagnitudes(el);
    assert.ok(e > previous, `extinction should grow as elevation falls; ${el} deg gave ${e}`);
    previous = e;
  }
});

/**
 * The peak of a pass used to be whichever fine-grid sample happened to sit
 * nearest it, and the elevation that cost was small — 0.035 degrees on average
 * over 180 real passes from the current bright catalogue, 1.4 at worst. The
 * direction was not small. Azimuth sweeps fastest exactly where elevation
 * peaks, so the reported peak azimuth ran up to 65 degrees out, and 20 of those
 * 180 passes named the wrong compass point; 15 of them below 80 degrees
 * elevation, where a direction is still something an observer can act on. One
 * pass peaking at 78 degrees was reported as peaking due west when it peaked
 * west-southwest.
 */
function peakByFineScan(
  tle: TleRecord,
  observer: Observer,
  startIso: string,
  endIso: string
): { elevationDeg: number; azimuthDeg: number } {
  const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  const gd: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(observer.longitude),
    latitude: satellite.degreesToRadians(observer.latitude),
    height: observer.elevation / 1000,
  };
  let elevationDeg = -Infinity;
  let azimuthDeg = 0;
  for (let ms = Date.parse(startIso); ms <= Date.parse(endIso); ms += 200) {
    const at = new Date(ms);
    const pv = satellite.propagate(satrec, at);
    if (!pv || !pv.position) continue;
    const look = satellite.ecfToLookAngles(gd, satellite.eciToEcf(pv.position, satellite.gstime(at)));
    const el = satellite.radiansToDegrees(look.elevation);
    if (el > elevationDeg) {
      elevationDeg = el;
      azimuthDeg = satellite.radiansToDegrees(look.azimuth);
    }
  }
  return { elevationDeg, azimuthDeg };
}

test("the reported peak of a pass is where the pass actually peaks", () => {
  const { passes } = computePassesForMany(CATALOGUE, OBSERVER, { days: 4, now: NOW, maxMagnitude: 99 });
  assert.ok(passes.length > 0, "need passes to check");

  let checked = 0;
  for (const pass of passes) {
    const tle = CATALOGUE.find((t) => t.satnum === pass.satnum);
    if (!tle) continue;
    checked++;
    const truth = peakByFineScan(tle, OBSERVER, pass.start.time, pass.end.time);

    // altitudeDeg is rounded to a tenth for display, so that is the tolerance.
    assert.ok(
      truth.elevationDeg - pass.max.altitudeDeg < 0.06,
      `${tle.name} peak reported as ${pass.max.altitudeDeg}° when the pass reaches ${truth.elevationDeg.toFixed(3)}°`
    );

    // Azimuth is ill-conditioned within a few degrees of the zenith — at the
    // zenith it has no value at all — so only check it where it means something.
    if (pass.max.altitudeDeg < 85) {
      let off = Math.abs(pass.max.azimuthDeg - truth.azimuthDeg) % 360;
      if (off > 180) off = 360 - off;
      assert.ok(
        off < 3,
        `${tle.name} peaking at ${pass.max.altitudeDeg}° reported peak azimuth ${pass.max.azimuthDeg}° against a true ${truth.azimuthDeg.toFixed(1)}°`
      );
    }
  }
  assert.ok(checked > 0, "no pass could be matched back to its element set");
});

test("a refined peak never falls outside the visible stretch of its pass", () => {
  // The refinement searches either side of the best sample, and a pass can end
  // in Earth's shadow well before the geometry peaks. Reaching past the last
  // visible sample would report a peak the observer never saw lit.
  const { passes } = computePassesForMany(CATALOGUE, OBSERVER, { days: 4, now: NOW, maxMagnitude: 99 });
  for (const pass of passes) {
    const start = Date.parse(pass.start.time);
    const max = Date.parse(pass.max.time);
    const end = Date.parse(pass.end.time);
    assert.ok(max >= start && max <= end, `peak at ${pass.max.time} is outside ${pass.start.time}..${pass.end.time}`);
  }
});

/**
 * The boundaries were the last thing read straight off the fine grid. Measured
 * over 19 real passes against the same scan run twenty times finer, the start
 * came out up to 9 s late (4.4 s on average), the end up to 9.5 s early, and one
 * pass's duration was 16 s short. The elevation reported at the boundary was
 * wrong to match: passes that end by setting were ending at up to 0.6 degrees
 * instead of at the horizon.
 */
test("a pass's start and end agree with a twenty-times-finer scan", () => {
  const base = { days: 3, now: NOW, maxMagnitude: 99 } as const;
  const shipped = computePassesForMany(CATALOGUE, OBSERVER, base).passes;
  const finer = computePassesForMany(CATALOGUE, OBSERVER, { ...base, fineStepSeconds: 0.5 }).passes;
  assert.ok(shipped.length > 0, "need passes to compare");

  let compared = 0;
  for (const pass of shipped) {
    // Both grids pin the peak to the same instant, so it identifies the pass.
    const twin = finer
      .filter((p) => p.satnum === pass.satnum)
      .find((p) => Math.abs(Date.parse(p.max.time) - Date.parse(pass.max.time)) < 60_000);
    if (!twin) continue;
    compared++;

    const startGap = Math.abs(Date.parse(pass.start.time) - Date.parse(twin.start.time)) / 1000;
    const endGap = Math.abs(Date.parse(pass.end.time) - Date.parse(twin.end.time)) / 1000;
    assert.ok(startGap < 1, `${pass.name} starts ${startGap.toFixed(2)} s from where the finer scan says`);
    assert.ok(endGap < 1, `${pass.name} ends ${endGap.toFixed(2)} s from where the finer scan says`);
    assert.ok(
      Math.abs(pass.durationSeconds - twin.durationSeconds) <= 1,
      `${pass.name} lasts ${pass.durationSeconds}s against the finer scan's ${twin.durationSeconds}s`
    );
  }
  assert.ok(compared > 0, "no pass could be matched between the two grids");
});

test("a pass that ends by setting ends at the horizon", () => {
  const { passes } = computePassesForMany(CATALOGUE, OBSERVER, { days: 10, now: NOW, maxMagnitude: 99 });
  const setting = passes.filter((p) => p.endReason === "set");
  assert.ok(setting.length > 0, "some passes should end by setting");
  for (const pass of setting) {
    // Rounded to a tenth for display, so the horizon is 0.0 or 0.1 at worst.
    assert.ok(
      pass.end.altitudeDeg <= 0.1,
      `${pass.name} is said to set at ${pass.end.altitudeDeg}° rather than at the horizon`
    );
  }

  // The reason this assertion has teeth: "set" used to cover two different
  // things, a satellite dropping below the horizon and the search simply
  // running out of window mid-pass. The detail panel rendered both as "sets
  // below horizon". Rare — one pass in 155 over ten days from Singapore, still
  // 26.7 degrees up and sunlit — but false, and eccentric orbits keep producing
  // it because they can stay above the horizon longer than a scanned stretch.
  // Truncated passes say so now, and by construction end above the horizon.
  for (const pass of passes.filter((p) => p.endReason === "window")) {
    assert.ok(
      pass.end.altitudeDeg > 0,
      `${pass.name} is reported as cut off by the window but is already at ${pass.end.altitudeDeg}°`
    );
  }
});

test("boundary times are located, not snapped to the sampling grid", () => {
  // The visible symptom of reading boundaries off the grid: every start and end
  // separated by an exact multiple of the step.
  const stepMs = DEFAULT_PASS_OPTIONS.fineStepSeconds * 1000;
  const { passes } = computePassesForMany(CATALOGUE, OBSERVER, { days: 3, now: NOW, maxMagnitude: 99 });
  assert.ok(passes.length > 2, "need a few passes for this to mean anything");
  const onGrid = passes.filter((p) => (Date.parse(p.end.time) - Date.parse(p.start.time)) % stepMs === 0).length;
  assert.ok(onGrid < passes.length, `all ${passes.length} pass durations are exact multiples of the ${stepMs} ms step`);
});
