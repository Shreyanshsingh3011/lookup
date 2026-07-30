import assert from 'node:assert/strict';
import { test } from 'node:test';
import { altitudeBandsOverlap, findCloseApproaches } from './conjunctions';
import { orbitalElementsFromTle } from './decay';
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
