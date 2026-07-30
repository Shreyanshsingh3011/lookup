import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toExplainSubject } from './identify';
import type { LiveSatellite } from '../components/sky/SatelliteMarker';
import type { PlanetPosition } from '../hooks/usePlanetPositions';

test('maps a satellite candidate to an ExplainSubject', () => {
  const sat: LiveSatellite = {
    satnum: '25544',
    name: 'ISS (ZARYA)',
    sample: {
      azimuthDeg: 123.4,
      elevationDeg: 45.6,
      rangeKm: 500,
      altitudeKm: 422,
      speedKmS: 7.66,
      illuminated: true,
    },
    trail: [],
    nextPassTime: '2026-08-01T20:15:00.000Z',
  };

  const subject = toExplainSubject({ kind: 'satellite', sat });
  assert.deepEqual(subject, {
    kind: 'satellite',
    name: 'ISS (ZARYA)',
    altitudeKm: 422,
    speedKmS: 7.66,
    elevationDeg: 45.6,
    azimuthDeg: 123.4,
    direction: 'ESE',
    illuminated: true,
    nextPassTime: '2026-08-01T20:15:00.000Z',
  });
});

test('azimuth 123.4 resolves to ESE, not the nearest cardinal', () => {
  // Sanity check for the fixture above: 123.4 rounds to the 5th 22.5deg
  // sector (ESE), not SE, since it's slightly closer to 112.5 than 135.
  const subject = toExplainSubject({
    kind: 'planet',
    planet: { body: 'Mars', azimuthDeg: 123.4, elevationDeg: 10, magnitude: null, phase: null },
  });
  assert.equal(subject.direction, 'ESE');
});

test('maps a planet candidate to an ExplainSubject', () => {
  const planet: PlanetPosition = {
    body: 'Venus',
    azimuthDeg: 270,
    elevationDeg: 20,
    magnitude: -4.1,
    phase: 0.72,
  };

  const subject = toExplainSubject({ kind: 'planet', planet });
  assert.deepEqual(subject, {
    kind: 'planet',
    name: 'Venus',
    elevationDeg: 20,
    azimuthDeg: 270,
    direction: 'W',
    magnitude: -4.1,
    illuminatedFraction: 0.72,
  });
});

test('maps a star candidate to an ExplainSubject, carrying the resolved az/el', () => {
  const subject = toExplainSubject({
    kind: 'star',
    star: { ra: 101.287, dec: -16.716, mag: -1.44, name: 'Sirius', constellation: 'Canis Major' },
    azimuthDeg: 180,
    elevationDeg: 30,
  });
  assert.deepEqual(subject, {
    kind: 'star',
    name: 'Sirius',
    magnitude: -1.44,
    elevationDeg: 30,
    azimuthDeg: 180,
    direction: 'S',
    constellation: 'Canis Major',
  });
});

test('a star with no known constellation maps constellation to null', () => {
  const subject = toExplainSubject({
    kind: 'star',
    star: { ra: 0, dec: 0, mag: 3, name: 'Mystery', constellation: null },
    azimuthDeg: 0,
    elevationDeg: 10,
  });
  assert.equal(subject.kind, 'star');
  assert.equal((subject as { constellation: string | null }).constellation, null);
});
