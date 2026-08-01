import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  GALILEAN_MOONS,
  galileanMoonOffsets,
  moonLibration,
  rotationState,
  saturnRingOpeningDeg,
} from './planetGeometry';

const WHEN = new Date('2026-08-01T00:00:00Z');

test('all four Galilean moons are placed', () => {
  const moons = galileanMoonOffsets(WHEN);
  assert.equal(moons.length, 4);
  assert.deepEqual(
    moons.map((m) => m.id),
    GALILEAN_MOONS.map((m) => m.id)
  );
});

test('moon distances match their real orbits, in Jupiter radii', () => {
  // Io orbits at 421,700 km and Jupiter's radius is 71,492 km, so Io is about
  // 5.9 Jupiter radii out; Callisto about 26.3. Checking the sky-projected
  // distance, which is never more than the true orbital radius.
  const expected: Record<string, number> = { io: 5.9, europa: 9.4, ganymede: 15.0, callisto: 26.3 };
  const moons = galileanMoonOffsets(WHEN);

  for (const moon of moons) {
    const distance = Math.hypot(moon.x, moon.y, moon.depth);
    const want = expected[moon.id];
    assert.ok(
      Math.abs(distance - want) / want < 0.05,
      `${moon.id} should orbit at ~${want} Jupiter radii, got ${distance.toFixed(2)}`
    );
  }
});

test('the moons are ordered outward, as Galileo numbered them', () => {
  const moons = galileanMoonOffsets(WHEN);
  const radii = moons.map((m) => Math.hypot(m.x, m.y, m.depth));
  for (let i = 1; i < radii.length; i++) {
    assert.ok(radii[i] > radii[i - 1], `${moons[i].id} should orbit outside ${moons[i - 1].id}`);
  }
});

test('the moons visibly move from night to night', () => {
  // Io goes round in 42 hours. If the positions were static, or wrongly keyed
  // to the date, this would not change.
  const tonight = galileanMoonOffsets(WHEN);
  const tomorrow = galileanMoonOffsets(new Date(WHEN.getTime() + 24 * 3600_000));
  const io = tonight.find((m) => m.id === 'io')!;
  const ioLater = tomorrow.find((m) => m.id === 'io')!;
  const moved = Math.hypot(io.x - ioLater.x, io.y - ioLater.y);
  assert.ok(moved > 1, `Io should shift by more than a Jupiter radius in a day, moved ${moved.toFixed(2)}`);
});

test('a moon passing in front is distinguished from one passing behind', () => {
  // Over one Io period the depth must take both signs, or transits and
  // occultations could never be told apart.
  let sawNear = false;
  let sawFar = false;
  for (let hour = 0; hour < 48; hour += 2) {
    const io = galileanMoonOffsets(new Date(WHEN.getTime() + hour * 3600_000)).find((m) => m.id === 'io')!;
    if (io.depth < 0) sawNear = true;
    if (io.depth > 0) sawFar = true;
  }
  assert.ok(sawNear && sawFar, 'Io should pass both in front of and behind Jupiter');
});

test('rotation axes match the published pole positions', () => {
  // Jupiter's north pole sits at roughly RA 268.06, Dec +64.50 (IAU).
  const jupiter = rotationState('Jupiter', WHEN)!;
  assert.ok(Math.abs(jupiter.poleRaDeg - 268.06) < 1, `Jupiter pole RA was ${jupiter.poleRaDeg.toFixed(2)}`);
  assert.ok(Math.abs(jupiter.poleDecDeg - 64.5) < 1, `Jupiter pole Dec was ${jupiter.poleDecDeg.toFixed(2)}`);

  // Mars: RA 317.68, Dec +52.89.
  const mars = rotationState('Mars', WHEN)!;
  assert.ok(Math.abs(mars.poleRaDeg - 317.68) < 1, `Mars pole RA was ${mars.poleRaDeg.toFixed(2)}`);
  assert.ok(Math.abs(mars.poleDecDeg - 52.89) < 1, `Mars pole Dec was ${mars.poleDecDeg.toFixed(2)}`);
});

test('spin advances at each body’s real rate', () => {
  // Jupiter turns in 9h55m, so in one hour it covers about 36 degrees. Mars
  // turns in 24h37m, about 14.6 degrees an hour. Getting these right is the
  // difference between real rotation and the decorative spin this replaced.
  const advance = (body: string, hours: number) => {
    const a = rotationState(body, WHEN)!.spinDeg;
    const b = rotationState(body, new Date(WHEN.getTime() + hours * 3600_000))!.spinDeg;
    return ((b - a) % 360 + 360) % 360;
  };

  const jupiter = advance('Jupiter', 1);
  assert.ok(Math.abs(jupiter - 36.3) < 1.5, `Jupiter should turn ~36°/h, got ${jupiter.toFixed(1)}`);

  const mars = advance('Mars', 1);
  assert.ok(Math.abs(mars - 14.6) < 1, `Mars should turn ~14.6°/h, got ${mars.toFixed(1)}`);
});

test('an unknown body yields no rotation rather than a fabricated one', () => {
  assert.equal(rotationState('Nowhere', WHEN), null);
});

test('Saturn’s rings open and close over its orbit', () => {
  // The opening angle runs between about ±27 degrees and passes through zero
  // twice every 29 years. Sampling three decades must show both extremes.
  const angles: number[] = [];
  for (let year = 2020; year <= 2050; year++) {
    const angle = saturnRingOpeningDeg(new Date(Date.UTC(year, 5, 1)));
    assert.ok(angle !== null);
    angles.push(angle);
  }
  const min = Math.min(...angles);
  const max = Math.max(...angles);
  assert.ok(max > 20, `rings should open past 20°, peak was ${max.toFixed(1)}`);
  assert.ok(min < -20, `rings should open the other way too, low was ${min.toFixed(1)}`);
  assert.ok(Math.abs(max) < 28 && Math.abs(min) < 28, 'opening should never exceed Saturn’s ~27° tilt');
});

test('the rings are near edge-on in the mid-2020s, as they really are', () => {
  // A ring-plane crossing falls in 2025. If this came back at a fixed tilt,
  // the app would be drawing a Saturn that does not exist this year.
  const now = saturnRingOpeningDeg(new Date('2026-03-01T00:00:00Z'))!;
  assert.ok(Math.abs(now) < 8, `expected nearly edge-on, got ${now.toFixed(1)}°`);
});

test('lunar libration stays within its real range', () => {
  // Libration in latitude reaches about ±6.7°, in longitude about ±8°.
  for (let day = 0; day < 60; day += 3) {
    const lib = moonLibration(new Date(WHEN.getTime() + day * 86_400_000));
    assert.ok(lib !== null);
    assert.ok(Math.abs(lib.latDeg) < 8, `latitude libration out of range: ${lib.latDeg}`);
    assert.ok(Math.abs(lib.lonDeg) < 9, `longitude libration out of range: ${lib.lonDeg}`);
  }
});
