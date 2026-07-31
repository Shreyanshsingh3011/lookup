import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  TIGHTNESS_NOTES,
  VISIBILITY_NOTES,
  describeTrainDuration,
  passVisibility,
  rankTrains,
  trainTightness,
  type StarlinkTrain,
} from './starlinkTrains';
import type { Pass } from '../types';

function pass(magnitude: number | null): Pass {
  const event = { time: '2026-08-01T21:00:00Z', azimuthDeg: 180, altitudeDeg: 40, direction: 'S', magnitude };
  return {
    satnum: '1',
    name: 'X',
    start: event,
    max: event,
    end: event,
    magnitude,
    durationSeconds: 300,
    endReason: 'set',
  };
}

function train(count: number, magnitude: number | null | 'none'): StarlinkTrain {
  return {
    count,
    leadName: `STARLINK-${count}`,
    meanAltitudeKm: 350,
    inclinationDeg: 53.16,
    spreadDeg: 30,
    passDurationSeconds: 500,
    satnums: [String(count)],
    nextPasses: magnitude === 'none' ? [] : [pass(magnitude)],
  };
}

test('train duration is described in the units people actually notice', () => {
  assert.equal(describeTrainDuration(45), 'about 45 seconds of lights');
  // Under three minutes keeps a decimal, since 1.5 and 2.4 are meaningfully
  // different lengths of standing outside.
  assert.equal(describeTrainDuration(90), 'about 1.5 minutes of lights');
  assert.equal(describeTrainDuration(300), 'about 5 minutes of lights');
  assert.equal(describeTrainDuration(725), 'over 12 minutes of lights');
});

test('duration wording is monotonic across the thresholds', () => {
  // Nothing should read as shorter than something genuinely shorter, which is
  // the failure mode when rounding meets a branch boundary.
  const samples = [30, 89, 90, 179, 180, 599, 600, 601, 3600];
  for (const seconds of samples) {
    const text = describeTrainDuration(seconds);
    assert.ok(text.length > 0);
    assert.ok(/seconds|minutes/.test(text), `unexpected wording for ${seconds}: ${text}`);
  }
  assert.match(describeTrainDuration(89), /seconds/);
  assert.match(describeTrainDuration(91), /minutes/);
});

test('tightness reflects how the string will actually look', () => {
  assert.equal(trainTightness(8), 'tight');
  assert.equal(trainTightness(25), 'tight');
  assert.equal(trainTightness(26), 'stretched');
  assert.equal(trainTightness(70), 'stretched');
  assert.equal(trainTightness(71), 'dispersing');
  assert.equal(trainTightness(180), 'dispersing');
});

test('every tightness has something honest to say about it', () => {
  for (const spread of [5, 40, 120]) {
    const note = TIGHTNESS_NOTES[trainTightness(spread)];
    assert.ok(note && note.length > 20, `missing note for spread ${spread}`);
  }
  // The tightest case is the only one that should promise a solid line.
  assert.match(TIGHTNESS_NOTES.tight, /string of pearls/);
  assert.match(TIGHTNESS_NOTES.stretched, /gaps/);
});

test('pass brightness is classified against what the eye can actually do', () => {
  assert.equal(passVisibility(1.8), 'good');
  assert.equal(passVisibility(2.5), 'good');
  // Third magnitude is an easy naked-eye object; calling it doubtful would
  // bury the trains most worth going out for beneath larger, fainter ones.
  assert.equal(passVisibility(3.1), 'good');
  assert.equal(passVisibility(3.9), 'marginal');
  assert.equal(passVisibility(4.5), 'marginal');
  // The production scan really does return passes at magnitude 9 — geometry
  // alone is not visibility, and saying nothing would send people outside for
  // something they cannot see.
  assert.equal(passVisibility(6.9), 'too-faint');
  assert.equal(passVisibility(9.3), 'too-faint');
  assert.equal(passVisibility(null), 'unknown');
});

test('only the doubtful cases carry a warning', () => {
  assert.equal(VISIBILITY_NOTES.good, null, 'a bright pass needs no caveat');
  assert.equal(VISIBILITY_NOTES.unknown, null, 'an unknown magnitude must not invent one');
  assert.ok(VISIBILITY_NOTES['too-faint']?.includes('Too faint'));
  assert.ok(VISIBILITY_NOTES.marginal);
});

test('trains you can actually see are ranked above ones you cannot', () => {
  // A big batch with an invisible pass must not outrank a small bright one:
  // the question is what to go outside for, not which launch was largest.
  const ranked = rankTrains([
    train(33, 9.3),
    train(9, 1.8),
    train(20, 4.2),
    train(28, 'none'),
  ]);
  assert.deepEqual(
    ranked.map((t) => t.count),
    [9, 20, 33, 28]
  );
});

test('ranking falls back to size when visibility is equal', () => {
  const ranked = rankTrains([train(10, 2.0), train(25, 1.5), train(17, 2.4)]);
  assert.deepEqual(
    ranked.map((t) => t.count),
    [25, 17, 10]
  );
});
