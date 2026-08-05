import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as satellite from 'satellite.js';
import {
  MAX_USEFUL_ALTITUDE_KM,
  MIN_USEFUL_PERIGEE_KM,
  assessFreshness,
  assessReach,
  assessRisk,
  inclinationDeg,
  preFilter,
  tleAgeDays,
  tleEpoch,
} from './debris';
import type { TleRecord } from '../types';

const LONDON = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };
const SVALBARD = { latitude: 78.22, longitude: 15.63, elevation: 0 };
const SINGAPORE = { latitude: 1.35, longitude: 103.8, elevation: 0 };

function checksum(line: string): string {
  let sum = 0;
  for (const c of line.slice(0, 68)) {
    if (c >= '0' && c <= '9') sum += Number(c);
    else if (c === '-') sum += 1;
  }
  return line.slice(0, 68) + (sum % 10);
}

/**
 * Build a TLE with the inclination, mean motion, eccentricity and epoch we
 * want. Real element sets are used where a real object is the point; these
 * exist to put the pre-filter at a chosen place in parameter space.
 */
function makeTle({
  satnum = '99999',
  name = 'TEST DEB',
  inclination = 51.6,
  meanMotion = 15.5,
  eccentricity = 0.0001,
  epochYear = 26,
  epochDay = 212.5,
}: Partial<{
  satnum: string;
  name: string;
  inclination: number;
  meanMotion: number;
  eccentricity: number;
  epochYear: number;
  epochDay: number;
}> = {}): TleRecord {
  const ecc = String(Math.round(eccentricity * 1e7)).padStart(7, '0');
  const line1 = checksum(
    `1 ${satnum.padStart(5, '0')}U 98067A   ${String(epochYear).padStart(2, '0')}${epochDay
      .toFixed(8)
      .padStart(12, '0')}  .00000000  00000-0  00000-0 0  999`
  );
  const line2 = checksum(
    `2 ${satnum.padStart(5, '0')} ${inclination.toFixed(4).padStart(8)} 100.0000 ${ecc} 100.0000 260.0000 ${meanMotion
      .toFixed(8)
      .padStart(11)}    0`
  );
  return { name, satnum, line1, line2 };
}

test('the synthetic element sets are real ones SGP4 accepts', () => {
  // Everything below rests on these parsing, so this fails loudly rather than
  // letting every other test pass vacuously against garbage.
  const tle = makeTle();
  const rec = satellite.twoline2satrec(tle.line1, tle.line2);
  assert.equal(rec.error, 0, 'the generated TLE must parse');
  assert.ok(satellite.propagate(rec, new Date('2026-07-31T12:00:00Z')), 'and must propagate');
  assert.ok(Math.abs(inclinationDeg(tle) - 51.6) < 0.001);
});

test('an orbit that never reaches your latitude is rejected without propagating', () => {
  // The whole saving. A 51.6 degree orbit at 400 km reaches 51.6 degrees of
  // latitude plus about 19 degrees of footprint — so it is visible from London
  // and from Singapore, and never from Svalbard.
  const iss = makeTle({ inclination: 51.6, meanMotion: 15.5 });

  assert.equal(assessReach(iss, LONDON).reachable, true);
  assert.equal(assessReach(iss, SINGAPORE).reachable, true);

  const far = assessReach(iss, SVALBARD);
  assert.equal(far.reachable, false);
  assert.equal(far.reason, 'never-rises');
  assert.ok(far.groundTrackLimitDeg + far.footprintDeg < 78.22);
});

test('retrograde orbits are folded, not taken at face value', () => {
  // Past 90 degrees a ground track leans back toward the equator: an orbit
  // inclined 98 reaches 82 of latitude, and one inclined 160 reaches only 20.
  const sso = assessReach(makeTle({ inclination: 98.2, meanMotion: 14.5 }), SVALBARD);
  assert.ok(Math.abs(sso.groundTrackLimitDeg - 81.8) < 0.1, `limit was ${sso.groundTrackLimitDeg}`);
  // Svalbard sits inside that limit plus the object's footprint, so it really
  // is visible from there — the fold is not an excuse to reject everything.
  assert.equal(sso.reachable, true);

  // The case where the fold decides the answer: a low 160 degree orbit reaches
  // 20 degrees of latitude and is seen about 20 further, so 45 degrees north
  // is out of reach. Compared against the raw inclination it would have looked
  // comfortably reachable, and every one of its fragments would then have been
  // propagated for nothing.
  const site = { latitude: 45, longitude: 0, elevation: 0 };
  const steep = assessReach(makeTle({ inclination: 160, meanMotion: 15.5 }), site);
  assert.ok(Math.abs(steep.groundTrackLimitDeg - 20) < 0.1, `limit was ${steep.groundTrackLimitDeg}`);
  assert.ok(steep.groundTrackLimitDeg + steep.footprintDeg < site.latitude, 'genuinely out of reach');
  assert.equal(steep.reachable, false);
  assert.equal(steep.reason, 'never-rises');
  assert.ok(site.latitude < 160, 'the raw inclination would have admitted this observer');
});

