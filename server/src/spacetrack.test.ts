import { strict as assert } from "node:assert";
import { test } from "node:test";
import * as satellite from "satellite.js";
import {
  IDS_PER_QUERY,
  nonActive,
  RATE_LIMIT_PER_HOUR,
  RATE_LIMIT_PER_MINUTE,
  RateLimiter,
  chunkIds,
  credentialsConfigured,
  getSpaceTrackDebris,
  joinSatcatWithGp,
  rankBySize,
  resetSpaceTrackState,
  type GpRecord,
  type SatcatRecord,
} from "./spacetrack.js";
import { isDerelictByStatus, toAlpha5 } from "./satcat.js";

/**
 * satcat rows in exactly the shape Space-Track returns them, taken from a real
 * response. Note NORAD_CAT_ID is an unpadded string and there are no elements
 * anywhere in this class — which is the entire reason the gp join exists.
 */
const SATCAT: SatcatRecord[] = [
  { NORAD_CAT_ID: "33773", OBJECT_NAME: "IRIDIUM 33 DEB", OBJECT_TYPE: "DEBRIS", DECAY: null,
    RCS_SIZE: "SMALL", COUNTRY: "US", LAUNCH: "1997-09-14", PERIGEE: "703", APOGEE: "790", INCLINATION: "86.40" },
  { NORAD_CAT_ID: "33775", OBJECT_NAME: "IRIDIUM 33 DEB", OBJECT_TYPE: "DEBRIS", DECAY: null,
    RCS_SIZE: "MEDIUM", COUNTRY: "US", LAUNCH: "1997-09-14", PERIGEE: "700", APOGEE: "800", INCLINATION: "86.36" },
  { NORAD_CAT_ID: "694", OBJECT_NAME: "ATLAS CENTAUR 2", OBJECT_TYPE: "ROCKET BODY", DECAY: null,
    RCS_SIZE: "LARGE", COUNTRY: "US", LAUNCH: "1963-11-27", PERIGEE: "285", APOGEE: "615", INCLINATION: "30.36" },
  // Catalogued but with no current element set — cannot be propagated.
  { NORAD_CAT_ID: "40000", OBJECT_NAME: "NO ELEMENTS DEB", OBJECT_TYPE: "DEBRIS", DECAY: null,
    RCS_SIZE: null, COUNTRY: "PRC", LAUNCH: "2014-01-01", PERIGEE: "500", APOGEE: "520", INCLINATION: "98.0" },
];

/** gp rows, which carry the elements and little else. */
const GP: GpRecord[] = [
  { NORAD_CAT_ID: "33773", EPOCH: "2026-08-05T06:17:08",
    TLE_LINE1: "1 33773U 97051L   26217.26190867  .00000598  00000+0  16995-3 0  9996",
    TLE_LINE2: "2 33773  86.4043 320.7682 0013406  94.8801 265.3931 14.43721862917455" },
  { NORAD_CAT_ID: "33775", EPOCH: "2026-08-05T06:06:39",
    TLE_LINE1: "1 33775U 97051N   26217.25462228  .00000882  00000+0  26198-3 0  9992",
    TLE_LINE2: "2 33775  86.3647 308.9689 0015279 105.0780 307.7474 14.42135117915342" },
  { NORAD_CAT_ID: "694", EPOCH: "2026-08-04T23:35:06",
    TLE_LINE1: "1 00694U 63047A   26215.98271178  .00000869  00000+0  91613-4 0  9994",
    TLE_LINE2: "2 00694  30.3569  92.0853 0545778 299.0365  55.6615 14.12590897152466" },
  // Elements for something not in our satcat slice — must not appear.
  { NORAD_CAT_ID: "25544", EPOCH: "2026-08-04T19:06:48",
    TLE_LINE1: "1 25544U 98067A   26215.79638706  .00007444  00000+0  14146-3 0  9999",
    TLE_LINE2: "2 25544  51.6316  64.4821 0007224   9.2337 350.8783 15.49332738579132" },
];

// ---------------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------------

