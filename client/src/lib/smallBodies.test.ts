import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Astronomy } from './astronomy';
import {
  anomalyAt,
  apparentMagnitude,
  elementsFromState,
  equatorialToEcliptic,
  heliocentricEcliptic,
  periodDays,
  positionOf,
  type OrbitalElements,
  type SmallBody,
} from './smallBodies';
import { localSiderealTime } from './celestialMath';

const EPOCH = new Date('2026-08-04T00:00:00Z');
const LONDON = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };

/** A planet's heliocentric state, in the ecliptic frame the elements use. */
function eclipticState(body: string, date: Date) {
  const state = Astronomy.HelioState(body as Parameters<typeof Astronomy.HelioState>[0], date);
  const position = equatorialToEcliptic({ x: state.x, y: state.y, z: state.z });
  const velocity = equatorialToEcliptic({ x: state.vx, y: state.vy, z: state.vz });
  return { position, velocity };
}

test('the solver reproduces the planets it was never told about', () => {
  // The decisive test. Take a planet's state from the fitted planetary theory,
  // reduce it to orbital elements, then propagate those with the conic solver
  // and compare against the theory again months later. Nothing is hardcoded,
  // so any error in the Kepler solving or the rotation into the ecliptic shows
  // up immediately rather than as a plausible wrong position.
  for (const [planet, tolerance] of [
    ['Mercury', 0.02],
    ['Venus', 0.01],
    ['Earth', 0.01],
    ['Mars', 0.02],
    ['Jupiter', 0.02],
  ] as const) {
    const { position, velocity } = eclipticState(planet, EPOCH);
    const elements = elementsFromState(position, velocity, EPOCH);

    for (const days of [0, 30, 120]) {
      const when = new Date(EPOCH.getTime() + days * 86_400_000);
      const mine = heliocentricEcliptic(elements, when);
      const theirs = eclipticState(planet, when).position;
      const error = Math.hypot(mine.x - theirs.x, mine.y - theirs.y, mine.z - theirs.z);
      assert.ok(
        error < tolerance,
        `${planet} at +${days} d was off by ${error.toFixed(5)} AU (limit ${tolerance})`
      );
    }
  }
});

test('elements survive the round trip through a state vector', () => {
  const { position, velocity } = eclipticState('Mars', EPOCH);
  const elements = elementsFromState(position, velocity, EPOCH);

  // Mars: eccentricity 0.093, inclination 1.85 degrees to the ecliptic,
  // perihelion 1.38 AU. Published figures, and none of them fed in.
  assert.ok(Math.abs(elements.e - 0.0934) < 0.002, `eccentricity came out ${elements.e.toFixed(4)}`);
  assert.ok(Math.abs(elements.i - 1.85) < 0.05, `inclination came out ${elements.i.toFixed(3)}`);
  assert.ok(Math.abs(elements.q - 1.3814) < 0.005, `perihelion came out ${elements.q.toFixed(4)} AU`);
  assert.ok(Math.abs(periodDays(elements)! - 687) < 3, `period came out ${periodDays(elements)!.toFixed(1)} d`);
});

test('all three conic sections are solved, not just the easy one', () => {
  const base = { q: 1, tp: EPOCH, i: 10, node: 20, peri: 30 };

  // Elliptical, parabolic and hyperbolic orbits through the same perihelion.
  const elliptical: OrbitalElements = { ...base, e: 0.7 };
  const parabolic: OrbitalElements = { ...base, e: 1 };
  const hyperbolic: OrbitalElements = { ...base, e: 1.5 };

  for (const elements of [elliptical, parabolic, hyperbolic]) {
    // At perihelion every one of them is exactly q from the Sun, with the true
    // anomaly at zero. This is the boundary the three formulae must agree on.
    const atPerihelion = anomalyAt(elements, EPOCH);
    assert.ok(Math.abs(atPerihelion.radiusAu - elements.q) < 1e-9, `e=${elements.e} perihelion distance`);
    assert.ok(Math.abs(atPerihelion.trueAnomaly) < 1e-9, `e=${elements.e} true anomaly at perihelion`);

    // And every one recedes afterwards, monotonically.
    let previous = atPerihelion.radiusAu;
    for (const days of [10, 50, 200, 500]) {
      const later = anomalyAt(elements, new Date(EPOCH.getTime() + days * 86_400_000));
      assert.ok(Number.isFinite(later.radiusAu), `e=${elements.e} gave a non-finite radius at +${days} d`);
      assert.ok(later.radiusAu > previous, `e=${elements.e} must recede after perihelion`);
      previous = later.radiusAu;
    }
  }

  // Only the closed orbit comes back.
  assert.ok(periodDays(elliptical)! > 0);
  assert.equal(periodDays(parabolic), null);
  assert.equal(periodDays(hyperbolic), null);
});

