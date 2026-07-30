import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aircraftLabel, aircraftSkyPosition, deadReckon, type AircraftState } from './aircraft';
import type { Observer } from '../types';

const LONDON: Observer = { latitude: 51.5, longitude: -0.1, elevation: 0 };

function state(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    icao24: '3c6444',
    callsign: 'DLH9LF',
    originCountry: 'Germany',
    latitudeDeg: 51.5,
    longitudeDeg: -0.1,
    altitudeM: 10000,
    velocityMS: 250,
    trueTrackDeg: 0,
    verticalRateMS: 0,
    onGround: false,
    lastContact: 1458564120,
    ...overrides,
  };
}

test('an aircraft directly overhead reads as 90 degrees elevation', () => {
  const sky = aircraftSkyPosition({ latitudeDeg: 51.5, longitudeDeg: -0.1, altitudeM: 10000 }, LONDON);
  assert.ok(Math.abs(sky.elevationDeg - 90) < 0.01, `expected ~90, got ${sky.elevationDeg}`);
});

test('range to an aircraft directly overhead is its altitude', () => {
  const sky = aircraftSkyPosition({ latitudeDeg: 51.5, longitudeDeg: -0.1, altitudeM: 10000 }, LONDON);
  assert.ok(Math.abs(sky.rangeKm - 10) < 0.01, `expected ~10 km, got ${sky.rangeKm}`);
});

test('an aircraft due north reads as azimuth 0', () => {
  const observer: Observer = { latitude: 51, longitude: 0, elevation: 0 };
  const sky = aircraftSkyPosition({ latitudeDeg: 52, longitudeDeg: 0, altitudeM: 10000 }, observer);
  assert.ok(Math.abs(sky.azimuthDeg) < 0.01, `expected ~0, got ${sky.azimuthDeg}`);
});

test('an aircraft due east reads as azimuth 90', () => {
  const observer: Observer = { latitude: 0, longitude: 0, elevation: 0 };
  const sky = aircraftSkyPosition({ latitudeDeg: 0, longitudeDeg: 1, altitudeM: 10000 }, observer);
  assert.ok(Math.abs(sky.azimuthDeg - 90) < 0.01, `expected ~90, got ${sky.azimuthDeg}`);
});

test('an aircraft due south-west lands in the third quadrant of the compass', () => {
  const observer: Observer = { latitude: 51, longitude: 0, elevation: 0 };
  const sky = aircraftSkyPosition({ latitudeDeg: 50, longitudeDeg: -1, altitudeM: 10000 }, observer);
  assert.ok(sky.azimuthDeg > 180 && sky.azimuthDeg < 270, `expected SW quadrant, got ${sky.azimuthDeg}`);
});

test('elevation falls as an aircraft gets further away at the same altitude', () => {
  const near = aircraftSkyPosition({ latitudeDeg: 51.6, longitudeDeg: -0.1, altitudeM: 10000 }, LONDON);
  const far = aircraftSkyPosition({ latitudeDeg: 52.4, longitudeDeg: -0.1, altitudeM: 10000 }, LONDON);
  assert.ok(near.elevationDeg > far.elevationDeg);
  assert.ok(far.elevationDeg > 0, 'should still be above the horizon at this range');
});

test('a distant cruising aircraft sits low, and Earth curvature keeps it below the flat-plane angle', () => {
  // ~100 km north, at 10 km altitude. On a flat Earth this would be
  // atan(10/100) = 5.7 degrees; curvature drops the far end away by roughly
  // d^2/2R (~0.8 km here), so the true angle is meaningfully lower.
  const observer: Observer = { latitude: 51, longitude: 0, elevation: 0 };
  const sky = aircraftSkyPosition({ latitudeDeg: 51.9, longitudeDeg: 0, altitudeM: 10000 }, observer);
  assert.ok(sky.elevationDeg > 3 && sky.elevationDeg < 5.71, `expected 3-5.7 deg, got ${sky.elevationDeg}`);
  assert.ok(sky.rangeKm > 95 && sky.rangeKm < 110, `expected ~100 km, got ${sky.rangeKm}`);
});

test('an aircraft below the horizon reads as negative elevation', () => {
  // Far enough away that the Earth's curve puts it out of sight entirely.
  const observer: Observer = { latitude: 51, longitude: 0, elevation: 0 };
  const sky = aircraftSkyPosition({ latitudeDeg: 56, longitudeDeg: 0, altitudeM: 10000 }, observer);
  assert.ok(sky.elevationDeg < 0, `expected below horizon, got ${sky.elevationDeg}`);
});

test('deadReckon on a northward track increases latitude and leaves longitude alone', () => {
  const moved = deadReckon(state({ trueTrackDeg: 0, velocityMS: 250 }), 60);
  assert.ok(moved.latitudeDeg > 51.5, `expected northward, got ${moved.latitudeDeg}`);
  assert.ok(Math.abs(moved.longitudeDeg + 0.1) < 0.001, `expected no drift, got ${moved.longitudeDeg}`);
  // 250 m/s for 60 s is 15 km, which is about 0.135 degrees of latitude.
  assert.ok(Math.abs(moved.latitudeDeg - 51.5 - 0.135) < 0.01);
});

test('deadReckon on an eastward track increases longitude', () => {
  const moved = deadReckon(state({ trueTrackDeg: 90, velocityMS: 250 }), 60);
  assert.ok(moved.longitudeDeg > -0.1, `expected eastward, got ${moved.longitudeDeg}`);
  assert.ok(Math.abs(moved.latitudeDeg - 51.5) < 0.01, 'latitude should barely change');
});

test('deadReckon applies vertical rate to altitude', () => {
  const climbing = deadReckon(state({ verticalRateMS: 5 }), 60);
  assert.equal(climbing.altitudeM, 10300);

  const descending = deadReckon(state({ verticalRateMS: -5 }), 60);
  assert.equal(descending.altitudeM, 9700);
});

test('deadReckon never drives altitude below the ground', () => {
  const plunging = deadReckon(state({ altitudeM: 100, verticalRateMS: -50 }), 60);
  assert.equal(plunging.altitudeM, 0);
});

test('deadReckon leaves an aircraft untouched when there is nothing to project along', () => {
  const noVelocity = state({ velocityMS: null });
  assert.deepEqual(deadReckon(noVelocity, 60), noVelocity);

  const noTrack = state({ trueTrackDeg: null });
  assert.deepEqual(deadReckon(noTrack, 60), noTrack);

  const parked = state({ onGround: true });
  assert.deepEqual(deadReckon(parked, 60), parked);

  const noTime = state();
  assert.deepEqual(deadReckon(noTime, 0), noTime);
});

test('deadReckon keeps longitude valid when a track crosses the antimeridian', () => {
  const crossing = deadReckon(
    state({ latitudeDeg: 0, longitudeDeg: 179.99, trueTrackDeg: 90, velocityMS: 250 }),
    60
  );
  assert.ok(crossing.longitudeDeg >= -180 && crossing.longitudeDeg <= 180, `got ${crossing.longitudeDeg}`);
  // Should have wrapped to just past the antimeridian, not run off to 180.1.
  assert.ok(crossing.longitudeDeg < 0, `expected a wrap into negative longitude, got ${crossing.longitudeDeg}`);
});

test('aircraftLabel prefers the callsign and falls back to the ICAO address', () => {
  assert.equal(aircraftLabel(state({ callsign: 'BAW123' })), 'BAW123');
  assert.equal(aircraftLabel(state({ callsign: null })), '3C6444');
});
