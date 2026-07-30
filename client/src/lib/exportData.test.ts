import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passesToCsv, tlesToText } from './exportData';
import type { Pass, TleRecord } from '../types';

const PASS: Pass = {
  satnum: '25544',
  name: 'ISS (ZARYA)',
  start: { time: '2026-08-01T20:15:00.000Z', azimuthDeg: 283, altitudeDeg: 0, direction: 'WNW', magnitude: null },
  max: { time: '2026-08-01T20:20:00.000Z', azimuthDeg: 195, altitudeDeg: 54, direction: 'SSW', magnitude: -4.1 },
  end: { time: '2026-08-01T20:22:00.000Z', azimuthDeg: 131, altitudeDeg: 22, direction: 'SE', magnitude: null },
  magnitude: -4.1,
  durationSeconds: 420,
  endReason: 'shadow',
  cloudCoverPercent: 12,
};

test('passesToCsv writes a header row plus one row per pass', () => {
  const csv = passesToCsv([PASS]);
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^"satellite","norad_id"/);
  assert.match(lines[1], /^"ISS \(ZARYA\)","25544","2026-08-01"/);
  assert.match(lines[1], /"2026-08-01T20:15:00\.000Z"/);
  assert.match(lines[1], /"shadow"/);
  assert.match(lines[1], /"12"/);
});

test('passesToCsv handles a null magnitude and missing cloud cover without breaking the row shape', () => {
  const csv = passesToCsv([{ ...PASS, magnitude: null, cloudCoverPercent: undefined }]);
  const [, row] = csv.split('\r\n');
  const fields = row.split(',');
  assert.equal(fields.length, 17); // matches the header column count
});

test('passesToCsv escapes embedded quotes in a field', () => {
  const csv = passesToCsv([{ ...PASS, name: 'SAT "ALPHA"' }]);
  assert.match(csv, /"SAT ""ALPHA"""/);
});

test('passesToCsv on an empty list still emits the header', () => {
  const csv = passesToCsv([]);
  assert.equal(csv.split('\r\n').length, 1);
});

test('tlesToText reproduces Celestrak-style name/line1/line2 triples', () => {
  const tles: TleRecord[] = [
    {
      name: 'ISS (ZARYA)',
      satnum: '25544',
      line1: '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994',
      line2: '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272',
    },
  ];
  const text = tlesToText(tles);
  assert.equal(
    text,
    'ISS (ZARYA)\n' +
      '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994\n' +
      '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272'
  );
});

test('tlesToText joins multiple satellites with a blank line implied between triples', () => {
  const tles: TleRecord[] = [
    { name: 'A', satnum: '1', line1: 'L1A', line2: 'L2A' },
    { name: 'B', satnum: '2', line1: 'L1B', line2: 'L2B' },
  ];
  assert.equal(tlesToText(tles), 'A\nL1A\nL2A\nB\nL1B\nL2B');
});
