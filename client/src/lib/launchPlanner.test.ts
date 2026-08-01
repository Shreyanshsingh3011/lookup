import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as satellite from 'satellite.js';
import {
  REPRESENTATIVE_LOSSES_KMS,
  ascentBudget,
  planeAt,
  rendezvousWindows,
  siteDirection,
} from './launchPlanner';

// A real ISS element set. Inclination 51.6393, RAAN 339.7896 at epoch.
const ISS_LINE1 = '1 25544U 98067A   26212.50000000  .00016717  00000-0  10270-3 0  9004';
const ISS_LINE2 = '2 25544  51.6393 339.7896 0004825 137.7699 222.3564 15.50227766    09';
const iss = satellite.twoline2satrec(ISS_LINE1, ISS_LINE2);
// Epoch 26212.5 is the 212th day of 2026 at midday — 2026 is not a leap year,
// so that is 31 July, not 1 August. Getting this a day out shifts the node by
// a full 5 degrees of regression, which is how the constant was caught.
const EPOCH = new Date('2026-07-31T12:00:00Z');

// Kennedy Space Center, LC-39A.
const KSC_LAT = 28.6084;
const KSC_LON = -80.6043;

test('the plane read back from the state vector matches the elements it came from', () => {
  // The elements say 51.6393 degrees inclination and 339.7896 RAAN at epoch.
  // Recovering those from the propagated position and velocity is the check
  // that the angular-momentum arithmetic and the node convention are right.
  const plane = planeAt(iss, EPOCH)!;
  assert.ok(plane, 'the ISS element set must propagate at its own epoch');
  assert.ok(
    Math.abs(plane.inclinationDeg - 51.6393) < 0.05,
    `inclination came back as ${plane.inclinationDeg.toFixed(4)}`
  );
  assert.ok(
    Math.abs(plane.raanDeg - 339.7896) < 0.05,
    `RAAN came back as ${plane.raanDeg.toFixed(4)}`
  );
  // A unit normal, by construction.
  const length = Math.hypot(...plane.normal);
  assert.ok(Math.abs(length - 1) < 1e-9, `normal was ${length} long`);
});

test('the node precesses westward, as the equatorial bulge makes it', () => {
  // This is the whole reason the plane is taken from SGP4 at each instant
  // rather than from the element set once. A 51.6 degree, 400 km orbit
  // regresses about 5 degrees a day; treating the node as fixed puts a window
  // twenty minutes out by tomorrow and hours out within a week.
  const start = planeAt(iss, EPOCH)!;
  const later = planeAt(iss, new Date(EPOCH.getTime() + 86_400_000))!;
  const drift = (((later.raanDeg - start.raanDeg) % 360) + 540) % 360 - 180;
  assert.ok(drift < 0, `the node must regress, not advance; drifted ${drift.toFixed(2)}°/day`);
  assert.ok(
    Math.abs(drift + 5.0) < 0.5,
    `expected about -5°/day for this orbit, got ${drift.toFixed(2)}`
  );
  // Inclination, by contrast, barely moves.
  assert.ok(Math.abs(later.inclinationDeg - start.inclinationDeg) < 0.01);
});

test('the site direction is a unit vector at the right latitude', () => {
  const v = siteDirection(KSC_LAT, KSC_LON, EPOCH);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
  // The z component is the sine of the latitude, whatever the time of day.
  assert.ok(Math.abs(v[2] - Math.sin((KSC_LAT * Math.PI) / 180)) < 1e-12);
  const later = siteDirection(KSC_LAT, KSC_LON, new Date(EPOCH.getTime() + 6 * 3600_000));
  assert.ok(Math.abs(later[2] - v[2]) < 1e-12, 'rotation must not change the latitude');
  assert.ok(Math.abs(later[0] - v[0]) > 0.1, 'but it must carry the site round');
});

test('Kennedy gets two windows a day to the station, one of each kind', () => {
  const windows = rendezvousWindows(iss, KSC_LAT, KSC_LON, EPOCH, 24);
  assert.ok(windows.length >= 2, `expected at least two in a day, got ${windows.length}`);
  assert.ok(windows.length <= 3, `expected no more than three in a day, got ${windows.length}`);
  assert.ok(windows.some((w) => w.node === 'ascending'), 'one crossing must be northbound');
  assert.ok(windows.some((w) => w.node === 'descending'), 'and one southbound');

  for (let i = 1; i < windows.length; i++) {
    assert.ok(windows[i].time > windows[i - 1].time, 'windows must come out in order');
  }
  for (const w of windows) {
    assert.ok(w.time >= EPOCH, 'no window may precede the search start');
    assert.ok(Math.abs(w.inclinationDeg - 51.64) < 0.1);
  }
});

