import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  AU_KM,
  EARTH_RADIUS_KM,
  MU_SUN,
  circularSpeed,
  exhaustVelocityKmS,
  greenwichSiderealDeg,
  hohmannTransfer,
  launchAzimuthDeg,
  launchWindows,
  minimumInclinationDeg,
  orbitalPeriod,
  phaseAngleAtDepartureDeg,
  planeChangeDeltaV,
  massRatio,
  propellantMassFraction,
  rotationalAssistKmS,
  synodicPeriodDays,
} from './orbitalMechanics';

test('circular speed and period match the textbook figures', () => {
  // Low Earth orbit at 400 km: about 7.67 km/s, period about 92.6 minutes.
  const r = EARTH_RADIUS_KM + 400;
  assert.ok(Math.abs(circularSpeed(r) - 7.669) < 0.01, `got ${circularSpeed(r).toFixed(3)} km/s`);
  const minutes = orbitalPeriod(r) / 60;
  assert.ok(Math.abs(minutes - 92.56) < 0.1, `got ${minutes.toFixed(2)} min`);

  // Geostationary: the defining property is a sidereal-day period at 42,164 km.
  const geoHours = orbitalPeriod(42_164) / 3600;
  assert.ok(Math.abs(geoHours - 23.934) < 0.01, `got ${geoHours.toFixed(3)} h`);
  assert.ok(Math.abs(circularSpeed(42_164) - 3.0747) < 0.001);
});

test('Earth’s rotation gives the most help at the equator and none at the poles', () => {
  // 465 m/s at the equator is the standard figure.
  assert.ok(Math.abs(rotationalAssistKmS(0) - 0.4651) < 0.002);
  assert.ok(Math.abs(rotationalAssistKmS(90)) < 1e-9, 'a pole gets no assist at all');
  // Kennedy at 28.5 degrees keeps about 88% of it.
  assert.ok(Math.abs(rotationalAssistKmS(28.5) - 0.4088) < 0.003);
  assert.ok(rotationalAssistKmS(0) > rotationalAssistKmS(51.5), 'lower latitude must help more');
});

test('a site cannot reach an inclination below its own latitude', () => {
  assert.equal(minimumInclinationDeg(28.5), 28.5);
  assert.equal(minimumInclinationDeg(-33.9), 33.9);

  // Baikonur at 45.6 N simply cannot launch directly into a 28 degree orbit.
  assert.equal(launchAzimuthDeg(45.6, 28), null);
  // But it reaches the ISS's 51.6 degrees comfortably.
  assert.ok(launchAzimuthDeg(45.6, 51.6) !== null);
});

test('launch azimuth matches the known cases', () => {
  // Due east from the equator gives an equatorial orbit.
  assert.ok(Math.abs(launchAzimuthDeg(0, 0)! - 90) < 1e-6);
  // From Kennedy at 28.5, launching due east yields 28.5 degrees inclination.
  assert.ok(Math.abs(launchAzimuthDeg(28.5, 28.5)! - 90) < 1e-6);
  // Reaching the ISS plane from Kennedy needs a north-easterly heading.
  const iss = launchAzimuthDeg(28.5, 51.6)!;
  assert.ok(iss > 40 && iss < 50, `expected roughly 45 degrees, got ${iss.toFixed(1)}`);
});

test('plane changes are punishingly expensive', () => {
  const v = circularSpeed(EARTH_RADIUS_KM + 400);
  // Turning a low orbit by 30 degrees costs about 4 km/s — comparable to
  // reaching orbit at all, which is why you launch into the plane you want.
  const thirty = planeChangeDeltaV(v, 30);
  assert.ok(Math.abs(thirty - 3.97) < 0.05, `got ${thirty.toFixed(2)} km/s`);

  // A full reversal costs twice orbital speed.
  assert.ok(Math.abs(planeChangeDeltaV(v, 180) - 2 * v) < 1e-9);
  assert.equal(planeChangeDeltaV(v, 0), 0);
});

test('Hohmann transfer to geostationary matches the published budget', () => {
  // The classic LEO-to-GEO transfer: about 2.42 km/s to depart, 1.47 to
  // circularise, and a little over five hours in flight.
  const t = hohmannTransfer(EARTH_RADIUS_KM + 300, 42_164);
  assert.ok(Math.abs(t.departureDeltaV - 2.42) < 0.05, `departure ${t.departureDeltaV.toFixed(3)}`);
  assert.ok(Math.abs(t.arrivalDeltaV - 1.47) < 0.05, `arrival ${t.arrivalDeltaV.toFixed(3)}`);
  const hours = t.flightTimeSeconds / 3600;
  assert.ok(Math.abs(hours - 5.27) < 0.1, `flight time ${hours.toFixed(2)} h`);
});

test('a transfer costs the same in either direction', () => {
  const up = hohmannTransfer(EARTH_RADIUS_KM + 300, 42_164);
  const down = hohmannTransfer(42_164, EARTH_RADIUS_KM + 300);
  assert.ok(Math.abs(up.totalDeltaV - down.totalDeltaV) < 1e-9);
  assert.ok(Math.abs(up.flightTimeSeconds - down.flightTimeSeconds) < 1e-6);
});