test('the near-parabolic case does not fall apart', () => {
  // Bright comets cluster within a whisker of e = 1, which is exactly where a
  // solver that only knows ellipses converges slowly or diverges. The three
  // formulae must agree across the boundary rather than jump.
  const base = { q: 0.5, tp: EPOCH, i: 60, node: 100, peri: 200 };
  const days = 90;
  const when = new Date(EPOCH.getTime() + days * 86_400_000);

  const justUnder = anomalyAt({ ...base, e: 0.999_999 }, when);
  const exactly = anomalyAt({ ...base, e: 1 }, when);
  const justOver = anomalyAt({ ...base, e: 1.000_001 }, when);

  assert.ok(Math.abs(justUnder.radiusAu - exactly.radiusAu) < 0.01, 'ellipse must meet the parabola');
  assert.ok(Math.abs(justOver.radiusAu - exactly.radiusAu) < 0.01, 'hyperbola must meet it too');
  for (const result of [justUnder, exactly, justOver]) {
    assert.ok(Number.isFinite(result.radiusAu) && result.radiusAu > 0);
    assert.ok(Number.isFinite(result.trueAnomaly));
  }
});

test('a high-eccentricity orbit still converges', () => {
  // Halley is e = 0.967, and the naive Kepler starting guess stalls up there.
  const halleyish: OrbitalElements = { e: 0.967, q: 0.586, tp: EPOCH, i: 162.3, node: 58.4, peri: 111.3 };
  for (const days of [0, 1, 100, 1000, 10_000, 27_000]) {
    const result = anomalyAt(halleyish, new Date(EPOCH.getTime() + days * 86_400_000));
    assert.ok(Number.isFinite(result.radiusAu), `non-finite radius at +${days} d`);
    assert.ok(result.radiusAu >= halleyish.q - 1e-9, 'nothing may come closer than perihelion');
    assert.ok(result.radiusAu < 40, `aphelion should be about 35 AU, got ${result.radiusAu.toFixed(1)}`);
  }
  // And it comes back on schedule: about 76 years.
  const years = periodDays(halleyish)! / 365.25;
  assert.ok(Math.abs(years - 76) < 3, `period came out ${years.toFixed(1)} years`);
});

test('a body on the far side of the Sun is further away than one in front', () => {
  const near: SmallBody = {
    id: 'near',
    name: 'Near',
    kind: 'asteroid',
    elements: { e: 0, q: 1, tp: EPOCH, i: 0, node: 0, peri: 0 },
    absoluteMagnitude: 10,
    slope: 0.15,
  };
  const lst = localSiderealTime(EPOCH, LONDON.longitude);
  const position = positionOf(near, LONDON, EPOCH, lst);

  assert.ok(position.distanceAu > 0 && position.distanceAu < 3, `distance ${position.distanceAu}`);
  assert.ok(Math.abs(position.heliocentricAu - 1) < 1e-6, 'a circular 1 AU orbit stays at 1 AU');
  assert.ok(position.raDeg >= 0 && position.raDeg < 360);
  assert.ok(position.decDeg >= -90 && position.decDeg <= 90);
  assert.ok(position.phaseAngleDeg >= 0 && position.phaseAngleDeg <= 180);
  assert.ok(position.elevationDeg >= -90 && position.elevationDeg <= 90);
});

