import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nearestToBoresight } from '../hooks/useDebrisField';

/**
 * The near-miss search behind tapping a fragment.
 *
 * This was written for zoom promotion and is now also what makes the field
 * selectable: a fragment is around seven pixels across and moves several pixels
 * a second, so requiring a ray to intersect its geometry made the readout
 * technically present and practically unreachable — a mouse click aimed from a
 * position read one round trip earlier missed about half the time, and a
 * fingertip is blunter than a mouse.
 *
 * Positions are laid out on the +Z axis and nudged in X, so the angle from the
 * boresight is small and known.
 */
function field(offsets: number[]): { positions: Float32Array; ids: string[] } {
  const positions = new Float32Array(offsets.length * 3);
  const ids: string[] = [];
  offsets.forEach((dx, i) => {
    // 100 units out, dx aside: the angle is atan(dx / 100).
    positions[i * 3] = dx;
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = 100;
    ids.push(`sat${i}`);
  });
  return { positions, ids };
}

const ahead = { x: 0, y: 0, z: 1 };
const degOf = (dx: number) => (Math.atan2(dx, 100) * 180) / Math.PI;

test('a tap slightly off target still finds the fragment', () => {
  // ~0.6 degrees away, inside the 1.5-degree tolerance the field uses.
  const { positions, ids } = field([1.0]);
  assert.ok(degOf(1.0) < 1.5, 'fixture should sit inside the tolerance');
  assert.deepEqual(nearestToBoresight(positions, 1, ids, ahead, 1.5, 1), ['sat0']);
});

test('a tap on genuinely empty sky finds nothing, so it can dismiss', () => {
  // ~2.9 degrees away, outside the tolerance.
  const { positions, ids } = field([5.0]);
  assert.ok(degOf(5.0) > 1.5, 'fixture should sit outside the tolerance');
  assert.deepEqual(nearestToBoresight(positions, 1, ids, ahead, 1.5, 1), []);
});

test('the closest fragment wins, not the first one in the buffer', () => {
  const { positions, ids } = field([1.2, 0.3, 0.9]);
  assert.deepEqual(nearestToBoresight(positions, 3, ids, ahead, 1.5, 1), ['sat1']);
});

test('only the drawn range is searched', () => {
  // A fragment below the horizon still occupies its slot in the buffer; passing
  // a smaller count must exclude it rather than selecting something invisible.
  const { positions, ids } = field([9.0, 0.2]);
  assert.deepEqual(nearestToBoresight(positions, 1, ids, ahead, 1.5, 1), []);
  assert.deepEqual(nearestToBoresight(positions, 2, ids, ahead, 1.5, 1), ['sat1']);
});

test('an empty field is not a hit', () => {
  assert.deepEqual(nearestToBoresight(new Float32Array(0), 0, [], ahead, 1.5, 1), []);
});
