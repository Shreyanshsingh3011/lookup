import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  NASA_LIVE_EMBED_URL,
  NASA_LIVE_WATCH_URL,
  findIss,
  formatCountdown,
  isIssName,
  issSunlight,
  sunlightState,
} from './issStream';
import { parseSatrec, satelliteSunlit } from './sky';
import type { TleRecord } from '../types';

const ISS: TleRecord = {
  name: 'ISS (ZARYA)',
  satnum: '25544',
  line1: '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272',
};

/** Roughly one ISS orbit, from its mean motion of 15.49 revolutions a day. */
const ORBIT_MINUTES = (24 * 60) / 15.49309239;

test('the ISS is recognised by either of its catalogue names', () => {
  assert.ok(isIssName('ISS (ZARYA)'));
  assert.ok(isIssName('ZARYA'));
  assert.ok(isIssName('iss (zarya)'));
  // Must not match things that merely contain the letters.
  assert.equal(isIssName('SWISSCUBE'), false);
  assert.equal(isIssName('TIANGONG'), false);
  assert.equal(isIssName('STARLINK-1234'), false);
});

test('findIss picks the station out of a mixed catalogue', () => {
  const others: TleRecord[] = [
    { ...ISS, name: 'STARLINK-1234', satnum: '44713' },
    { ...ISS, name: 'CSS (TIANHE)', satnum: '48274' },
  ];
  assert.equal(findIss(others), null);
  assert.equal(findIss([...others, ISS])?.satnum, '25544');
});

test('the station passes through sunlight and shadow every orbit', () => {
  const satrec = parseSatrec(ISS);
  assert.ok(satrec);

  // Sample a full orbit and require both states to occur. A satellite in low
  // orbit is eclipsed for a substantial part of every revolution, so anything
  // else would mean the illumination maths is not working at all.
  const start = new Date('2026-07-31T00:00:00Z');
  let lit = 0;
  let dark = 0;
  for (let minute = 0; minute < ORBIT_MINUTES; minute += 1) {
    const state = satelliteSunlit(satrec, new Date(start.getTime() + minute * 60_000));
    assert.notEqual(state, null, `propagation failed at minute ${minute}`);
    if (state) lit++;
    else dark++;
  }
  assert.ok(lit > 0, 'the station should spend part of its orbit in sunlight');
  assert.ok(dark > 0, 'and part of it in Earth’s shadow');
  // Eclipse takes up a substantial minority of a low orbit, never most of it.
  assert.ok(dark / (lit + dark) > 0.15, `shadow fraction looks too small: ${dark / (lit + dark)}`);
  assert.ok(dark / (lit + dark) < 0.5, `shadow fraction looks too large: ${dark / (lit + dark)}`);
});

test('the next illumination change actually flips the state', () => {
  const satrec = parseSatrec(ISS);
  assert.ok(satrec);

  // Check from several starting points around the orbit, so this cannot pass
  // by landing on one convenient moment.
  const base = Date.parse('2026-07-31T00:00:00Z');
  for (let offset = 0; offset < 120; offset += 7) {
    const from = new Date(base + offset * 60_000);
    const { sunlit, changesAt } = sunlightState(satrec, from);
    assert.notEqual(sunlit, null);
    assert.ok(changesAt, `no transition found within two hours from +${offset} min`);

    assert.ok(changesAt.getTime() > from.getTime(), 'a transition must be in the future');
    assert.equal(
      satelliteSunlit(satrec, changesAt),
      !sunlit,
      `state should have flipped by ${changesAt.toISOString()}`
    );
    // And must not have flipped meaningfully before it.
    const justBefore = new Date(changesAt.getTime() - 6_000);
    assert.equal(satelliteSunlit(satrec, justBefore), sunlit, 'flipped earlier than reported');
  }
});

test('a transition is always found well inside one orbit', () => {
  const satrec = parseSatrec(ISS);
  assert.ok(satrec);
  const { changesAt } = sunlightState(satrec, new Date('2026-07-31T00:00:00Z'));
  assert.ok(changesAt);
  const minutesAway = (changesAt.getTime() - Date.parse('2026-07-31T00:00:00Z')) / 60_000;
  assert.ok(
    minutesAway < ORBIT_MINUTES,
    `a light/dark change must come within one orbit, got ${minutesAway} min`
  );
});

test('too short a search window reports no transition rather than inventing one', () => {
  const satrec = parseSatrec(ISS);
  assert.ok(satrec);
  const { sunlit, changesAt } = sunlightState(satrec, new Date('2026-07-31T00:00:00Z'), 0.1);
  assert.notEqual(sunlit, null, 'the current state is still known');
  assert.equal(changesAt, null, 'and no change should be claimed');
});

test('unusable elements give no state instead of a wrong one', () => {
  const broken: TleRecord = { name: 'ISS (ZARYA)', satnum: '25544', line1: 'nonsense', line2: 'nonsense' };
  assert.deepEqual(issSunlight(broken, new Date()), { sunlit: null, changesAt: null });
});

test('the countdown reads the way a person would say it', () => {
  const now = Date.parse('2026-07-31T00:00:00Z');
  assert.equal(formatCountdown(now, now + 10_000), 'any moment');
  assert.equal(formatCountdown(now, now + 4 * 60_000), 'in 4 min');
  assert.equal(formatCountdown(now, now + 59 * 60_000), 'in 59 min');
  assert.equal(formatCountdown(now, now + 72 * 60_000), 'in 1 h 12 min');
});

test('the stream is addressed by channel, not by a video id that rotates', () => {
  // A hardcoded video id would break every time NASA restarts the stream.
  assert.match(NASA_LIVE_EMBED_URL, /live_stream\?channel=UC/);
  assert.match(NASA_LIVE_EMBED_URL, /^https:\/\/www\.youtube-nocookie\.com\//);
  assert.match(NASA_LIVE_WATCH_URL, /^https:\/\/www\.youtube\.com\/channel\/UC/);
});
