import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { excludeDrawnAsMarkers, isDerelictByName } from './debris';
import type { TleRecord } from '../types';

/**
 * The dome draws two populations and the status lines count them separately:
 * fragments as a violet point field, spent stages and dead payloads as amber
 * markers. Anything in both is drawn twice and counted twice.
 */

function tle(satnum: string, name: string): TleRecord {
  return { satnum, name, line1: '', line2: '' } as TleRecord;
}

test('an object drawn as a marker is not also left in the point field', () => {
  const field = [tle('33773', 'IRIDIUM 33 DEB'), tle('694', 'ATLAS CENTAUR 2')];
  const markers = [tle('694', 'ATLAS CENTAUR 2')];

  const result = excludeDrawnAsMarkers(field, [markers]);

  assert.deepEqual(result.map((t) => t.satnum), ['33773']);
});

/**
 * The pinning case, which is live today rather than hypothetical.
 *
 * Catalogue search can put any object into the dome additively, and a pinned
 * fragment arrives in the derelict marker list while still being in the field —
 * the two sets are disjoint only because of the OBJECT_TYPE=DEBRIS filter on the
 * query, and pinning bypasses that entirely.
 */
test('a fragment pinned from catalogue search is drawn once, not twice', () => {
  const field = [tle('33773', 'IRIDIUM 33 DEB'), tle('33775', 'IRIDIUM 33 DEB')];
  const pinned = [tle('33775', 'IRIDIUM 33 DEB')];

  const result = excludeDrawnAsMarkers(field, [pinned]);

  assert.equal(result.length, 1);
  assert.equal(result[0].satnum, '33773');
});

/**
 * The failure this is really insuring against: widening the satcat query to
 * include ROCKET BODY, which is an obvious future improvement and would put
 * every spent stage in the bright groups into both populations at once.
 */
test('stages appearing in the field are removed by the satellite groups drawing them', () => {
  const stages = ['SL-16 R/B', 'SL-14 R/B', 'CZ-2C R/B', 'ATLAS CENTAUR 2'];
  for (const name of stages) {
    assert.equal(isDerelictByName(name), true, `${name} should classify as a derelict`);
  }

  const field = stages.map((n, i) => tle(String(40000 + i), n));
  const groups = [tle('40000', 'SL-16 R/B'), tle('40003', 'ATLAS CENTAUR 2')];

  const result = excludeDrawnAsMarkers(field, [groups]);

  assert.deepEqual(result.map((t) => t.name), ['SL-14 R/B', 'CZ-2C R/B']);
});

test('with nothing drawn as a marker the field passes through untouched', () => {
  const field = [tle('33773', 'IRIDIUM 33 DEB')];
  assert.equal(excludeDrawnAsMarkers(field, []), field);
  assert.equal(excludeDrawnAsMarkers(field, [[]]), field);
});

test('several marker lists are all excluded, not just the first', () => {
  const field = [tle('1', 'A DEB'), tle('2', 'B DEB'), tle('3', 'C DEB')];
  const result = excludeDrawnAsMarkers(field, [[tle('1', 'A DEB')], [tle('3', 'C DEB')]]);
  assert.deepEqual(result.map((t) => t.satnum), ['2']);
});
