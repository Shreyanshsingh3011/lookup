import { strict as assert } from 'node:assert';
import test from 'node:test';
import { decodeShareState, encodeShareState, shareUrl, type ShareState } from './shareUrl';

const GREENWICH = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };

test('a full state survives the round trip', () => {
  const state: ShareState = {
    observer: GREENWICH,
    time: new Date('2026-08-04T21:30:00.000Z'),
    groups: ['stations', 'visual'],
    satnum: '25544',
  };
  const back = decodeShareState(encodeShareState(state));

  assert.deepEqual(back.observer, GREENWICH);
  assert.equal(back.time?.toISOString(), '2026-08-04T21:30:00.000Z');
  assert.deepEqual(back.groups, ['stations', 'visual']);
  assert.equal(back.satnum, '25544');
});

test('an empty state produces an empty query, not a query of empties', () => {
  const empty: ShareState = { observer: null, time: null, groups: null, satnum: null };
  assert.equal(encodeShareState(empty), '');
  assert.deepEqual(decodeShareState(''), empty);
  // A bare URL must decode to "use my own defaults" rather than to nulls that
  // then overwrite them.
  assert.deepEqual(decodeShareState('?'), empty);
});

test('a live view carries no timestamp', () => {
  // Pinning "now" into a link would make it a link to the moment it was
  // copied, which is not what sharing your current sky means.
  const encoded = encodeShareState({
    observer: GREENWICH,
    time: null,
    groups: null,
    satnum: null,
  });
  // Checked as a parameter, not a substring: 'alt=45' contains "t=".
  assert.ok(!new URLSearchParams(encoded).has('t'), `time leaked into ${encoded}`);
  assert.equal(decodeShareState(encoded).time, null);
});

test('coordinates are rounded so a link is not somebody’s doorstep', () => {
  const precise = { latitude: 51.476912345678, longitude: -0.000512345678, elevation: 45 };
  const encoded = encodeShareState({ observer: precise, time: null, groups: null, satnum: null });
  const back = decodeShareState(encoded).observer!;
  // Four decimals is about eleven metres: fine enough for any of this, coarse
  // enough not to publish an exact address.
  assert.equal(back.latitude, 51.4769);
  assert.equal(back.longitude, -0.0005);
  assert.ok(Math.abs(back.latitude - precise.latitude) < 0.0001);
});

test('half a coordinate is no coordinate', () => {
  // Latitude 51 with a missing longitude is not a place, and applying it would
  // silently move the observer to the prime meridian.
  assert.equal(decodeShareState('lat=51.5').observer, null);
  assert.equal(decodeShareState('lon=-0.1').observer, null);
  assert.equal(decodeShareState('lat=51.5&lon=notanumber').observer, null);
});

test('out-of-range coordinates are refused rather than clamped', () => {
  // Clamping would put someone at the pole and show them a sky that is not
  // theirs, with nothing to indicate the link was broken.
  assert.equal(decodeShareState('lat=91&lon=0').observer, null);
  assert.equal(decodeShareState('lat=0&lon=181').observer, null);
  assert.equal(decodeShareState('lat=-90.1&lon=0').observer, null);
  // The exact limits are legitimate.
  assert.ok(decodeShareState('lat=90&lon=180').observer);
  assert.ok(decodeShareState('lat=-90&lon=-180').observer);
});

test('an absurd elevation falls back to sea level instead of skewing every angle', () => {
  assert.equal(decodeShareState('lat=51&lon=0&alt=99999').observer?.elevation, 0);
  assert.equal(decodeShareState('lat=51&lon=0&alt=-9999').observer?.elevation, 0);
  assert.equal(decodeShareState('lat=51&lon=0&alt=abc').observer?.elevation, 0);
  // Real places still work: the Dead Sea shore and a Himalayan base camp.
  assert.equal(decodeShareState('lat=31.5&lon=35.5&alt=-430').observer?.elevation, -430);
  assert.equal(decodeShareState('lat=28&lon=86.9&alt=5364').observer?.elevation, 5364);
});

test('a malformed time is dropped, leaving the view live', () => {
  assert.equal(decodeShareState('t=yesterday').time, null);
  assert.equal(decodeShareState('t=').time, null);
  assert.ok(decodeShareState('t=2026-08-04T21:30:00Z').time instanceof Date);
});

test('group ids that could not be group ids never reach the API', () => {
  assert.deepEqual(decodeShareState('groups=stations,visual').groups, ['stations', 'visual']);
  // Whitespace and empties are tidied.
  assert.deepEqual(decodeShareState('groups=stations, visual ,').groups, ['stations', 'visual']);
  // Anything that is not a plausible id is dropped before it can be requested.
  assert.deepEqual(decodeShareState('groups=stations,../../etc/passwd').groups, ['stations']);
  assert.deepEqual(decodeShareState('groups=<script>').groups, null);
  assert.equal(decodeShareState('groups=').groups, null);
});

test('a satellite id must look like a catalogue number', () => {
  assert.equal(decodeShareState('sat=25544').satnum, '25544');
  assert.equal(decodeShareState('sat=abc').satnum, null);
  assert.equal(decodeShareState('sat=25544; DROP TABLE').satnum, null);
  assert.equal(decodeShareState('sat=').satnum, null);
});

test('the share URL replaces the query and drops any fragment', () => {
  const url = shareUrl(
    { observer: GREENWICH, time: null, groups: ['visual'], satnum: null },
    'https://lookup.example/app?stale=1#somewhere'
  );
  assert.ok(url.startsWith('https://lookup.example/app?'));
  assert.ok(!url.includes('stale=1'), 'a previous query must not survive');
  assert.ok(!url.includes('#'), 'a fragment would be carried into the shared link');
  assert.ok(url.includes('groups=visual'));

  // And the result must itself decode back to what was shared.
  const back = decodeShareState(new URL(url).search);
  assert.deepEqual(back.groups, ['visual']);
  assert.deepEqual(back.observer, GREENWICH);
});
