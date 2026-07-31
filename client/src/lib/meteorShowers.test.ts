import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  DARK_SKY_LIMITING_MAGNITUDE,
  METEOR_SHOWERS,
  SUBURBAN_LIMITING_MAGNITUDE,
  activeShowers,
  daysFromPeak,
  describePeak,
  describeRate,
  expectedRateRange,
  moonInterference,
  observedRatePerHour,
  showerActivity,
} from './meteorShowers';

const shower = (id: string) => {
  const found = METEOR_SHOWERS.find((s) => s.id === id);
  assert.ok(found, `no shower ${id}`);
  return found;
};

test('the Perseids peak in mid-August and are dormant in winter', () => {
  const perseids = shower('PER');
  assert.equal(Math.round(daysFromPeak(perseids, new Date('2026-08-12T22:00:00Z'))), 0);
  assert.ok(showerActivity(perseids, new Date('2026-08-12T22:00:00Z')));
  assert.equal(showerActivity(perseids, new Date('2026-02-01T22:00:00Z')), null);
});

test('showers spanning new year find the nearest peak in either direction', () => {
  // The Quadrantids peak on 3 January. On 30 December the peak is four days
  // away, not three hundred and sixty.
  const quadrantids = shower('QUA');
  const dec30 = new Date('2025-12-30T22:00:00Z');
  assert.ok(Math.abs(daysFromPeak(quadrantids, dec30) + 4) < 1);
  assert.ok(showerActivity(quadrantids, dec30), 'should be active before new year');

  // And still active a few days after.
  assert.ok(showerActivity(quadrantids, new Date('2026-01-08T22:00:00Z')));
  assert.equal(showerActivity(quadrantids, new Date('2026-01-20T22:00:00Z')), null);

  // The Ursids peak on 22 December and must not be confused with next year's.
  const ursids = shower('URS');
  assert.ok(Math.abs(daysFromPeak(ursids, new Date('2026-12-23T22:00:00Z')) - 1) < 1);
});

test('leap years do not shift a peak by a day', () => {
  const geminids = shower('GEM');
  const inLeapYear = daysFromPeak(geminids, new Date('2028-12-14T12:00:00Z'));
  const inCommonYear = daysFromPeak(geminids, new Date('2027-12-14T12:00:00Z'));
  assert.ok(Math.abs(inLeapYear) < 0.01, `leap year off by ${inLeapYear}`);
  assert.ok(Math.abs(inCommonYear) < 0.01, `common year off by ${inCommonYear}`);
});

test('activity falls by half over the profile half-width', () => {
  const geminids = shower('GEM');
  const atPeak = showerActivity(geminids, new Date('2026-12-14T12:00:00Z'));
  const offPeak = showerActivity(
    geminids,
    new Date(Date.UTC(2026, 11, 14, 12) + geminids.halfWidthDays * 86_400_000)
  );
  assert.ok(atPeak && offPeak);
  assert.ok(Math.abs(atPeak.zhrNow - geminids.zhr) < 0.5);
  assert.ok(
    Math.abs(offPeak.zhrNow - geminids.zhr / 2) < 0.5,
    `expected half of ${geminids.zhr}, got ${offPeak.zhrNow}`
  );
});

test('a radiant below the horizon yields no meteors', () => {
  assert.equal(observedRatePerHour(100, -5, DARK_SKY_LIMITING_MAGNITUDE, 2.2), 0);
  assert.equal(observedRatePerHour(100, 0, DARK_SKY_LIMITING_MAGNITUDE, 2.2), 0);
});

test('ZHR is only achieved with the radiant overhead under a perfect sky', () => {
  // At the zenith with lm 6.5 the corrections are both unity by definition.
  const ideal = observedRatePerHour(100, 90, DARK_SKY_LIMITING_MAGNITUDE, 2.2);
  assert.ok(Math.abs(ideal - 100) < 1e-9, `expected 100, got ${ideal}`);

  // A radiant 30 degrees up halves it, which is the sine and nothing else.
  const low = observedRatePerHour(100, 30, DARK_SKY_LIMITING_MAGNITUDE, 2.2);
  assert.ok(Math.abs(low - 50) < 1e-9, `expected 50, got ${low}`);
});

test('light pollution costs more for showers rich in faint meteors', () => {
  // Same ZHR and geometry; only the population index differs.
  const faintRich = observedRatePerHour(100, 90, SUBURBAN_LIMITING_MAGNITUDE, 3.2);
  const brightRich = observedRatePerHour(100, 90, SUBURBAN_LIMITING_MAGNITUDE, 2.1);
  assert.ok(
    faintRich < brightRich,
    `a higher population index should suffer more: ${faintRich} vs ${brightRich}`
  );
  assert.ok(brightRich < 100, 'a suburban sky must cost something');
});

