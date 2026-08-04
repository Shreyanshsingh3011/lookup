import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  FOREIGN_CLOCK_HOURS,
  assessTonight,
  clockIsForeign,
  clockOffsetHours,
  darknessWindow,
  judge,
  moonConditions,
  moonPhaseName,
  passesTonight,
  TWILIGHT_ALTITUDES,
} from './tonight';
import type { Pass } from '../types';

const LONDON = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };
const SINGAPORE = { latitude: 1.35, longitude: 103.8, elevation: 0 };
const TROMSO = { latitude: 69.65, longitude: 18.96, elevation: 0 };

const WINTER = new Date('2026-12-15T15:00:00Z');
const MIDSUMMER = new Date('2026-06-21T12:00:00Z');

function pass(name: string, time: string, magnitude: number, cloud: number | null = null): Pass {
  const event = { time, azimuthDeg: 180, altitudeDeg: 45, direction: 'S', magnitude };
  return {
    satnum: '25544',
    name,
    start: event,
    max: event,
    end: event,
    magnitude,
    durationSeconds: 300,
    endReason: 'set',
    ...(cloud === null ? {} : { cloudCoverPercent: cloud }),
  } as Pass;
}

test('the dark window is bounded by the twilight it claims', () => {
  // Whatever comes back must actually have the Sun below the stated altitude
  // for its whole span, or the window is a fiction.
  const window = darknessWindow(LONDON, WINTER, 'astronomical')!;
  assert.ok(window, 'London in December certainly gets astronomically dark');
  assert.ok(window.end > window.start);
  assert.ok(Math.abs(window.hours - (window.end.getTime() - window.start.getTime()) / 3_600_000) < 1e-9);
  // A December night in London: dark for a good many hours.
  assert.ok(window.hours > 8 && window.hours < 15, `got ${window.hours.toFixed(1)} h`);
  assert.equal(window.kind, 'astronomical');
});

test('deeper twilight always gives a shorter window', () => {
  // Nested by definition: the Sun is below -18 for less of the night than it
  // is below -6. If this inverted, the twilight altitudes would be swapped.
  const civil = darknessWindow(LONDON, WINTER, 'civil')!;
  const nautical = darknessWindow(LONDON, WINTER, 'nautical')!;
  const astronomical = darknessWindow(LONDON, WINTER, 'astronomical')!;
  assert.ok(civil.hours > nautical.hours, 'civil must be the longest');
  assert.ok(nautical.hours > astronomical.hours, 'astronomical must be the shortest');
  assert.ok(TWILIGHT_ALTITUDES.civil > TWILIGHT_ALTITUDES.astronomical);
});

test('a place where it never gets dark says so rather than inventing a window', () => {
  // Tromsø in midsummer is inside the midnight sun. Reporting some window
  // anyway would send someone out at 1 a.m. to look at a bright blue sky.
  assert.equal(darknessWindow(TROMSO, MIDSUMMER, 'astronomical'), null);
  assert.equal(darknessWindow(TROMSO, MIDSUMMER, 'civil'), null);

  const conditions = assessTonight(TROMSO, [], MIDSUMMER);
  assert.equal(conditions.darkness, null);
  assert.equal(conditions.fallbackDarkness, null);
  assert.equal(conditions.verdict, 'poor');
  assert.ok(
    conditions.reasons.some((r) => /does not get dark/.test(r)),
    `reasons were ${JSON.stringify(conditions.reasons)}`
  );
});

test('a short summer night falls back to shallower twilight rather than nothing', () => {
  // London in midsummer never reaches astronomical darkness — the Sun stays
  // above -18 all night — but it does get nautically dark, and saying "no
  // darkness" there would be wrong in a way anyone outside could see.
  assert.equal(darknessWindow(LONDON, MIDSUMMER, 'astronomical'), null);
  const conditions = assessTonight(LONDON, [], MIDSUMMER);
  assert.equal(conditions.darkness, null);
  assert.ok(conditions.fallbackDarkness, 'a shallower window must be offered');
  assert.ok(['nautical', 'civil'].includes(conditions.fallbackDarkness!.kind));
  assert.ok(conditions.reasons.some((r) => /never gets fully dark/.test(r)));
});

test('the tropics get a long dark night all year', () => {
  for (const when of [WINTER, MIDSUMMER]) {
    const window = darknessWindow(SINGAPORE, when, 'astronomical')!;
    assert.ok(window, `Singapore must get dark on ${when.toISOString().slice(0, 10)}`);
    assert.ok(window.hours > 8, `got ${window.hours.toFixed(1)} h`);
  }
});

test('moon phase names line up with the phase angle', () => {
  assert.equal(moonPhaseName(0), 'new');
  assert.equal(moonPhaseName(90), 'first quarter');
  assert.equal(moonPhaseName(180), 'full');
  assert.equal(moonPhaseName(270), 'last quarter');
  assert.equal(moonPhaseName(45), 'waxing crescent');
  assert.equal(moonPhaseName(135), 'waxing gibbous');
  assert.equal(moonPhaseName(225), 'waning gibbous');
  assert.equal(moonPhaseName(315), 'waning crescent');
  // The wrap must not fall into a gap.
  assert.equal(moonPhaseName(359), 'new');
  assert.equal(moonPhaseName(360), 'new');
});