test('the footprint uses apogee, so eccentric orbits are not thrown away', () => {
  // A Molniya-like orbit spends most of its time very high and is seen from
  // far outside its ground track. Judging it on perigee would discard real
  // passes.
  const molniya = makeTle({ inclination: 63.4, meanMotion: 2.006, eccentricity: 0.74 });
  const assessment = assessReach(molniya, LONDON);
  assert.ok(assessment.apogeeAltitudeKm > 35_000, `apogee ${assessment.apogeeAltitudeKm.toFixed(0)} km`);
  assert.ok(assessment.footprintDeg > 70, `footprint ${assessment.footprintDeg.toFixed(1)}°`);
});

test('orbits outside the useful band are rejected on altitude', () => {
  // Too low to have usable elements...
  const skimming = assessReach(makeTle({ meanMotion: 16.6 }), LONDON);
  assert.ok(skimming.perigeeAltitudeKm < MIN_USEFUL_PERIGEE_KM, `perigee ${skimming.perigeeAltitudeKm.toFixed(0)}`);
  assert.equal(skimming.reason, 'too-low');

  // ...and too high to produce the discrete passes this app reports.
  const geo = assessReach(makeTle({ inclination: 0.05, meanMotion: 1.0027 }), LONDON);
  assert.ok(geo.perigeeAltitudeKm > MAX_USEFUL_ALTITUDE_KM);
  assert.equal(geo.reason, 'too-high');
});

test('unreadable elements are rejected rather than crashing the filter', () => {
  const broken: TleRecord = { name: 'JUNK', satnum: '1', line1: 'nonsense', line2: 'also nonsense' };
  const assessment = assessReach(broken, LONDON);
  assert.equal(assessment.reachable, false);
  assert.equal(assessment.reason, 'unreadable');
  // And one bad record must not take the batch with it.
  const result = preFilter([broken, makeTle()], LONDON);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.rejected.unreadable, 1);
});

test('the pre-filter accounts for every object it was given', () => {
  const catalogue = [
    makeTle({ satnum: '1', inclination: 51.6 }),          // reachable from London
    makeTle({ satnum: '2', inclination: 20 }),            // never rises there
    makeTle({ satnum: '3', meanMotion: 16.6 }),           // too low
    makeTle({ satnum: '4', inclination: 0.05, meanMotion: 1.0027 }), // too high
    { name: 'JUNK', satnum: '5', line1: 'x', line2: 'y' },
  ];
  const result = preFilter(catalogue, LONDON);
  const rejectedTotal = Object.values(result.rejected).reduce((a, b) => a + b, 0);

  assert.equal(result.examined, catalogue.length);
  assert.equal(result.candidates.length + rejectedTotal, catalogue.length, 'nothing may be lost');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.rejected['never-rises'], 1);
});

test('the pre-filter is orders of magnitude cheaper than propagating', () => {
  // The reason it exists. A debris catalogue is ten thousand objects against a
  // pass search that costs milliseconds each; the filter has to be so cheap
  // that running it is obviously better than not.
  const catalogue = Array.from({ length: 10_000 }, (_, i) =>
    makeTle({ satnum: String(10_000 + i), inclination: (i % 180) })
  );

  const start = performance.now();
  const result = preFilter(catalogue, LONDON);
  const filterMs = performance.now() - start;

  assert.equal(result.examined, 10_000);
  assert.ok(result.candidates.length > 0, 'some of a spread of inclinations must be reachable');
  assert.ok(result.candidates.length < 10_000, 'and some must not be');
  assert.ok(filterMs < 500, `filtering 10,000 objects took ${filterMs.toFixed(0)} ms`);

  // Compare against the cost of a single SGP4 propagation each, which is the
  // cheapest possible lower bound on what the pass search would do.
  const propagateStart = performance.now();
  const when = new Date('2026-07-31T12:00:00Z');
  for (const tle of catalogue) {
    const rec = satellite.twoline2satrec(tle.line1, tle.line2);
    if (!rec.error) satellite.propagate(rec, when);
  }
  const oneSampleMs = performance.now() - propagateStart;

  assert.ok(
    filterMs < oneSampleMs,
    `filter ${filterMs.toFixed(0)} ms vs a single propagation each ${oneSampleMs.toFixed(0)} ms — ` +
      'the filter must cost less than one sample, when the search takes thousands'
  );
});

