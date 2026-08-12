import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { describeReentry, reentryWatch } from './reentry';
import { orbitalElementsFromTle } from './decay';
import type { TleRecord } from '../types';

/**
 * Real element sets, taken from production. A synthetic TLE is not much use
 * here: the whole thing turns on SGP4 refusing to propagate decayed elements,
 * which only happens for orbits that are genuinely low.
 */
const ISS: TleRecord = {
  name: 'ISS (ZARYA)',
  satnum: '25544',
  line1: '1 25544U 98067A   26217.53790868  .00005167  00000+0  10064-3 0  9996',
  line2: '2 25544  51.6320  55.8612 0007287  15.5234 344.5977 15.49355388579405',
};
/** A Fengyun fragment on a high, slow orbit — drag is irrelevant for it. */
const HIGH_FRAGMENT: TleRecord = {
  name: 'FENGYUN 1C DEB',
  satnum: '30117',
  line1: '1 30117U 99025DTM 26217.45284649  .00000149  00000+0  47795-4 0  9998',
  line2: '2 30117  98.7999 156.7238 0180356 179.0865 181.0335 14.15254859 99999',
};
/** Very low perigee: the case the watchlist exists to surface. */
const LOW: TleRecord = {
  name: 'COSMOS 1408 DEB',
  satnum: '50621',
  line1: '1 50621U 82092ALR 26217.36841413  .00038522  00000+0  27883-3 0  9993',
  line2: '2 50621  82.5645 185.8828 0016866   4.5709 355.5705 15.73073571259340',
};

const NOW = new Date('2026-08-06T00:00:00Z');

test('the cheap perigee sort decides what gets the expensive search', () => {
  // Only one object may be forward-searched; it must be the lowest one, or the
  // shortlist is picking by input order and the whole optimisation is unsound.
  const out = reentryWatch([ISS, HIGH_FRAGMENT, LOW], NOW, { searchLowest: 1 });
  assert.equal(out.scanned, 3);
  assert.equal(out.searched, 1);

  const perigees = [ISS, HIGH_FRAGMENT, LOW].map((t) => ({
    satnum: t.satnum,
    km: orbitalElementsFromTle(t).perigeeAltitudeKm,
  }));
  const lowest = perigees.sort((a, b) => a.km - b.km)[0].satnum;
  // Whatever came back had to come from the lowest object.
  for (const c of out.candidates) assert.equal(c.tle.satnum, lowest);
});

test('an object is never listed twice, however many sources supplied it', () => {
  // The same fragment arrives from a tracked group and from the debris field.
  const out = reentryWatch([LOW, LOW, ISS, LOW], NOW);
  assert.equal(out.scanned, 2, 'duplicates should collapse before anything else');
  const ids = out.candidates.map((c) => c.tle.satnum);
  assert.equal(new Set(ids).size, ids.length, 'a reentry listed twice reads as two reentries');
});

test('soonest first, with a stable tie-break', () => {
  const out = reentryWatch([LOW, ISS, HIGH_FRAGMENT], NOW, { horizonDays: 10_000 });
  for (let i = 1; i < out.candidates.length; i++) {
    assert.ok(
      out.candidates[i - 1].daysRemaining <= out.candidates[i].daysRemaining,
      'candidates must be ordered by how soon they come down'
    );
  }
  // Same input in a different order must produce the same list.
  const shuffled = reentryWatch([HIGH_FRAGMENT, ISS, LOW], NOW, { horizonDays: 10_000 });
  assert.deepEqual(
    out.candidates.map((c) => c.tle.satnum),
    shuffled.candidates.map((c) => c.tle.satnum)
  );
});

test('the horizon excludes rather than truncates', () => {
  const wide = reentryWatch([LOW, ISS, HIGH_FRAGMENT], NOW, { horizonDays: 10_000 });
  const tight = reentryWatch([LOW, ISS, HIGH_FRAGMENT], NOW, { horizonDays: 1 });
  assert.ok(tight.candidates.length <= wide.candidates.length);
  for (const c of tight.candidates) assert.ok(c.daysRemaining <= 1);
});

test('unparseable elements are counted, not silently dropped', () => {
  const junk: TleRecord = { name: 'JUNK', satnum: '99999', line1: 'nonsense', line2: 'nonsense' };
  const out = reentryWatch([junk], NOW);
  assert.equal(out.candidates.length, 0);
  assert.ok(out.unusable >= 1, 'a set that cannot be read has to be reported somewhere');
});

test('an empty catalogue is an empty watchlist, not a crash', () => {
  const out = reentryWatch([], NOW);
  assert.deepEqual(out, { scanned: 0, searched: 0, candidates: [], unusable: 0 });
});

test('waits are described in units a person would use', () => {
  assert.equal(describeReentry(0), 'already down per these elements');
  assert.equal(describeReentry(1), 'within a day');
  assert.equal(describeReentry(12), 'about 12 days');
  assert.equal(describeReentry(30), 'about 30 days');
  assert.equal(describeReentry(31), 'about 1 month');
  assert.equal(describeReentry(90), 'about 3 months');
});