test('the quoted range brackets suburban and dark skies', () => {
  const activity = showerActivity(shower('PER'), new Date('2026-08-12T22:00:00Z'));
  assert.ok(activity);
  const range = expectedRateRange(activity, 60);
  assert.ok(range.low < range.high, 'the low end must be the worse sky');
  assert.ok(range.high <= activity.zhrNow, 'no sky beats the zenithal rate');
  assert.ok(range.low > 0);
});

test('active showers are ranked by current strength, not nominal peak', () => {
  // Mid-November genuinely overlaps: the Leonids at peak alongside both
  // Taurid branches, which run for months at a low rate.
  const list = activeShowers(new Date('2026-11-17T22:00:00Z'));
  assert.ok(list.length >= 3, `expected several overlapping showers, got ${list.length}`);
  assert.equal(list[0].shower.id, 'LEO', 'the shower at its peak should lead');
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].zhrNow >= list[i].zhrNow, 'list should be sorted by strength');
  }

  // On its own peak night the Geminids are the only shower running at all,
  // which the windows should reflect rather than padding the list.
  const geminidNight = activeShowers(new Date('2026-12-14T22:00:00Z'));
  assert.equal(geminidNight.length, 1);
  assert.equal(geminidNight[0].shower.id, 'GEM');
});

test('moon interference tracks both phase and altitude', () => {
  assert.equal(moonInterference(1, -10), 'none', 'a set Moon cannot interfere');
  assert.equal(moonInterference(0.02, 40), 'slight', 'a thin crescent barely matters');
  assert.equal(moonInterference(1, 60), 'severe', 'a full Moon high up ruins it');
  assert.equal(moonInterference(null, 40), 'none', 'unknown phase should not invent a verdict');

  // The same phase lower in the sky is no worse than higher up.
  const high = moonInterference(0.75, 70);
  const low = moonInterference(0.75, 5);
  const order = { none: 0, slight: 1, moderate: 2, severe: 3 };
  assert.ok(order[low] <= order[high]);
});

test('sub-one rates are described, not rounded to a promise of nothing', () => {
  // Rounding 0.4-1.3 to "0-1 an hour" reads as "you will see nothing", which
  // is not what the low end of the range means.
  assert.equal(describeRate({ low: 0.4, high: 1.3 }), 'up to 1 an hour');
  assert.equal(describeRate({ low: 0.1, high: 0.6 }), 'under 1 an hour');
  assert.equal(describeRate({ low: 3.2, high: 11.8 }), '~3–12 an hour');
  // A degenerate range should not read as "~5–5".
  assert.equal(describeRate({ low: 4.6, high: 5.2 }), '~5 an hour');
});

test('peak descriptions read naturally either side of the night', () => {
  assert.equal(describePeak(0), 'peaks tonight');
  assert.equal(describePeak(-1), 'peaks tomorrow');
  assert.equal(describePeak(-3), 'peaks in 3 days');
  assert.equal(describePeak(1), 'peaked last night');
  assert.equal(describePeak(4), 'peaked 4 days ago');
});

test('every shower has a plausible radiant and profile', () => {
  const ids = new Set<string>();
  for (const s of METEOR_SHOWERS) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.radiantRaDeg >= 0 && s.radiantRaDeg < 360, `${s.id} radiant RA`);
    assert.ok(s.radiantDecDeg >= -90 && s.radiantDecDeg <= 90, `${s.id} radiant Dec`);
    assert.ok(s.peak[0] >= 1 && s.peak[0] <= 12, `${s.id} peak month`);
    assert.ok(s.peak[1] >= 1 && s.peak[1] <= 31, `${s.id} peak day`);
    assert.ok(s.halfWidthDays > 0, `${s.id} half-width must be positive`);
    // A half-width wider than the active window would mean the shower never
    // meaningfully falls off, which is a data error rather than a real profile.
    assert.ok(
      s.halfWidthDays <= Math.max(s.activeBeforeDays, s.activeAfterDays),
      `${s.id} half-width exceeds its own active window`
    );
    assert.ok(s.populationIndex > 1.5 && s.populationIndex < 4, `${s.id} population index`);
    assert.ok(s.speedKmS > 10 && s.speedKmS < 80, `${s.id} entry speed`);
  }
});

test('at most a few showers run at once, and something runs most nights', () => {
  // Sanity on the windows as a whole: overlapping everything would mean the
  // data is wrong, and long dead stretches would suggest a missing shower.
  let emptyNights = 0;
  for (let day = 0; day < 365; day++) {
    const date = new Date(Date.UTC(2026, 0, 1 + day, 22));
    const list = activeShowers(date);
    assert.ok(list.length <= 5, `${date.toISOString()} has ${list.length} showers at once`);
    if (list.length === 0) emptyNights++;
  }
  assert.ok(emptyNights > 0, 'some nights genuinely have no active shower');
  assert.ok(emptyNights < 180, `too much of the year is dead: ${emptyNights} nights`);
});
