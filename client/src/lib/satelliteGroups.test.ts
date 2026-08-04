import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  CATEGORY_ORDER,
  DEFAULT_GROUP_IDS,
  FALLBACK_GROUPS,
  describeGroups,
  estimatedSize,
  groupsByCategory,
  normaliseGroups,
  type SatelliteGroup,
} from './satelliteGroups';

const CATALOGUE: SatelliteGroup[] = [
  { id: 'stations', label: 'Space stations', description: '', category: 'Easy to see', approximateSize: 30 },
  { id: 'visual', label: 'Brightest objects', description: '', category: 'Easy to see', approximateSize: 160 },
  { id: 'starlink', label: 'Starlink', description: '', category: 'Constellations', approximateSize: 8000 },
  { id: 'gps-ops', label: 'GPS', description: '', category: 'Navigation', approximateSize: 32 },
];

test('an unknown group is dropped rather than passed through', () => {
  // A shared link can name a group that has since been removed. Trusting it
  // would turn someone else's stale bookmark into a 404 on the pass search.
  assert.deepEqual(normaliseGroups(['visual', 'no-such-group'], CATALOGUE), ['visual']);
  assert.deepEqual(normaliseGroups(['nonsense'], CATALOGUE), DEFAULT_GROUP_IDS);
});

test('clearing every group falls back rather than blanking the sky', () => {
  assert.deepEqual(normaliseGroups([], CATALOGUE), DEFAULT_GROUP_IDS);
  // And the fallback itself must be selectable, or the fallback is a dead end.
  assert.deepEqual(normaliseGroups(DEFAULT_GROUP_IDS, CATALOGUE), DEFAULT_GROUP_IDS);
});

test('the bundled fallback covers the defaults', () => {
  // The picker renders from FALLBACK_GROUPS until the server answers. If the
  // defaults were not in it, a first paint would show them as unselectable.
  for (const id of DEFAULT_GROUP_IDS) {
    assert.ok(FALLBACK_GROUPS.some((g) => g.id === id), `${id} missing from the fallback`);
  }
  assert.deepEqual(normaliseGroups(DEFAULT_GROUP_IDS), DEFAULT_GROUP_IDS);
});

test('selections are described without turning into a list of twenty', () => {
  assert.equal(describeGroups(['visual'], CATALOGUE), 'Brightest objects');
  assert.equal(describeGroups(['stations', 'visual'], CATALOGUE), 'space stations and brightest objects');
  assert.equal(describeGroups(['stations', 'visual', 'starlink', 'gps-ops'], CATALOGUE), '4 groups');
});

test('the estimated size warns before an expensive pick, not after', () => {
  assert.equal(estimatedSize(['stations', 'visual'], CATALOGUE), 190);
  assert.equal(estimatedSize(['starlink'], CATALOGUE), 8000);
  // Unknown ids contribute nothing rather than NaN, which would render as
  // "NaN objects" next to a perfectly valid selection.
  assert.equal(estimatedSize(['stations', 'ghost'], CATALOGUE), 30);
});

test('groups are grouped, and empty categories do not render', () => {
  const grouped = groupsByCategory(CATALOGUE);
  assert.deepEqual(grouped.map(([c]) => c), ['Easy to see', 'Constellations', 'Navigation']);
  assert.deepEqual(grouped[0][1].map((g) => g.id), ['stations', 'visual']);
  // Every category a group can claim must have somewhere to go.
  for (const group of CATALOGUE) {
    assert.ok(CATEGORY_ORDER.includes(group.category), `${group.category} has no position`);
  }
});
