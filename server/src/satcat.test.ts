import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isDerelictByStatus, parseSatcatCsv, splitCsvLine } from "./satcat.js";

const HEADER =
  "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,LAUNCH_SITE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS,DATA_STATUS_CODE,ORBIT_CENTER,ORBIT_TYPE";

function row(name: string, id: string, type: string, status: string, rcs = "1.5") {
  return `${name},1998-067A,${id},${type},${status},ISS,1998-11-20,TTMTR,,92.9,51.6,420,410,${rcs},,EA,ORB`;
}

test("columns are read by name, so an added column upstream cannot shift them", () => {
  const shifted =
    "OBJECT_NAME,OBJECT_ID,NEW_COLUMN,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE\n" +
    "ENVISAT,2002-009A,whatever,27386,PAYLOAD,-";
  const [entry] = parseSatcatCsv(shifted);
  assert.equal(entry.satnum, "27386");
  assert.equal(entry.objectType, "PAYLOAD");
  assert.equal(entry.opsStatus, "nonoperational");
});

test("a missing required column fails loudly rather than mislabelling everything", () => {
  const noStatus = "OBJECT_NAME,NORAD_CAT_ID,OBJECT_TYPE\nENVISAT,27386,PAYLOAD";
  assert.throws(() => parseSatcatCsv(noStatus), /OPS_STATUS_CODE/);
});

test("catalogue numbers are padded to match the five digits TLEs use", () => {
  // SATCAT writes 694; the TLE writes 00694. Unpadded, nothing would match.
  const csv = `${HEADER}\n${row("ATLAS CENTAUR 2", "694", "ROCKET BODY", "D")}`;
  assert.equal(parseSatcatCsv(csv)[0].satnum, "00694");
});

test("quoted names containing commas do not shift the remaining columns", () => {
  const csv = `${HEADER}\n${row('"SOMETHING 1, 2 & 3"', "12345", "PAYLOAD", "+")}`;
  const [entry] = parseSatcatCsv(csv);
  assert.equal(entry.name, "SOMETHING 1, 2 & 3");
  assert.equal(entry.objectType, "PAYLOAD");
  assert.equal(entry.opsStatus, "operational");
});

test("splitCsvLine handles doubled quotes inside a quoted field", () => {
  assert.deepEqual(splitCsvLine('a,"b""c",d'), ["a", 'b"c', "d"]);
});

test("every documented status code maps to something, and unknown codes do not throw", () => {
  const codes: Array<[string, string]> = [
    ["+", "operational"],
    ["-", "nonoperational"],
    ["P", "partially-operational"],
    ["B", "backup"],
    ["S", "spare"],
    ["X", "extended-mission"],
    ["D", "decayed"],
    ["?", "unknown"],
    ["Z", "unknown"],
    ["", "unknown"],
  ];
  for (const [code, expected] of codes) {
    const csv = `${HEADER}\n${row("THING", "12345", "PAYLOAD", code)}`;
    assert.equal(parseSatcatCsv(csv)[0].opsStatus, expected, `code '${code}'`);
  }
});

test("this is the thing name-based classification could never do", () => {
  // Envisat is derelict — dead since 2012 — and nothing in its name says so.
  // A test in the client pins that name-based classification calls it active.
  const csv = `${HEADER}\n${row("ENVISAT", "27386", "PAYLOAD", "-")}`;
  assert.equal(isDerelictByStatus(parseSatcatCsv(csv)[0]), true);
});

test("dormant is not dead: backup and spare spacecraft are still alive", () => {
  for (const code of ["+", "P", "B", "S", "X"]) {
    const csv = `${HEADER}\n${row("WORKING SAT", "12345", "PAYLOAD", code)}`;
    assert.equal(
      isDerelictByStatus(parseSatcatCsv(csv)[0]),
      false,
      `status '${code}' describes a spacecraft that still works`
    );
  }
});

test("an absent status is not read as death", () => {
  const csv = `${HEADER}\n${row("MYSTERY", "12345", "PAYLOAD", "?")}`;
  assert.equal(isDerelictByStatus(parseSatcatCsv(csv)[0]), false);
});

test("rocket bodies and debris are derelict regardless of status code", () => {
  for (const type of ["ROCKET BODY", "DEBRIS"]) {
    const csv = `${HEADER}\n${row("SL-16 R/B", "16182", type, "?")}`;
    assert.equal(isDerelictByStatus(parseSatcatCsv(csv)[0]), true, type);
  }
});

test("RCS is kept only when it is a real measurement", () => {
  const withRcs = `${HEADER}\n${row("BIG THING", "12345", "PAYLOAD", "+", "12.5")}`;
  assert.equal(parseSatcatCsv(withRcs)[0].rcsSquareMetres, 12.5);
  for (const blank of ["", "N/A", "0"]) {
    const csv = `${HEADER}\n${row("THING", "12345", "PAYLOAD", "+", blank)}`;
    assert.equal(parseSatcatCsv(csv)[0].rcsSquareMetres, null, `'${blank}' is not a measurement`);
  }
});

test("an empty or header-only file yields nothing rather than a bad row", () => {
  assert.deepEqual(parseSatcatCsv(""), []);
  assert.deepEqual(parseSatcatCsv(HEADER), []);
});
