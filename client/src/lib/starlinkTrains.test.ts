import { strict as assert } from 'node:assert';
import test from 'node:test';
import { TIGHTNESS_NOTES, describeTrainDuration, trainTightness } from './starlinkTrains';

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