test('the Moon is only a problem when it is actually up', () => {
  const window = darknessWindow(LONDON, WINTER, 'astronomical')!;
  const moon = moonConditions(LONDON, window, WINTER);
  assert.ok(moon.illumination >= 0 && moon.illumination <= 1);
  assert.ok(moon.phaseName.length > 0);

  // A Moon below the horizon all night cannot interfere however full it is.
  const buried = moonConditions(LONDON, null, WINTER);
  assert.equal(buried.peakElevationDeg, null);
  assert.equal(buried.interference, 'none');
});

test('only passes inside the dark window count, brightest first', () => {
  const window = {
    start: new Date('2026-12-15T17:00:00Z'),
    end: new Date('2026-12-16T06:00:00Z'),
    kind: 'astronomical' as const,
    hours: 13,
  };
  const all = [
    pass('DAYTIME', '2026-12-15T12:00:00Z', -2),   // bright but in daylight
    pass('FAINT', '2026-12-15T20:00:00Z', 3.2),
    pass('BRIGHT', '2026-12-15T22:00:00Z', -1.8),
    pass('AFTER DAWN', '2026-12-16T09:00:00Z', -3),
  ];
  const tonight = passesTonight(all, window);
  assert.deepEqual(tonight.map((p) => p.name), ['BRIGHT', 'FAINT']);
  // No window means nothing to catch, not everything.
  assert.deepEqual(passesTonight(all, null), []);
});

test('cloud outranks everything else', () => {
  const window = { start: new Date(), end: new Date(Date.now() + 8 * 3.6e6), kind: 'astronomical' as const, hours: 8 };
  const clearMoon = { illumination: 0, phaseName: 'new', rise: null, set: null, peakElevationDeg: null, interference: 'none' as const };

  // A perfect night under solid overcast is still not worth going outside.
  const overcast = judge(window, null, clearMoon, 95, [pass('ISS', new Date().toISOString(), -3)]);
  assert.equal(overcast.verdict, 'poor');
  assert.ok(overcast.reasons.some((r) => /will not see through/.test(r)));

  // The same night clear is the best it gets.
  const clear = judge(window, null, clearMoon, 5, [pass('ISS', new Date().toISOString(), -3)]);
  assert.equal(clear.verdict, 'excellent');
  assert.ok(clear.reasons.some((r) => /sky should be open/.test(r)));
});

test('a verdict always explains itself', () => {
  // An unexplained verdict cannot be argued with, only disbelieved, which for
  // a forecast built on a twelve-hour cloud guess is the wrong relationship.
  for (const [observer, when] of [
    [LONDON, WINTER],
    [LONDON, MIDSUMMER],
    [TROMSO, MIDSUMMER],
    [SINGAPORE, WINTER],
  ] as const) {
    const conditions = assessTonight(observer, [pass('ISS', when.toISOString(), -2, 30)], when);
    assert.ok(conditions.reasons.length > 0, `no reasons at ${observer.latitude} on ${when.toISOString()}`);
    assert.ok(['excellent', 'good', 'fair', 'poor'].includes(conditions.verdict));
    for (const reason of conditions.reasons) {
      assert.ok(reason.length > 0 && !/undefined|NaN|null/.test(reason), `bad reason: ${reason}`);
    }
  }
});

test('a missing forecast is not treated as a clear sky', () => {
  // Open-Meteo failing must not read as "0% cloud, go outside".
  const window = { start: new Date(), end: new Date(Date.now() + 8 * 3.6e6), kind: 'astronomical' as const, hours: 8 };
  const moon = { illumination: 0, phaseName: 'new', rise: null, set: null, peakElevationDeg: null, interference: 'none' as const };
  const { reasons } = judge(window, null, moon, null, [pass('ISS', new Date().toISOString(), -3)]);
  assert.ok(!reasons.some((r) => /cloud/.test(r)), `cloud claimed without a forecast: ${JSON.stringify(reasons)}`);

  const conditions = assessTonight(LONDON, [pass('ISS', WINTER.toISOString(), -2)], WINTER);
  assert.equal(conditions.cloudCoverPercent, null);
});

test('a night on the other side of the world is flagged as being on your clock', () => {
  // Every time here renders on the reader's clock. That was invisible while
  // everyone looked at their own sky, and became misleading the moment a link
  // could drop you into somebody else's night.
  const utcViewer = new Date('2026-01-15T12:00:00Z'); // getTimezoneOffset() is 0 in CI
  assert.equal(clockIsForeign(-0.0005, utcViewer), false, 'your own longitude is not foreign');
  assert.equal(clockIsForeign(103.8, utcViewer), true, 'Singapore from UTC certainly is');
  assert.equal(clockIsForeign(-74, utcViewer), true, 'and so is New York');

  // The offset is signed the way a reader would say it: east is ahead.
  assert.ok(clockOffsetHours(103.8, utcViewer) > 6, 'Singapore runs ahead of UTC');
  assert.ok(clockOffsetHours(-74, utcViewer) < -4, 'New York runs behind it');

  // The threshold is a warning boundary, not a claim about civil time: solar
  // time is all longitude can give, and political zones wander from it.
  assert.equal(clockIsForeign(FOREIGN_CLOCK_HOURS * 15 - 1, utcViewer), false);
  assert.equal(clockIsForeign(FOREIGN_CLOCK_HOURS * 15 + 1, utcViewer), true);
});