test("the join is what turns metadata into something propagatable", () => {
  // This is the whole point of the integration: satcat alone cannot place an
  // object anywhere, because it has no elements at all.
  for (const row of SATCAT) {
    assert.equal((row as Record<string, unknown>).TLE_LINE1, undefined);
  }
  const { joined } = joinSatcatWithGp(SATCAT, GP, toAlpha5);
  for (const obj of joined) {
    assert.ok(obj.tle.line1.startsWith("1 "), `${obj.name}: line 1`);
    assert.ok(obj.tle.line2.startsWith("2 "), `${obj.name}: line 2`);
  }
});

test("joined elements actually propagate through SGP4", () => {
  // Metadata being present is not the bar. The bar is a position.
  const { joined } = joinSatcatWithGp(SATCAT, GP, toAlpha5);
  assert.equal(joined.length, 3);

  for (const obj of joined) {
    const rec = satellite.twoline2satrec(obj.tle.line1, obj.tle.line2);
    assert.equal(rec.error, 0, `${obj.name} (#${obj.satnum}): satrec error ${rec.error}`);

    const pv = satellite.propagate(rec, new Date("2026-08-05T22:00:00Z"));
    assert.ok(pv && pv.position, `${obj.name}: no position`);
    const { x, y, z } = pv.position as { x: number; y: number; z: number };
    for (const [axis, v] of Object.entries({ x, y, z })) {
      assert.ok(Number.isFinite(v), `${obj.name}: ${axis} is not finite`);
    }
    // A real orbit, not a degenerate solution: radius must exceed Earth's.
    const r = Math.hypot(x, y, z);
    assert.ok(r > 6400 && r < 60000, `${obj.name}: radius ${r.toFixed(0)} km is not an orbit`);
  }
});

test("catalogue numbers are normalised so they match the rest of the app", () => {
  const { joined } = joinSatcatWithGp(SATCAT, GP, toAlpha5);
  // satcat writes 694; a TLE writes 00694. Without normalising, nothing downstream matches.
  assert.ok(joined.some((o) => o.satnum === "00694"));
  assert.ok(!joined.some((o) => o.satnum === "694"));
});

test("an object with no current elements is reported, not silently included", () => {
  // #40000 is in satcat and absent from gp. Including it with a null element
  // set would push the failure into every consumer.
  const { joined, missingElements } = joinSatcatWithGp(SATCAT, GP, toAlpha5);
  assert.equal(missingElements, 1);
  assert.ok(!joined.some((o) => o.satnum === "40000"));
});

test("elements without a matching satcat row are dropped, and counted", () => {
  // The ISS is in gp but not in this debris slice. Keeping it would mean an
  // object with no declared type — the guess this integration removes.
  const { joined, unmatchedElements } = joinSatcatWithGp(SATCAT, GP, toAlpha5);
  assert.ok(!joined.some((o) => o.satnum === "25544"));
  assert.equal(unmatchedElements, 1);
});

test("a gp row missing either TLE line is treated as unusable", () => {
  const partial: GpRecord[] = [{ NORAD_CAT_ID: "33773", TLE_LINE1: "1 33773U ..." }];
  const { joined, unmatchedElements } = joinSatcatWithGp(SATCAT, partial, toAlpha5);
  assert.equal(joined.length, 0);
  assert.equal(unmatchedElements, 1);
});

test("declared type from satcat wins over the name", () => {
  const { joined } = joinSatcatWithGp(SATCAT, GP, toAlpha5);
  const centaur = joined.find((o) => o.satnum === "00694")!;
  // The name has no "R/B"; satcat says ROCKET BODY, and that is a fact not a guess.
  assert.equal(centaur.objectType, "ROCKET BODY");
});

// ---------------------------------------------------------------------------
// Ranking and chunking
// ---------------------------------------------------------------------------

test("a capped response keeps the largest objects, and absent size is not small", () => {
  const ranked = rankBySize([
    { rcsSize: "SMALL", satnum: "3" },
    { rcsSize: null, satnum: "4" },
    { rcsSize: "LARGE", satnum: "1" },
    { rcsSize: "MEDIUM", satnum: "2" },
  ] as never);
  assert.deepEqual(ranked.map((o) => o.satnum), ["1", "2", "3", "4"]);
});