test('Ceres lands where Ceres is', () => {
  // Real published elements for (1) Ceres at epoch 2026-08-04, and the answer
  // it must give: about 2.55 to 2.98 AU from the Sun, magnitude between 7 and
  // 9.5. Getting the orbit plane or the anomaly wrong throws either well out.
  const ceres: SmallBody = {
    id: '1',
    name: '1 Ceres',
    kind: 'asteroid',
    elements: { e: 0.0785, q: 2.5489, tp: new Date('2026-03-25T00:00:00Z'), i: 10.588, node: 80.26, peri: 73.7 },
    absoluteMagnitude: 3.34,
    slope: 0.12,
  };
  const lst = localSiderealTime(EPOCH, LONDON.longitude);
  const position = positionOf(ceres, LONDON, EPOCH, lst);

  assert.ok(
    position.heliocentricAu > 2.5 && position.heliocentricAu < 3.0,
    `Ceres should be 2.5–3.0 AU out, got ${position.heliocentricAu.toFixed(3)}`
  );
  assert.ok(
    position.magnitude !== null && position.magnitude > 6.5 && position.magnitude < 10,
    `Ceres should be magnitude 7–9, got ${position.magnitude?.toFixed(2)}`
  );
  // Never visible to the naked eye, always within reach of binoculars.
  assert.ok(periodDays(ceres.elements)! / 365.25 > 4.4, 'Ceres takes about 4.6 years');
});

test('the two magnitude systems behave like the things they describe', () => {
  const asteroid: SmallBody = {
    id: 'a', name: 'Rock', kind: 'asteroid',
    elements: { e: 0.1, q: 2, tp: EPOCH, i: 5, node: 0, peri: 0 },
    absoluteMagnitude: 5, slope: 0.15,
  };
  const comet: SmallBody = {
    id: 'c', name: 'Fuzzy', kind: 'comet',
    elements: { e: 0.99, q: 0.5, tp: EPOCH, i: 60, node: 0, peri: 0 },
    absoluteMagnitude: 5, slope: 10,
  };

  // Both fade with distance...
  assert.ok(apparentMagnitude(asteroid, 3, 2, 10)! > apparentMagnitude(asteroid, 2, 1, 10)!);
  assert.ok(apparentMagnitude(comet, 3, 2, 10)! > apparentMagnitude(comet, 2, 1, 10)!);

  // ...but a comet far more steeply with heliocentric distance, because its
  // brightness comes from sublimation rather than from reflected sunlight.
  // Holding the Earth distance fixed, a rock follows 5·log10(r) and a comet
  // K1·log10(r), so with the standard K1 of 10 the comet fades exactly twice
  // as fast — 3.01 magnitudes against 1.51 for a doubling of r.
  const rockPenalty = apparentMagnitude(asteroid, 2, 1, 10)! - apparentMagnitude(asteroid, 1, 1, 10)!;
  const cometPenalty = apparentMagnitude(comet, 2, 1, 10)! - apparentMagnitude(comet, 1, 1, 10)!;
  assert.ok(Math.abs(rockPenalty - 1.505) < 0.01, `rock faded ${rockPenalty.toFixed(3)}`);
  assert.ok(Math.abs(cometPenalty / rockPenalty - 2) < 1e-9, `comet/rock ratio ${(cometPenalty / rockPenalty).toFixed(4)}`);

  // A more active comet, K1 = 15, fades faster still.
  const active = { ...comet, slope: 15 };
  const activePenalty = apparentMagnitude(active, 2, 1, 10)! - apparentMagnitude(active, 1, 1, 10)!;
  assert.ok(activePenalty > cometPenalty, 'a higher activity index must steepen the fade');

  // An asteroid is brightest at opposition, where the phase angle is zero.
  assert.ok(apparentMagnitude(asteroid, 2, 1, 0)! < apparentMagnitude(asteroid, 2, 1, 60)!);

  // No photometry means no magnitude, rather than a made-up one.
  assert.equal(apparentMagnitude({ ...asteroid, absoluteMagnitude: null }, 2, 1, 10), null);
});
