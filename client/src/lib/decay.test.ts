import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateDecay, orbitalElementsFromTle } from './decay';
import type { TleRecord } from '../types';

const ISS: TleRecord = {
  name: 'ISS (ZARYA)',
  satnum: '25544',
  line1: '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272',
};

// A geostationary-like TLE: near-zero eccentricity, ~1 rev/day.
const GEO_LIKE: TleRecord = {
  name: 'GEO TEST',
  satnum: '99001',
  line1: '1 99001U 24001A   24058.50000000  .00000000  00000+0  00000+0 0  9993',
  line2: '2 99001   0.0100  10.0000 0001000  90.0000 270.0000  1.00273790000010',
};

// Circular ~200km orbit built from the ISS's own line 1 (for a plausible
// BSTAR/epoch) with line 2's eccentricity zeroed and mean motion set for a
// 200km circular orbit — SGP4 itself starts failing around day 74 for these
// elements, independently confirmed against the underlying satellite.js
// propagate() call before this fixture was written into the test.
const LOW_ORBIT_200KM: TleRecord = {
  name: 'DECAYING TEST (200KM)',
  satnum: '25544',
  line1: ISS.line1,
  line2: '2 25544  51.6416 247.4627 0000000 130.5360 325.0288 16.29879739440272',
};

// Circular ~150km orbit — SGP4 fails within days for elements this low.
const LOW_ORBIT_150KM: TleRecord = {
  name: 'DECAYING TEST (150KM)',
  satnum: '25544',
  line1: ISS.line1,
  line2: '2 25544  51.6416 247.4627 0000000 130.5360 325.0288 16.53730919440271',
};

const EPOCH = new Date('2024-02-27T12:50:00Z');

test('orbitalElementsFromTle computes a plausible perigee/apogee for the ISS', () => {
  const elements = orbitalElementsFromTle(ISS);
  assert.ok(elements.perigeeAltitudeKm > 390 && elements.perigeeAltitudeKm < 435, `got ${elements.perigeeAltitudeKm}`);
  assert.ok(elements.apogeeAltitudeKm > 390 && elements.apogeeAltitudeKm < 435, `got ${elements.apogeeAltitudeKm}`);
  assert.ok(elements.apogeeAltitudeKm >= elements.perigeeAltitudeKm);
});

test('orbitalElementsFromTle reads a near-zero eccentricity, ~1 rev/day for a GEO-like TLE', () => {
  const elements = orbitalElementsFromTle(GEO_LIKE);
  assert.ok(Math.abs(elements.meanMotionRevPerDay - 1.0027379) < 1e-6);
  assert.ok(elements.perigeeAltitudeKm > 35000);
});

test('estimateDecay reports "stable" for a high-perigee orbit without searching', () => {
  const result = estimateDecay(GEO_LIKE, EPOCH);
  assert.equal(result?.status, 'stable');
  assert.equal(result?.estimatedDaysRemaining, null);
});

test('estimateDecay reports "monitor" for the ISS: below the stable cutoff, but SGP4 does not fail within the search horizon', () => {
  const result = estimateDecay(ISS, EPOCH);
  assert.equal(result?.status, 'monitor');
  assert.equal(result?.estimatedDaysRemaining, null);
  assert.ok(result!.perigeeAltitudeKm < 600);
});

test('estimateDecay reports "monitor" with a day count for a slowly-decaying low orbit', () => {
  const result = estimateDecay(LOW_ORBIT_200KM, EPOCH);
  assert.equal(result?.status, 'monitor');
  assert.ok(result?.estimatedDaysRemaining !== null && result.estimatedDaysRemaining > 30);
});

test('estimateDecay reports "decaying-soon" with a specific day count for an imminently low orbit', () => {
  const result = estimateDecay(LOW_ORBIT_150KM, EPOCH);
  assert.equal(result?.status, 'decaying-soon');
  assert.ok(result?.estimatedDaysRemaining !== null && result.estimatedDaysRemaining! <= 30);
});

test('estimateDecay reports "decayed" once the reference date is already past SGP4\'s own failure point', () => {
  const wellAfterDecay = new Date(EPOCH.getTime() + 100 * 86_400_000);
  const result = estimateDecay(LOW_ORBIT_200KM, wellAfterDecay);
  assert.equal(result?.status, 'decayed');
  assert.equal(result?.estimatedDaysRemaining, 0);
});

// satellite.js's twoline2satrec is lenient about malformed field contents (it
// only rejects a TLE it can't reconstruct any orbit at all from), matching
// the same leniency already relied on elsewhere in this codebase — so this
// checks the pipeline degrades safely rather than throwing, not that it
// rejects the input outright.
test('estimateDecay does not throw on a garbage TLE', () => {
  assert.doesNotThrow(() => estimateDecay({ name: 'BAD', satnum: '1', line1: 'garbage', line2: 'garbage' }, EPOCH));
});