test("ranking is stable, so a capped list does not reshuffle between refreshes", () => {
  const objs = [
    { rcsSize: "MEDIUM", satnum: "00300" },
    { rcsSize: "MEDIUM", satnum: "00100" },
    { rcsSize: "MEDIUM", satnum: "00200" },
  ] as never;
  assert.deepEqual(rankBySize(objs).map((o: { satnum: string }) => o.satnum), ["00100", "00200", "00300"]);
  assert.deepEqual(rankBySize(rankBySize(objs)).map((o: { satnum: string }) => o.satnum), ["00100", "00200", "00300"]);
});

test("id lists are chunked, because twelve thousand ids is not a valid URL", () => {
  const ids = Array.from({ length: 12_498 }, (_, i) => String(i + 1));
  const chunks = chunkIds(ids);
  assert.equal(chunks.length, Math.ceil(12_498 / IDS_PER_QUERY));
  assert.equal(chunks.flat().length, ids.length, "chunking must not lose ids");
  assert.deepEqual(chunks.flat(), ids, "chunking must not reorder ids");
  for (const c of chunks) assert.ok(c.length <= IDS_PER_QUERY);
  // The URL a chunk produces has to be a sane length.
  assert.ok(chunks[0].join(",").length < 8000, "a chunk's id list should fit comfortably in a URL");
});

test("chunking handles the empty and exact-multiple cases", () => {
  assert.deepEqual(chunkIds([]), []);
  assert.equal(chunkIds(Array.from({ length: IDS_PER_QUERY }, (_, i) => String(i))).length, 1);
  assert.equal(chunkIds(Array.from({ length: IDS_PER_QUERY + 1 }, (_, i) => String(i))).length, 2);
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

test("the limiter stops a burst inside one minute", () => {
  const rl = new RateLimiter(5, 100);
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check(t0 + i).allowed, true, `request ${i}`);
    rl.record(t0 + i);
  }
  const blocked = rl.check(t0 + 6);
  assert.equal(blocked.allowed, false);
  assert.ok(!blocked.allowed && blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000);
});

test("the minute window slides rather than resetting on a fixed boundary", () => {
  const rl = new RateLimiter(2, 100);
  rl.record(0);
  rl.record(1);
  assert.equal(rl.check(2).allowed, false);
  // Once the first two age past a minute, room reappears.
  assert.equal(rl.check(60_001).allowed, true);
});

test("the hourly ceiling holds even when the minute window is clear", () => {
  const rl = new RateLimiter(100, 4);
  for (let i = 0; i < 4; i++) rl.record(i * 120_000); // spread over 8 minutes
  const at = 4 * 120_000;
  assert.equal(rl.check(at).allowed, false, "hourly limit should bite");
  assert.equal(rl.check(3_600_001).allowed, true, "and release after an hour");
});

test("the configured limits sit under Space-Track's published fair use", () => {
  // Their policy is roughly 30/minute and 300/hour. These are deliberately
  // below that, because being throttled means the debris screen silently drops
  // to the curated set — a worse outcome than a slower refresh.
  assert.ok(RATE_LIMIT_PER_MINUTE < 30);
  assert.ok(RATE_LIMIT_PER_HOUR < 300);
});

// ---------------------------------------------------------------------------
// Degradation
// ---------------------------------------------------------------------------

test("without credentials it reports unavailable instead of throwing", async () => {
  resetSpaceTrackState();
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  delete process.env.SPACETRACK_USER;
  delete process.env.SPACETRACK_PASS;
  try {
    assert.equal(credentialsConfigured(), false);
    const result = await getSpaceTrackDebris(toAlpha5, 10);
    assert.equal(result.source, "unavailable");
    assert.deepEqual(result.objects, []);
    assert.match(result.error ?? "", /credentials/i);
    // The caller needs to be able to say why, not just that nothing came back.
    assert.ok((result.error ?? "").length > 0);
  } finally {
    if (user !== undefined) process.env.SPACETRACK_USER = user;
    if (pass !== undefined) process.env.SPACETRACK_PASS = pass;
    resetSpaceTrackState();
  }
});

