import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as satellite from 'satellite.js';
import { altitudeBandsOverlap, findCloseApproaches } from './conjunctions';
import { orbitalElementsFromTle } from './decay';
import { parseSatrec } from './sky';
import type { TleRecord } from '../types';

const ISS: TleRecord = {
  name: 'ISS (ZARYA)',
  satnum: '25544',
  line1: '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272',
};

// The exact same orbit under a different catalog number: distance is ~0 at
// every instant, so any scan should find this as an extremely close pair
// without needing to reason about real orbital geometry to set up the test.
const ISS_CLONE: TleRecord = { ...ISS, satnum: '99998', name: 'ISS CLONE' };

// A geostationary-like TLE: ~35,800 km up, nowhere near the ISS's ~400 km band.
const GEO_LIKE: TleRecord = {
  name: 'GEO TEST',
  satnum: '99001',
  line1: '1 99001U 24001A   24058.50000000  .00000000  00000+0  00000+0 0  9993',
  line2: '2 99001   0.0100  10.0000 0001000  90.0000 270.0000  1.00273790000010',
};

// Same orbital plane and altitude as the ISS but with the mean anomaly offset
// 180 degrees, so the two are on opposite sides of the Earth at epoch and
// stay roughly a full orbital diameter apart — never a close approach.
const ISS_OPPOSITE_SIDE: TleRecord = {
  ...ISS,
  satnum: '99997',
  name: 'OPPOSITE SIDE',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 145.0288 15.49309239440272',
};

const EPOCH = new Date('2024-02-27T12:50:00Z');

test('altitudeBandsOverlap is true for two orbits at the same altitude', () => {
  const a = orbitalElementsFromTle(ISS);
  const b = orbitalElementsFromTle(ISS_CLONE);
  assert.ok(altitudeBandsOverlap(a, b));
});

test('altitudeBandsOverlap is false for LEO vs GEO altitude bands', () => {
  const a = orbitalElementsFromTle(ISS);
  const b = orbitalElementsFromTle(GEO_LIKE);
  assert.equal(altitudeBandsOverlap(a, b), false);
});

test('findCloseApproaches finds an identical-orbit pair as an extremely close approach', () => {
  const results = findCloseApproaches([ISS, ISS_CLONE], EPOCH, { windowHours: 2 });
  assert.equal(results.length, 1);
  assert.ok(results[0].minDistanceKm < 1, `expected near-zero separation, got ${results[0].minDistanceKm}`);
  assert.deepEqual([results[0].satnumA, results[0].satnumB].sort(), ['25544', '99998']);
});

test('findCloseApproaches excludes a pair whose altitude bands do not overlap', () => {
  const results = findCloseApproaches([ISS, GEO_LIKE], EPOCH, { windowHours: 2 });
  assert.equal(results.length, 0);
});

test('findCloseApproaches excludes a same-altitude pair that never actually gets close', () => {
  const results = findCloseApproaches([ISS, ISS_OPPOSITE_SIDE], EPOCH, { windowHours: 2, thresholdKm: 25 });
  assert.equal(results.length, 0);
});

test('findCloseApproaches skips a duplicate NORAD id against itself', () => {
  const results = findCloseApproaches([ISS, { ...ISS }], EPOCH, { windowHours: 1 });
  assert.equal(results.length, 0);
});

test('findCloseApproaches returns results sorted by ascending distance', () => {
  const results = findCloseApproaches([ISS, ISS_CLONE, GEO_LIKE], EPOCH, { windowHours: 2 });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i].minDistanceKm >= results[i - 1].minDistanceKm);
  }
});

test('findCloseApproaches respects a tighter threshold', () => {
  const generous = findCloseApproaches([ISS, ISS_CLONE], EPOCH, { windowHours: 1, thresholdKm: 1000 });
  // Negative is never satisfiable, regardless of how close the pair actually gets.
  const impossible = findCloseApproaches([ISS, ISS_CLONE], EPOCH, { windowHours: 1, thresholdKm: -1 });
  assert.equal(generous.length, 1);
  assert.equal(impossible.length, 0);
});

/**
 * Four real Fengyun-1C fragments, from CelesTrak's public element sets. The
 * synthetic pairs above are useful for the plumbing but useless for checking the
 * sampling: an identical orbit is close at every instant, so any step size finds
 * it. Only a real, brief encounter distinguishes a scan that resolves approaches
 * from one that steps over them, and these four are the pairs the sampling
 * rewrite was measured against.
 */
const FY_30494: TleRecord = {
  name: 'FENGYUN 1C DEB',
  satnum: '30494',
  line1: '1 30494U 99025AHG 26217.33575883  .00000669  00000+0  60469-3 0  9993',
  line2: '2 30494  99.2623 252.9563 0184374 318.2112  40.5084 13.80017283977355',
};
const FY_36216: TleRecord = {
  name: 'FENGYUN 1C DEB',
  satnum: '36216',
  line1: '1 36216U 99025DUR 26213.29183608  .00000553  00000+0  28155-3 0  9990',
  line2: '2 36216  98.5922 231.6523 0045732  69.3429 291.2643 14.19156346676568',
};
const FY_29805: TleRecord = {
  name: 'FENGYUN 1C DEB',
  satnum: '29805',
  line1: '1 29805U 99025CX  26217.12301174  .00000024  00000+0  66268-4 0  9993',
  line2: '2 29805  99.4227 269.9780 0187793 337.1770  22.1111 13.72726417979321',
};
const FY_32169: TleRecord = {
  name: 'FENGYUN 1C DEB',
  satnum: '32169',
  line1: '1 32169U 99025CTP 26217.01649324  .00016543  00000+0  21755-2 0  9993',
  line2: '2 32169  98.5454  63.6563 0030207  98.1957 262.2681 14.79958655   824',
};

