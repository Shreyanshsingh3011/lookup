import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  DEFAULT_GROUP_IDS,
  SATELLITE_GROUPS,
  describeGroups,
  normaliseGroups,
} from './satelliteGroups';

test('the default covers both the stations and the bright catalogue', () => {
  // Celestrak's "visual" list does not contain the ISS — it lives in
  // "stations" — so defaulting to either one alone leaves an obvious hole.
  assert.ok(DEFAULT_GROUP_IDS.includes('stations'));
  assert.ok(DEFAULT_GROUP_IDS.includes('visual'));
});

test('clearing every group falls back rather than blanking the sky', () => {
  // An empty selection would fetch nothing and read as a broken app.
  assert.deepEqual(normaliseGroups([]), DEFAULT_GROUP_IDS);
  assert.deepEqual(normaliseGroups(['nonsense']), DEFAULT_GROUP_IDS);
});

test('a single valid group is respected', () => {
  assert.deepEqual(normaliseGroups(['stations']), ['stations']);
  assert.deepEqual(normaliseGroups(['visual']), ['visual']);
});

test('unknown ids are dropped without discarding the valid ones', () => {
  assert.deepEqual(normaliseGroups(['visual', 'not-a-group']), ['visual']);
});

test('selection order is preserved, since it drives fetch order', () => {
  assert.deepEqual(normaliseGroups(['visual', 'stations']), ['visual', 'stations']);
});

test('the description reads as a sentence fragment', () => {
  assert.equal(describeGroups(['stations']), 'Space stations');
  assert.equal(describeGroups(['stations', 'visual']), 'space stations and brightest objects');
  assert.equal(describeGroups([]), 'space stations and brightest objects');
});

test('every offered group states how big it is', () => {
  // The count is the whole basis for choosing, so a description without one
  // leaves the user guessing at the cost of ticking a box.
  for (const group of SATELLITE_GROUPS) {
    assert.ok(group.id.length > 0 && group.label.length > 0);
    assert.match(group.description, /\d/, `${group.id} should say roughly how many objects`);
  }
});