test("bad credentials degrade to unavailable rather than propagating an error", async () => {
  resetSpaceTrackState();
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  process.env.SPACETRACK_USER = "not-a-real-account@example.invalid";
  process.env.SPACETRACK_PASS = "definitely-wrong";
  try {
    // No network reaches space-track.org from here, which exercises the same
    // path a rejected login does: the failure is caught and reported.
    const result = await getSpaceTrackDebris(toAlpha5, 10);
    assert.equal(result.source, "unavailable");
    assert.deepEqual(result.objects, []);
    assert.ok((result.error ?? "").length > 0, "the reason must be reported");
  } finally {
    if (user === undefined) delete process.env.SPACETRACK_USER;
    else process.env.SPACETRACK_USER = user;
    if (pass === undefined) delete process.env.SPACETRACK_PASS;
    else process.env.SPACETRACK_PASS = pass;
    resetSpaceTrackState();
  }
});

// ---------------------------------------------------------------------------
// What counts as non-active, which decides what the dome's point field holds
// ---------------------------------------------------------------------------

function row(type: string, ops?: string | null): SatcatRecord {
  return {
    NORAD_CAT_ID: "1", OBJECT_NAME: "X", OBJECT_TYPE: type, OPS_STATUS_CODE: ops ?? null,
    DECAY: null, RCS_SIZE: null, COUNTRY: null, LAUNCH: null, PERIGEE: null, APOGEE: null,
    INCLINATION: null,
  };
}

/**
 * The bug this exists to prevent recurring: the satcat query was pinned to
 * OBJECT_TYPE=DEBRIS, so every spent stage and dead satellite — the only
 * derelicts a person could actually go outside and see — was silently absent
 * from a field whose status line claimed to plot the catalogue.
 */
test("stages and fragments are non-active regardless of any status flag", () => {
  assert.equal(nonActive([row("ROCKET BODY")]).length, 1);
  assert.equal(nonActive([row("DEBRIS")]).length, 1);
  assert.equal(nonActive([row("ROCKET BODY", "+")]).length, 1);
});

test("a payload is non-active only when the catalogue says nonoperational", () => {
  assert.equal(nonActive([row("PAYLOAD", "-")]).length, 1);
  for (const ops of ["+", "P", "B", "S", "X", "?", "", null]) {
    assert.equal(
      nonActive([row("PAYLOAD", ops)]).length,
      0,
      `payload with ops "${ops}" must not be treated as derelict`
    );
  }
});

/**
 * Inferring death from an absent answer would put live satellites in the
 * derelict field, which is the invention this whole layer exists to avoid.
 */
test("an undetermined object type is left out rather than guessed at", () => {
  assert.equal(nonActive([row("UNKNOWN")]).length, 0);
  assert.equal(nonActive([row("TBA")]).length, 0);
  assert.equal(nonActive([row("")]).length, 0);
});

test("the rule matches isDerelictByStatus, which decides the same thing elsewhere", () => {
  // Same question, two data sources; a disagreement between them would mean the
  // dome and the debris screen classified the same object differently.
  const cases: Array<[string, string | null]> = [
    ["ROCKET BODY", null], ["DEBRIS", null], ["PAYLOAD", "-"], ["PAYLOAD", "+"],
    ["PAYLOAD", "B"], ["PAYLOAD", "S"], ["PAYLOAD", "X"], ["PAYLOAD", "?"],
  ];
  for (const [type, ops] of cases) {
    const viaSatcat = isDerelictByStatus({
      satnum: "1", name: "X",
      objectType: type as never,
      opsStatus:
        ops === "-" ? "nonoperational" : ops === "+" ? "operational" : ops === "B" ? "backup"
        : ops === "S" ? "spare" : ops === "X" ? "extended-mission" : "unknown",
      rcsSquareMetres: null, launchDate: null, decayDate: null,
    });
    assert.equal(
      nonActive([row(type, ops)]).length === 1,
      viaSatcat,
      `${type}/${ops} must classify the same in both places`
    );
  }
});