const FY_FROM = new Date('2026-08-12T00:00:00Z');

// Parsing is memoised because the brute-force baselines below call this tens of
// thousands of times; twoline2satrec on every sample would dominate the run.
const satrecCache = new Map<string, satellite.SatRec>();
function satrecFor(tle: TleRecord): satellite.SatRec {
  const hit = satrecCache.get(tle.satnum);
  if (hit) return hit;
  const parsed = parseSatrec(tle);
  assert.ok(parsed, `fixture TLE ${tle.satnum} must parse`);
  satrecCache.set(tle.satnum, parsed);
  return parsed;
}

/** Separation of two records at one instant, straight out of SGP4. */
function separationAtKm(a: TleRecord, b: TleRecord, at: Date): number {
  const recA = satrecFor(a);
  const recB = satrecFor(b);
  const pvA = satellite.propagate(recA, at);
  const pvB = satellite.propagate(recB, at);
  assert.ok(pvA?.position && pvB?.position, 'fixture TLEs must propagate');
  const dx = pvA.position.x - pvB.position.x;
  const dy = pvA.position.y - pvB.position.y;
  const dz = pvA.position.z - pvB.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Smallest separation over the window by exhaustive sampling. */
function bruteForceMinKm(a: TleRecord, b: TleRecord, from: Date, windowHours: number, dtSeconds: number): number {
  let best = Infinity;
  const steps = Math.floor((windowHours * 3600) / dtSeconds);
  for (let s = 0; s <= steps; s++) {
    best = Math.min(best, separationAtKm(a, b, new Date(from.getTime() + s * dtSeconds * 1000)));
  }
  return best;
}

test('a fixed 90-second step turns a real 4 km approach into a non-event', () => {
  // Not a test of the scan — a test that the fixture is a real regression guard.
  // These two fragments pass 4.2 km apart, and a 90-second grid sees them no
  // closer than 28.3 km: past the 25 km threshold the UI screens on, so the
  // approach is not merely mis-measured, it is dropped and never shown. That is
  // the defect the adaptive stepping fixes, and any scan that reports the
  // smallest separation on a fixed grid fails the next two tests.
  const truth = bruteForceMinKm(FY_30494, FY_36216, FY_FROM, 2, 0.5);
  const coarse = bruteForceMinKm(FY_30494, FY_36216, FY_FROM, 2, 90);
  assert.ok(truth < 25, `expected a real close approach, brute force says ${truth.toFixed(1)} km`);
  assert.ok(coarse > 25, `expected the 90 s grid to put it past the threshold, got ${coarse.toFixed(1)} km`);
});

test('findCloseApproaches agrees with half-second brute force on a real approach', () => {
  const truth = bruteForceMinKm(FY_30494, FY_36216, FY_FROM, 2, 0.5);
  const results = findCloseApproaches([FY_30494, FY_36216], FY_FROM, { windowHours: 2, thresholdKm: 25 });
  assert.equal(results.length, 1, 'a sub-25 km approach must be reported at the 25 km threshold');
  assert.ok(
    Math.abs(results[0].minDistanceKm - truth) < 1,
    `reported ${results[0].minDistanceKm} km against a true ${truth.toFixed(2)} km`
  );
});

test('the reported time of closest approach is when the pair is actually closest', () => {
  const results = findCloseApproaches([FY_30494, FY_36216], FY_FROM, { windowHours: 2, thresholdKm: 25 });
  assert.equal(results.length, 1);
  const tca = new Date(results[0].timeOfClosestApproach);
  const atTca = bruteForceMinKm(FY_30494, FY_36216, tca, 0, 1);
  assert.ok(
    Math.abs(atTca - results[0].minDistanceKm) < 1,
    `separation at the reported time is ${atTca.toFixed(2)} km, but it reported ${results[0].minDistanceKm} km`
  );
});

test('the altitude band pre-filter widens with the threshold being screened on', () => {
  // Bands 859-1135 km and 615-658 km: 201 km of clear air between them, so no
  // 25 km approach is geometrically possible and skipping the pair is right.
  // They do come within 426 km, though, so a 500 km screen has to keep them —
  // which a filter with a flat 100 km margin did not, and it discarded them
  // before propagating anything, so nothing downstream could notice.
  const a = orbitalElementsFromTle(FY_29805);
  const b = orbitalElementsFromTle(FY_32169);
  assert.equal(altitudeBandsOverlap(a, b, 25 + 100), false);
  assert.equal(altitudeBandsOverlap(a, b, 500 + 100), true);

  assert.equal(findCloseApproaches([FY_29805, FY_32169], FY_FROM, { windowHours: 6, thresholdKm: 25 }).length, 0);
  const wide = findCloseApproaches([FY_29805, FY_32169], FY_FROM, { windowHours: 6, thresholdKm: 500 });
  assert.equal(wide.length, 1, 'a 426 km approach must survive a 500 km screen');
  assert.ok(wide[0].minDistanceKm > 400 && wide[0].minDistanceKm < 450, `got ${wide[0].minDistanceKm} km`);
});