test('Earth to Mars transfer reproduces the known figures', () => {
  const t = hohmannTransfer(AU_KM, 1.523679 * AU_KM, MU_SUN);
  // Departure burn from Earth's orbit is about 2.94 km/s, and the crossing
  // takes roughly 259 days — the number every Mars mission is built around.
  assert.ok(Math.abs(t.departureDeltaV - 2.94) < 0.05, `departure ${t.departureDeltaV.toFixed(3)}`);
  const days = t.flightTimeSeconds / 86_400;
  assert.ok(Math.abs(days - 258.8) < 2, `flight time ${days.toFixed(1)} days`);
});

test('the rocket equation is as cruel as advertised', () => {
  const ve = exhaustVelocityKmS(450); // a good hydrogen upper stage
  assert.ok(Math.abs(ve - 4.413) < 0.01, `exhaust velocity ${ve.toFixed(3)} km/s`);

  // 9.4 km/s to orbit means most of the vehicle is propellant.
  const toOrbit = propellantMassFraction(9.4, ve);
  assert.ok(toOrbit > 0.85, `expected over 85% propellant, got ${(toOrbit * 100).toFixed(1)}%`);
  assert.equal(propellantMassFraction(0, ve), 0);

  // The exponential penalty lives in the mass ratio, not the fraction: the
  // fraction cannot exceed one, since a vehicle cannot be more than all
  // propellant. Doubling the delta-v squares the ratio.
  const half = massRatio(4.7, ve);
  const full = massRatio(9.4, ve);
  assert.ok(Math.abs(half - 2.9) < 0.05, `4.7 km/s should need ~2.9x, got ${half.toFixed(2)}`);
  assert.ok(Math.abs(full - half * half) < 1e-9, 'doubling delta-v must square the mass ratio');
  assert.ok(full > 8, `9.4 km/s should need over 8x dry mass, got ${full.toFixed(2)}`);
  assert.equal(massRatio(0, ve), 1);
});

test('sidereal time is right at a known epoch', () => {
  // Greenwich mean sidereal time at J2000.0 (2000-01-01 12:00 UT) is
  // 280.46061837 degrees by definition of the polynomial.
  const gst = greenwichSiderealDeg(new Date('2000-01-01T12:00:00Z'));
  assert.ok(Math.abs(gst - 280.4606) < 0.001, `got ${gst.toFixed(4)}`);
});

test('sidereal time advances a full turn in a sidereal day', () => {
  const start = new Date('2026-08-01T00:00:00Z');
  const a = greenwichSiderealDeg(start);
  const b = greenwichSiderealDeg(new Date(start.getTime() + 86_164.0905 * 1000));
  // Wrapped to the nearest turn, not the positive remainder: a full rotation
  // lands just *short* of 360, which as a remainder reads as 359.99 rather
  // than as zero.
  const wrapped = (((b - a) % 360) + 540) % 360 - 180;
  assert.ok(Math.abs(wrapped) < 0.01, `should return to the same angle, off by ${wrapped.toFixed(4)}°`);
});

test('launch windows come twice a day for an inclined orbit', () => {
  // Kennedy to the ISS plane: reachable, so two crossings per day.
  const windows = launchWindows(28.5, -80.6, 51.6, 120, new Date('2026-08-01T00:00:00Z'), 24);
  assert.ok(windows.length >= 2, `expected at least two windows, got ${windows.length}`);
  assert.ok(windows.some((w) => w.node === 'ascending'));
  assert.ok(windows.some((w) => w.node === 'descending'));

  // Sorted, and inside the requested span.
  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i].time >= windows[i - 1].time);
  }
});

test('an unreachable inclination yields no window rather than a fake one', () => {
  // Baikonur at 45.6 N cannot reach a 28 degree orbit from the ground, so
  // there is no time of day at which it could launch into one.
  assert.deepEqual(launchWindows(45.6, 63.3, 28, 0, new Date('2026-08-01T00:00:00Z'), 48), []);
});

test('an equatorial site can always reach an equatorial orbit', () => {
  const windows = launchWindows(0, 0, 0.1, 0, new Date('2026-08-01T00:00:00Z'), 24);
  assert.ok(windows.length > 0, 'the equator must be able to reach an equatorial plane');
});

test('synodic periods reproduce the intervals people actually quote', () => {
  // Earth and Mars line up every 25.6 months, which is why Mars windows come
  // round roughly every two years and two months.
  const earth = 365.256;
  const mars = 686.980;
  const days = synodicPeriodDays(earth, mars);
  assert.ok(Math.abs(days - 779.9) < 1, `expected ~780 days, got ${days.toFixed(1)}`);

  // Venus: about 584 days.
  assert.ok(Math.abs(synodicPeriodDays(earth, 224.701) - 583.9) < 1);
  // Identical orbits never line up again.
  assert.equal(synodicPeriodDays(365, 365), Infinity);
});

test('the departure phase angle aims ahead of the target, not at it', () => {
  // For Mars the target must be about 44 degrees ahead at departure. Aiming
  // at where it is now arrives at empty space.
  const angle = phaseAngleAtDepartureDeg(AU_KM, 1.523679 * AU_KM, MU_SUN);
  assert.ok(Math.abs(angle - 44.3) < 2, `expected about 44 degrees, got ${angle.toFixed(1)}`);

  // For an inner planet the spacecraft arrives before the target would have,
  // so the required angle is behind rather than ahead.
  const venus = phaseAngleAtDepartureDeg(AU_KM, 0.723332 * AU_KM, MU_SUN);
  assert.ok(venus > 180, `Venus should trail, got ${venus.toFixed(1)}`);
});
