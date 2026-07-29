import assert from "node:assert/strict";
import { test } from "node:test";
import { epochSpan, tleEpoch } from "./elements.js";

/** Real ISS element set with a 2024 day-058.53472222 epoch. */
const ISS_LINE1 = "1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994";

test("decodes a 21st-century epoch to the right instant", () => {
  const epoch = tleEpoch(ISS_LINE1);
  // Day 58.53472222 of 2024 => 27 February 2024, 12:50:00 UTC.
  assert.equal(epoch.toISOString(), "2024-02-27T12:50:00.000Z");
});

test("applies the NORAD two-digit year pivot", () => {
  // 57-99 are 1957-1999; prefixing "20" would misdate these by a century.
  const y57 = tleEpoch(`1 00002U 57001A   57002.00000000  .00000000  00000+0  00000+0 0  9990`);
  assert.equal(y57.getUTCFullYear(), 1957);

  const y99 = tleEpoch(`1 25544U 98067A   99060.50000000  .00000000  00000+0  00000+0 0  9990`);
  assert.equal(y99.getUTCFullYear(), 1999);

  // 00-56 are 2000-2056.
  const y00 = tleEpoch(`1 25544U 98067A   00060.50000000  .00000000  00000+0  00000+0 0  9990`);
  assert.equal(y00.getUTCFullYear(), 2000);

  const y56 = tleEpoch(`1 25544U 98067A   56060.50000000  .00000000  00000+0  00000+0 0  9990`);
  assert.equal(y56.getUTCFullYear(), 2056);
});

test("treats day 1.0 as the start of 1 January", () => {
  const epoch = tleEpoch(`1 25544U 98067A   24001.00000000  .00000000  00000+0  00000+0 0  9990`);
  assert.equal(epoch.toISOString(), "2024-01-01T00:00:00.000Z");
});

test("handles a leap year's day 366", () => {
  const epoch = tleEpoch(`1 25544U 98067A   24366.00000000  .00000000  00000+0  00000+0 0  9990`);
  assert.equal(epoch.toISOString(), "2024-12-31T00:00:00.000Z");
});

test("throws on an unparseable epoch rather than returning an invalid date", () => {
  assert.throws(() => tleEpoch("1 25544U 98067A   ABCDEFGHIJKL  .00016717"));
});

test("epochSpan reports newest and oldest ages in days", () => {
  const now = Date.UTC(2024, 1, 29, 12, 50, 0); // two days after the ISS epoch
  const older = `1 25544U 98067A   24048.53472222  .00016717  00000+0  10270-3 0  9994`;

  const span = epochSpan([ISS_LINE1, older], now);
  assert.ok(span);
  assert.equal(span.newestAgeDays, 2);
  assert.equal(span.oldestAgeDays, 12);
});

test("epochSpan skips malformed lines instead of discarding the set", () => {
  const span = epochSpan(["garbage", ISS_LINE1], Date.UTC(2024, 1, 29, 12, 50, 0));
  assert.ok(span);
  assert.equal(span.newestAgeDays, 2);
});

test("epochSpan returns null when nothing is parseable", () => {
  assert.equal(epochSpan(["garbage", ""]), null);
});
