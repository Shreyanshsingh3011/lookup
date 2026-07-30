import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as satellite from 'satellite.js';
import {
  circleAround,
  destinationPoint,
  footprintRadiusDeg,
  groundTrack,
  orbitalPeriodMinutes,
  splitAtAntimeridian,
  subsolarPoint,
  subSatellitePoint,
} from './groundTrack';
import type { TleRecord } from '../types';

const ISS: TleRecord = {
  name: 'ISS (ZARYA)',
  satnum: '25544',
  line1: '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994',
  line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272',
};

test('destinationPoint travelling due north lands at a higher latitude, same longitude', () => {
  const dest = destinationPoint({ latitudeDeg: 0, longitudeDeg: 0 }, 10, 0);
  assert.ok(Math.abs(dest.latitudeDeg - 10) < 0.01);
  assert.ok(Math.abs(dest.longitudeDeg) < 0.01);
});

test('destinationPoint travelling due east from the equator lands at a higher longitude, same latitude', () => {
  const dest = destinationPoint({ latitudeDeg: 0, longitudeDeg: 0 }, 10, 90);
  assert.ok(Math.abs(dest.latitudeDeg) < 0.01);
  assert.ok(Math.abs(dest.longitudeDeg - 10) < 0.01);
});

test('circleAround returns a closed ring the requested angular radius from centre', () => {
  const center = { latitudeDeg: 20, longitudeDeg: 30 };
  const ring = circleAround(center, 5, 36);
  assert.equal(ring.length, 37); // steps + 1, closing the loop
  assert.deepEqual(ring[0], ring[ring.length - 1]);
  // Every point should be roughly 5 degrees of arc from the centre (haversine).
  for (const p of ring) {
    const dLat = ((p.latitudeDeg - center.latitudeDeg) * Math.PI) / 180;
    const dLon = ((p.longitudeDeg - center.longitudeDeg) * Math.PI) / 180;
    const lat1 = (center.latitudeDeg * Math.PI) / 180;
    const lat2 = (p.latitudeDeg * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    const angularDistDeg = (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 180) / Math.PI;
    assert.ok(Math.abs(angularDistDeg - 5) < 0.1, `expected ~5deg, got ${angularDistDeg}`);
  }
});

test('footprintRadiusDeg grows with altitude', () => {
  const low = footprintRadiusDeg(400); // ISS-like
  const high = footprintRadiusDeg(35786); // GEO-like
  assert.ok(low > 0 && low < 30);
  assert.ok(high > low);
  assert.ok(high < 90); // never sees a full hemisphere in the limit
});

test('splitAtAntimeridian keeps a non-crossing track as one segment', () => {
  const points = [
    { longitudeDeg: 10, latitudeDeg: 0 },
    { longitudeDeg: 20, latitudeDeg: 1 },
    { longitudeDeg: 30, latitudeDeg: 2 },
  ];
  assert.deepEqual(splitAtAntimeridian(points), [points]);
});

test('splitAtAntimeridian breaks the track where longitude jumps across the seam', () => {
  const points = [
    { longitudeDeg: 170, latitudeDeg: 0 },
    { longitudeDeg: -175, latitudeDeg: 1 }, // wrapped past 180
    { longitudeDeg: -160, latitudeDeg: 2 },
  ];
  const segments = splitAtAntimeridian(points);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 1);
  assert.equal(segments[1].length, 2);
});

test('orbitalPeriodMinutes reads a LEO-like period from the TLE mean motion', () => {
  const period = orbitalPeriodMinutes(ISS);
  // ISS orbits roughly every 90-93 minutes.
  assert.ok(period > 85 && period < 95, `expected ~90min, got ${period}`);
});

test('subSatellitePoint returns a plausible ground position for a real TLE', () => {
  const satrec = satellite.twoline2satrec(ISS.line1, ISS.line2);
  const point = subSatellitePoint(satrec, new Date());
  assert.ok(point);
  assert.ok(point!.latitudeDeg >= -90 && point!.latitudeDeg <= 90);
  assert.ok(point!.longitudeDeg >= -180 && point!.longitudeDeg <= 180);
  // ISS orbits at roughly 400-430 km.
  assert.ok(point!.altitudeKm > 300 && point!.altitudeKm < 500);
});

test('groundTrack samples the requested number of points across the span', () => {
  const satrec = satellite.twoline2satrec(ISS.line1, ISS.line2);
  const track = groundTrack(satrec, new Date(), 90, 30);
  assert.equal(track.length, 31);
});

test('subsolarPoint latitude stays within Earth axial tilt bounds', () => {
  const point = subsolarPoint(new Date());
  assert.ok(Math.abs(point.latitudeDeg) <= 23.5);
  assert.ok(point.longitudeDeg >= -180 && point.longitudeDeg <= 180);
});
