import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Astronomy } from './astronomy';
import {
  TRANSFER_TARGETS,
  allTransferWindows,
  currentPhaseAngleDeg,
  heliocentricLongitudeDeg,
  nextTransferWindow,
} from './transferWindows';

const FROM = new Date('2026-08-01T00:00:00Z');
const mars = TRANSFER_TARGETS.find((t) => t.body === 'Mars')!;

test('heliocentric longitudes advance at each planet’s own rate', () => {
  // Mean rates: Earth 0.986°/day, Mars 0.524, Jupiter 0.083. Real planets run
  // fast at perihelion and slow at aphelion, so the tolerance is a percentage
  // rather than a fixed angle — Mars's eccentricity of 0.093 alone swings its
  // rate by about 10% over an orbit.
  const step = (body: string) => {
    const a = heliocentricLongitudeDeg(body, FROM)!;
    const b = heliocentricLongitudeDeg(body, new Date(FROM.getTime() + 10 * 86_400_000))!;
    return ((((b - a) % 360) + 360) % 360) / 10;
  };
  for (const [body, mean] of [
    ['Earth', 0.9856],
    ['Mars', 0.5240],
    ['Jupiter', 0.0831],
  ] as const) {
    const rate = step(body);
    assert.ok(
      Math.abs(rate - mean) / mean < 0.12,
      `${body} moved ${rate.toFixed(4)}°/day, mean rate is ${mean}`
    );
  }
  // Inner planets are strictly faster, with no ties.
  assert.ok(step('Venus') > step('Earth'));
  assert.ok(step('Earth') > step('Mars'));
  assert.ok(step('Mars') > step('Jupiter'));
});

test('the longitude is measured around the ecliptic, not the equator', () => {
  // The decisive frame check. Earth's heliocentric longitude is by definition
  // 180 degrees from the Sun's geocentric ecliptic longitude — the same line
  // seen from the other end. Reading a heliocentric vector's argument straight
  // off its equatorial x and y satisfies this only at the equinoxes and
  // solstices; away from them it drifts by up to about 2.5 degrees, which is
  // days of error in a transfer window and invisible without this check.
  for (const iso of [
    '2026-02-14T00:00:00Z',
    '2026-05-06T00:00:00Z',
    '2026-08-01T00:00:00Z',
    '2026-11-09T00:00:00Z',
  ]) {
    const when = new Date(iso);
    const earth = heliocentricLongitudeDeg('Earth', when)!;
    const sun = Astronomy.SunPosition(when).elon;
    const error = Math.abs((((earth - sun - 180 + 540) % 360) - 180));
    assert.ok(error < 0.05, `${iso}: Earth at ${earth.toFixed(3)}°, Sun at ${sun.toFixed(3)}°`);
  }
});

test('an unknown body has no longitude rather than a made-up one', () => {
  assert.equal(heliocentricLongitudeDeg('Nowhere', FROM), null);
  assert.equal(currentPhaseAngleDeg('Nowhere', FROM), null);
});

test('the next Mars window is found, with the textbook numbers', () => {
  const w = nextTransferWindow(mars, FROM)!;
  assert.ok(w, 'a window must exist within a synodic period');

  assert.ok(Math.abs(w.flightTimeDays - 258.8) < 2, `flight ${w.flightTimeDays.toFixed(1)} days`);
  assert.ok(Math.abs(w.departureDeltaVKmS - 2.94) < 0.05);
  assert.ok(Math.abs(w.synodicPeriodDays - 779.9) < 1);
  assert.ok(Math.abs(w.requiredPhaseAngleDeg - 44.3) < 2);

  // Arrival is exactly the flight time after departure.
  const gap = (w.arrival.getTime() - w.departure.getTime()) / 86_400_000;
  assert.ok(Math.abs(gap - w.flightTimeDays) < 0.01);
});

test('the window is when the geometry is actually right', () => {
  // At the departure instant the target must lead Earth by the required
  // angle. This is the property the whole search exists to find.
  const w = nextTransferWindow(mars, FROM)!;
  const phase = currentPhaseAngleDeg('Mars', w.departure)!;
  const error = Math.abs((((phase - w.requiredPhaseAngleDeg + 540) % 360) - 180));
  assert.ok(error < 0.5, `phase was ${phase.toFixed(2)}°, wanted ${w.requiredPhaseAngleDeg.toFixed(2)}°`);
});

test('windows recur at the synodic period, not at random', () => {
  // Searching again from just after one window must land close to a synodic
  // period later — this is the "every 26 months" fact, derived not asserted.
  const first = nextTransferWindow(mars, FROM)!;
  const second = nextTransferWindow(mars, new Date(first.departure.getTime() + 86_400_000))!;
  const gapDays = (second.departure.getTime() - first.departure.getTime()) / 86_400_000;
  assert.ok(
    Math.abs(gapDays - first.synodicPeriodDays) < 20,
    `consecutive windows were ${gapDays.toFixed(0)} days apart, synodic period is ${first.synodicPeriodDays.toFixed(0)}`
  );
  // And roughly 26 months, which is the number people quote.
  assert.ok(gapDays / 30.44 > 24 && gapDays / 30.44 < 28, `${(gapDays / 30.44).toFixed(1)} months`);
});

test('every target gets a window, ordered by departure', () => {
  const windows = allTransferWindows(FROM);
  assert.equal(windows.length, TRANSFER_TARGETS.length);
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i].departure >= windows[i - 1].departure);
  }
  // All departures lie in the future.
  for (const w of windows) assert.ok(w.departure > FROM);
});

test('the outer planets cost more and take far longer', () => {
  const windows = allTransferWindows(FROM);
  const byBody = new Map(windows.map((w) => [w.target.body, w]));

  const venus = byBody.get('Venus')!;
  const marsW = byBody.get('Mars')!;
  const jupiter = byBody.get('Jupiter')!;

  assert.ok(jupiter.flightTimeDays > marsW.flightTimeDays * 3, 'Jupiter is far further out');
  assert.ok(jupiter.departureDeltaVKmS > marsW.departureDeltaVKmS, 'and needs a bigger burn');
  // Venus is closer but still costs a real burn, being a descent into the Sun's well.
  assert.ok(venus.departureDeltaVKmS > 2, `Venus departure was ${venus.departureDeltaVKmS.toFixed(2)} km/s`);
  // About 146 days to Venus is the standard figure.
  assert.ok(Math.abs(venus.flightTimeDays - 146) < 3, `Venus flight ${venus.flightTimeDays.toFixed(1)} days`);
});
