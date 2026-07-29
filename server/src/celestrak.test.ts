import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTle } from "./celestrak.js";

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