test('the TLE epoch is read, including for objects older than the two-digit wrap', () => {
  // The convention is 57-99 for the 1900s and 00-56 for the 2000s, which is
  // why a 1963 Atlas Centaur still parses rather than landing in 2063.
  const modern = tleEpoch(makeTle({ epochYear: 26, epochDay: 212.5 }))!;
  assert.equal(modern.toISOString().slice(0, 10), '2026-07-31');

  const old = tleEpoch(makeTle({ epochYear: 63, epochDay: 100.0 }))!;
  assert.equal(old.getUTCFullYear(), 1963);

  assert.equal(tleEpoch({ name: 'x', satnum: '1', line1: 'junk', line2: 'junk' }), null);
});

test('TLE age is measured from the epoch, not from when it was downloaded', () => {
  const tle = makeTle({ epochYear: 26, epochDay: 212.5 });
  const age = tleAgeDays(tle, new Date('2026-08-10T12:00:00Z'))!;
  assert.ok(Math.abs(age - 10) < 0.01, `age came out ${age.toFixed(3)} days`);
});

test('freshness thresholds move with altitude, because drag does', () => {
  // A week-old element set for a 250 km fragment is worthless while the same
  // age for a high rocket body is fine. One threshold for everything would be
  // wrong at both ends.
  const now = new Date('2026-08-10T12:00:00Z');
  const low = makeTle({ meanMotion: 16.0, epochYear: 26, epochDay: 212.5 });   // ~250 km
  const high = makeTle({ meanMotion: 13.4, epochYear: 26, epochDay: 212.5 });  // ~1300 km

  const order = ['fresh', 'ageing', 'stale', 'unusable'];
  const lowFreshness = assessFreshness(low, now);
  const highFreshness = assessFreshness(high, now);

  assert.ok(
    order.indexOf(lowFreshness.level) > order.indexOf(highFreshness.level),
    `same age, but low read ${lowFreshness.level} and high read ${highFreshness.level}`
  );
  assert.ok(
    ['stale', 'unusable'].includes(lowFreshness.level),
    `a 10-day-old 250 km fragment should not be trusted, got ${lowFreshness.level}`
  );
  assert.ok(
    ['fresh', 'ageing'].includes(highFreshness.level),
    `a 10-day-old 1300 km body is still usable, got ${highFreshness.level}`
  );
});

test('fresh elements read fresh and ancient ones read unusable', () => {
  const now = new Date('2026-08-01T00:00:00Z');
  assert.equal(assessFreshness(makeTle({ epochYear: 26, epochDay: 212.5 }), now).level, 'fresh');
  // Two years old.
  assert.equal(assessFreshness(makeTle({ epochYear: 24, epochDay: 212.5 }), now).level, 'unusable');
});

test('an epoch in the future is tolerated slightly and refused beyond that', () => {
  const now = new Date('2026-07-31T00:00:00Z');
  // Elements are sometimes published a little ahead of the clock.
  assert.equal(assessFreshness(makeTle({ epochYear: 26, epochDay: 212.5 }), now).level, 'fresh');
  // A year ahead is a bad parse, not a prediction.
  assert.equal(assessFreshness(makeTle({ epochYear: 27, epochDay: 212.5 }), now).level, 'unusable');
});

test('risk reports whichever problem is worse, and stays quiet when there is none', () => {
  const now = new Date('2026-08-01T00:00:00Z');

  // A healthy, recent, high object needs no warning at all.
  const healthy = assessRisk(makeTle({ meanMotion: 13.4, epochYear: 26, epochDay: 212.5 }), now);
  assert.equal(healthy.unreliable, false);
  assert.equal(healthy.summary, null, 'a fine object must not be warned about');
  assert.equal(healthy.freshness.level, 'fresh');

  // Ancient elements are flagged as unusable whatever the orbit.
  const ancient = assessRisk(makeTle({ meanMotion: 13.4, epochYear: 22, epochDay: 100 }), now);
  assert.equal(ancient.unreliable, true);
  assert.ok(ancient.summary && ancient.summary.length > 0, 'an unreliable object must explain itself');
});

test('every level of freshness carries a note a reader can act on', () => {
  const now = new Date('2026-08-01T00:00:00Z');
  // A high orbit, at ages chosen to land in each band in turn: its thresholds
  // are 6, 14 and 42 days.
  const seen = new Set<string>();
  for (const ageDays of [1, 10, 30, 100]) {
    const epochDay = 213 - ageDays;
    const freshness = assessFreshness(makeTle({ meanMotion: 13.4, epochDay, epochYear: 26 }), now);
    seen.add(freshness.level);
    assert.ok(freshness.note.length > 0, `${freshness.level} has no note`);
    assert.ok(!/undefined|NaN|null/.test(freshness.note), `bad note: ${freshness.note}`);
  }
  assert.deepEqual(
    [...seen],
    ['fresh', 'ageing', 'stale', 'unusable'],
    'each age band must be reachable and distinct'
  );
});