test('at a window the pad really is in the plane', () => {
  // The defining property. If this passes with a wrong node convention or a
  // mis-bracketed root the whole feature would still look plausible.
  for (const w of rendezvousWindows(iss, KSC_LAT, KSC_LON, EPOCH, 24)) {
    const plane = planeAt(iss, w.time)!;
    const site = siteDirection(KSC_LAT, KSC_LON, w.time);
    const outOfPlaneDeg =
      (Math.asin(site[0] * plane.normal[0] + site[1] * plane.normal[1] + site[2] * plane.normal[2]) *
        180) /
      Math.PI;
    assert.ok(
      Math.abs(outOfPlaneDeg) < 0.01,
      `${w.time.toISOString()} was ${outOfPlaneDeg.toFixed(4)}° out of plane`
    );
  }
});

test('the two crossings are about half a day apart, not adjacent', () => {
  // The northbound and southbound opportunities are separated by the time it
  // takes the site to rotate from one side of the plane to the other.
  const windows = rendezvousWindows(iss, KSC_LAT, KSC_LON, EPOCH, 24);
  const ascending = windows.find((w) => w.node === 'ascending')!;
  const descending = windows.find((w) => w.node === 'descending')!;
  const gapHours = Math.abs(ascending.time.getTime() - descending.time.getTime()) / 3600_000;
  assert.ok(gapHours > 2 && gapHours < 22, `crossings were ${gapHours.toFixed(1)} h apart`);
});

test('the launch heading is north-easterly one way and south-easterly the other', () => {
  const windows = rendezvousWindows(iss, KSC_LAT, KSC_LON, EPOCH, 24);
  const ascending = windows.find((w) => w.node === 'ascending')!;
  const descending = windows.find((w) => w.node === 'descending')!;
  // Kennedy to 51.6 degrees needs roughly a 45 degree heading northbound...
  assert.ok(
    ascending.azimuthDeg > 35 && ascending.azimuthDeg < 55,
    `ascending heading was ${ascending.azimuthDeg.toFixed(1)}°`
  );
  // ...and its mirror about due east going the other way.
  assert.ok(
    descending.azimuthDeg > 125 && descending.azimuthDeg < 145,
    `descending heading was ${descending.azimuthDeg.toFixed(1)}°`
  );
});

test('a site too far north for the plane never gets a window', () => {
  // Svalbard at 78 N cannot reach a 51.6 degree orbit from the ground at all,
  // so there is no time of day at which it could launch to the station.
  assert.deepEqual(rendezvousWindows(iss, 78.2, 15.4, EPOCH, 72), []);
});

test('the ascent budget adds up and rewards launching east', () => {
  const east = ascentBudget(28.6, 400, 90);
  // Orbital speed at 400 km is 7.67 km/s; due east from Kennedy the ground
  // already supplies about 0.41 of it.
  assert.ok(Math.abs(east.orbitalSpeedKmS - 7.669) < 0.01);
  assert.ok(Math.abs(east.rotationAssistKmS - 0.4085) < 0.005);
  assert.ok(
    Math.abs(east.totalKmS - (east.orbitalSpeedKmS - east.rotationAssistKmS + east.lossesKmS)) < 1e-9
  );
  assert.equal(east.lossesKmS, REPRESENTATIVE_LOSSES_KMS);
  // Which lands near the 9 km/s every launch vehicle is sized around.
  assert.ok(east.totalKmS > 8.5 && east.totalKmS < 9.5, `total ${east.totalKmS.toFixed(2)} km/s`);

  // Due north gets none of the assist, so a polar launch costs more.
  const north = ascentBudget(28.6, 400, 0);
  assert.ok(Math.abs(north.rotationAssistKmS) < 1e-9, 'a due-north launch gains nothing');
  assert.ok(north.totalKmS > east.totalKmS, 'polar orbits must cost more, not less');

  // And retrograde is worse still: the ground is moving the wrong way.
  const west = ascentBudget(28.6, 400, 270);
  assert.ok(west.rotationAssistKmS < 0, 'launching west must fight the rotation');
  assert.ok(west.totalKmS - east.totalKmS > 0.8, 'the swing is twice the assist');
});

test('the rocket equation makes that budget expensive', () => {
  const budget = ascentBudget(28.6, 400, 90);
  // At a kerosene stage's 330 seconds, 9 km/s means a wet vehicle roughly
  // sixteen times its dry mass and over 90% propellant.
  assert.ok(budget.massRatio > 10, `mass ratio ${budget.massRatio.toFixed(1)}`);
  assert.ok(budget.propellantFraction > 0.9, `${(budget.propellantFraction * 100).toFixed(1)}%`);
  assert.ok(
    Math.abs(budget.propellantFraction - (1 - 1 / budget.massRatio)) < 1e-12,
    'the fraction must be the ratio expressed the other way'
  );

  // A hydrogen upper stage at 450 seconds needs far less of it.
  const hydrogen = ascentBudget(28.6, 400, 90, 450);
  assert.ok(hydrogen.massRatio < budget.massRatio, 'better exhaust velocity must cost less mass');
  assert.ok(Math.abs(hydrogen.totalKmS - budget.totalKmS) < 1e-9, 'but the delta-v is unchanged');
});
