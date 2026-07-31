import { strict as assert } from 'node:assert';
import test from 'node:test';
import { describeFrameAge, frameIsStale } from './earthImagery';

const NOW = new Date('2026-07-31T12:00:00Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000).toISOString();

test('frame age is only stated when the host actually said one', () => {
  // Inventing a freshness figure for an image of unknown age is exactly the
  // kind of small fabrication that makes a whole app untrustworthy.
  assert.equal(describeFrameAge(null, NOW), null);
  assert.equal(describeFrameAge('not a date', NOW), null);
});

test('frame age reads naturally across the ranges', () => {
  assert.equal(describeFrameAge(minutesAgo(0), NOW), 'less than a minute old');
  assert.equal(describeFrameAge(minutesAgo(14), NOW), '14 min old');
  assert.equal(describeFrameAge(minutesAgo(59), NOW), '59 min old');
  assert.equal(describeFrameAge(minutesAgo(75), NOW), '1 h 15 min old');
  assert.equal(describeFrameAge(minutesAgo(60 * 50), NOW), 'over 2 days old');
});

test('a frame timestamped slightly ahead of us is not reported as negative', () => {
  // Clock skew between the image host and the browser is routine.
  assert.equal(describeFrameAge(new Date(NOW.getTime() + 30_000).toISOString(), NOW), 'just published');
});

test('staleness triggers only well past the ten-minute scan cadence', () => {
  // Being between frames is normal and must not be flagged.
  assert.equal(frameIsStale(minutesAgo(12), NOW), false);
  assert.equal(frameIsStale(minutesAgo(45), NOW), false);
  assert.equal(frameIsStale(minutesAgo(61), NOW), true);
  assert.equal(frameIsStale(minutesAgo(60 * 8), NOW), true);
  // Unknown age cannot be judged stale.
  assert.equal(frameIsStale(null, NOW), false);
});
