import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextDerelictRise } from './debris';
import { observerToGeodetic, parseSatrec, skySampleAt } from './sky';
import type { Observer, TleRecord } from '../types';

/**
 * Real elements pulled from production on 2026-08-04, kept fixed so these
 * assertions mean the same thing every run. They will age; that is fine — the
 * tests check behaviour against an independent scan of the same elements, not
 * against remembered rise times.
 */
const DERELICTS: TleRecord[] = [
  {
    name: 'ATLAS CENTAUR 2',
    satnum: '00694',
    line1: '1 00694U 63047A   26215.98271178  .00000869  00000+0  91613-4 0  9994',
    line2: '2 00694  30.3569  92.0853 0545778 299.0365  55.6615 14.12590897152466',
  },
  {
    name: 'SL-8 R/B',
    satnum: '02802',
    line1: '1 02802U 67045B   26215.76398380  .00000173  00000+0  55482-4 0  9992',
    line2: '2 02802  74.0098  73.3984 0063424  44.6999 315.9245 14.45704752110275',
  },
  {
    name: 'SEASAT 1',
    satnum: '10967',
    line1: '1 10967U 78064A   26215.89601806  .00000088  00000+0  63005-4 0  9995',
    line2: '2 10967 108.0161  74.4431 0001123 287.3860  72.7163 14.46269900527793',
  },
  {
    name: 'LAGEOS 2',
    satnum: '22195',
    line1: '1 22195U 92070B   26215.25016075 -.00000009  00000+0  00000+0 0  9997',
    line2: '2 22195  52.6402 236.9187 0137993 207.9535 130.9014  6.47294124798460',
  },
];

const LONDON: Observer = { latitude: 51.5, longitude: -0.13, elevation: 0 };
const EPOCH = new Date('2026-08-04T00:00:00Z');

/** Brute-force earliest rise, to check the real one against. */
function scanForEarliestRise(tles: TleRecord[], observer: Observer, from: Date, hours: number) {
  const gd = observerToGeodetic(observer);
  let best: { name: string; time: Date } | null = null;
  for (const tle of tles) {
    const rec = parseSatrec(tle);
    if (!rec) continue;
    let wasUp: boolean | null = null;
    for (let s = 0; s <= hours * 60; s++) {
      const when = new Date(from.getTime() + s * 60_000);
      const sample = skySampleAt(rec, gd, when);
      if (!sample) break;
      const up = sample.elevationDeg >= 0;
      if (wasUp === false && up) {
        if (!best || when < best.time) best = { name: tle.name, time: when };
        break;
      }
      wasUp = up;
    }
  }
  return best;
}

test('finds the same next rise as an exhaustive scan of the same elements', () => {
  const found = nextDerelictRise(DERELICTS, LONDON, EPOCH, { withinHours: 12 });
  const expected = scanForEarliestRise(DERELICTS, LONDON, EPOCH, 12);

  assert.ok(expected, 'the reference scan should find a rise within 12 hours');
  assert.ok(found, 'nextDerelictRise should find one too');
  assert.equal(found.name, expected.name.trim());
  assert.equal(found.time.getTime(), expected.time.getTime());
});

test('the object it names really is below the horizon before and above it after', () => {
  const found = nextDerelictRise(DERELICTS, LONDON, EPOCH, { withinHours: 12 });
  assert.ok(found);

  const tle = DERELICTS.find((t) => t.satnum === found.satnum);
  assert.ok(tle);
  const rec = parseSatrec(tle);
  assert.ok(rec);
  const gd = observerToGeodetic(LONDON);

  const before = skySampleAt(rec, gd, new Date(found.time.getTime() - 60_000));
  const after = skySampleAt(rec, gd, found.time);
  assert.ok(before && after);
  assert.ok(before.elevationDeg < 0, `expected below horizon a minute before, got ${before.elevationDeg}`);
  assert.ok(after.elevationDeg >= 0, `expected above horizon at the reported time, got ${after.elevationDeg}`);
});

test('an object already up is not reported as the next thing to look for', () => {
  const gd = observerToGeodetic(LONDON);
  // Find a moment when LAGEOS 2 is up, then ask from there.
  const lageos = DERELICTS.find((t) => t.satnum === '22195')!;
  const rec = parseSatrec(lageos)!;
  let upAt: Date | null = null;
  for (let m = 0; m < 1440 && !upAt; m++) {
    const when = new Date(EPOCH.getTime() + m * 60_000);
    const s = skySampleAt(rec, gd, when);
    if (s && s.elevationDeg > 20) upAt = when;
  }
  assert.ok(upAt, 'LAGEOS 2 should be well up at some point in a day');

  const found = nextDerelictRise([lageos], LONDON, upAt, { withinHours: 2 });
  // It is already above the horizon, so within the next two hours there is no
  // *rise* — the answer must not be "now".
  if (found) {
    assert.ok(
      found.time.getTime() > upAt.getTime() + 60_000,
      'a rise must be strictly in the future, not the object already overhead'
    );
  }
});

test('returns null rather than inventing a time when nothing rises in the window', () => {
  // Hubble from well inside the Arctic: inclination 28.5 plus footprint cannot
  // reach it, so no window is long enough.
  const hst: TleRecord = {
    name: 'HST',
    satnum: '20580',
    line1: '1 20580U 90037B   26215.07632950  .00006338  00000+0  19645-3 0  9999',
    line2: '2 20580  28.4731 119.9792 0001799 314.8840  45.1610 15.31251640795763',
  };
  const svalbard: Observer = { latitude: 78.2, longitude: 15.6, elevation: 0 };
  assert.equal(nextDerelictRise([hst], svalbard, EPOCH, { withinHours: 24 }), null);
});

test('a coarser step still lands on the same rise to within its own resolution', () => {
  const fine = nextDerelictRise(DERELICTS, LONDON, EPOCH, { withinHours: 12, stepSeconds: 30 });
  const coarse = nextDerelictRise(DERELICTS, LONDON, EPOCH, { withinHours: 12, stepSeconds: 120 });
  assert.ok(fine && coarse);
  assert.equal(coarse.satnum, fine.satnum);
  const gapMinutes = Math.abs(coarse.time.getTime() - fine.time.getTime()) / 60_000;
  assert.ok(gapMinutes <= 2, `coarse step drifted ${gapMinutes} minutes from the fine one`);
});
