import assert from "node:assert/strict";
import { test } from "node:test";
import { SATELLITE_GROUPS, TLE_GROUPS, parseTle } from "./celestrak.js";

/**
 * Celestrak's gp.php serves CRLF line endings and pads the name line with
 * trailing spaces to 24 columns. These fixtures reproduce that shape, because
 * the live fetch path is the one part of the pipeline that cannot be exercised
 * from a network-restricted environment.
 */
const CRLF_RESPONSE =
  "ISS (ZARYA)             \r\n" +
  "1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994\r\n" +
  "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272\r\n" +
  "CSS (TIANHE)            \r\n" +
  "1 48274U 21035A   24058.21875000  .00021499  00000+0  24369-3 0  9990\r\n" +
  "2 48274  41.4746 128.5310 0004816 302.5461  57.4692 15.61234567 12345\r\n";

test("parses CRLF triples and trims padded names", () => {
  const records = parseTle(CRLF_RESPONSE);

  assert.equal(records.length, 2);
  assert.equal(records[0].name, "ISS (ZARYA)");
  assert.equal(records[0].satnum, "25544");
  // No stray carriage returns may survive into the element lines: satellite.js
  // parses these by fixed column offsets.
  assert.ok(!records[0].line1.includes("\r"));
  assert.ok(!records[0].line2.includes("\r"));
  assert.equal(records[0].line1.length, 69);
  assert.equal(records[1].name, "CSS (TIANHE)");
  assert.equal(records[1].satnum, "48274");
});

test("parses LF-only input", () => {
  const records = parseTle(CRLF_RESPONSE.replace(/\r\n/g, "\n"));
  assert.equal(records.length, 2);
  assert.equal(records[0].satnum, "25544");
});

test("tolerates a trailing blank line and trailing whitespace", () => {
  const records = parseTle(`${CRLF_RESPONSE}\r\n   \r\n`);
  assert.equal(records.length, 2);
});

test("returns nothing for an HTML or plain-text error body served with status 200", () => {
  // Celestrak answers some bad queries with 200 and a non-TLE body, which is
  // why fetchGroup treats an empty parse as a failure rather than a valid set.
  assert.deepEqual(parseTle("No GP data found"), []);
  assert.deepEqual(parseTle("<html><body>Error</body></html>"), []);
  assert.deepEqual(parseTle(""), []);
});

test("skips a truncated final record instead of emitting a partial one", () => {
  const truncated =
    "ISS (ZARYA)\r\n" +
    "1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994\r\n";
  assert.deepEqual(parseTle(truncated), []);
});

test("skips a record whose element lines are not numbered 1 and 2", () => {
  const malformed =
    "BAD SAT\r\n" +
    "3 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994\r\n" +
    "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272\r\n";
  assert.deepEqual(parseTle(malformed), []);
});

test("reads the NORAD id from the element line, not the name", () => {
  const records = parseTle(CRLF_RESPONSE);
  // Columns 3-7 of line 1 hold the catalog number.
  assert.equal(records[0].satnum, records[0].line1.slice(2, 7).trim());
});

test("the group catalogue is internally consistent", () => {
  assert.ok(SATELLITE_GROUPS.length > 15, "the point of this was to stop being two groups");

  const ids = new Set<string>();
  for (const group of SATELLITE_GROUPS) {
    assert.ok(!ids.has(group.id), `duplicate group id '${group.id}'`);
    ids.add(group.id);
    // Ids travel in shared permalinks, so they must be URL-safe and stable.
    assert.match(group.id, /^[a-z0-9-]+$/, `group id '${group.id}' is not URL-safe`);
    assert.ok(group.label.length > 0 && group.description.length > 0, `${group.id} is unlabelled`);
    assert.ok(group.approximateSize > 0, `${group.id} claims a non-positive size`);
    assert.ok(group.celestrak.length > 0, `${group.id} has no upstream group`);
  }

  // Every catalogue entry must be fetchable, and the legacy alias must survive
  // because it may be sitting in someone's bookmark.
  for (const group of SATELLITE_GROUPS) {
    assert.equal(TLE_GROUPS[group.id], group.celestrak, `${group.id} missing from TLE_GROUPS`);
  }
  assert.equal(TLE_GROUPS.brightest, "visual", "the pre-catalogue alias must keep working");
  assert.ok(TLE_GROUPS.stations && TLE_GROUPS.visual, "the defaults must still resolve");
});

test("the defaults are small enough to be worth defaulting to", () => {
  // Whatever ships selected has to stay scannable without hitting the cap, or
  // a first visit lands on a truncation notice.
  const defaults = ["stations", "visual"];
  const total = defaults.reduce(
    (sum, id) => sum + SATELLITE_GROUPS.find((g) => g.id === id)!.approximateSize,
    0
  );
  assert.ok(total < 500, `defaults come to about ${total} objects`);
});
