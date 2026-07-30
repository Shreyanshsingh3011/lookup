import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePastedTle } from './customTle';

const LINE1 = '1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994';
const LINE2 = '2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272';

test('parses a three-line paste (name + line1 + line2)', () => {
  const result = parsePastedTle(`ISS (ZARYA)\n${LINE1}\n${LINE2}`);
  assert.deepEqual(result, { name: 'ISS (ZARYA)', satnum: '25544', line1: LINE1, line2: LINE2 });
});

test('parses a two-line paste with a generated name', () => {
  const result = parsePastedTle(`${LINE1}\n${LINE2}`);
  assert.deepEqual(result, { name: 'Satellite 25544', satnum: '25544', line1: LINE1, line2: LINE2 });
});

test('tolerates surrounding blank lines and trailing whitespace', () => {
  const result = parsePastedTle(`\n\nISS (ZARYA)  \n${LINE1}\n${LINE2}\n\n`);
  assert.deepEqual(result, { name: 'ISS (ZARYA)', satnum: '25544', line1: LINE1, line2: LINE2 });
});

test('rejects fewer than two lines', () => {
  const result = parsePastedTle(LINE1);
  assert.equal(typeof result, 'string');
});

test('rejects lines not starting with the expected line-number markers', () => {
  const result = parsePastedTle(`garbage\nmore garbage`);
  assert.equal(typeof result, 'string');
  assert.match(result as string, /doesn't look like a TLE/);
});

test('empty input is rejected', () => {
  const result = parsePastedTle('   \n  \n');
  assert.equal(typeof result, 'string');
});
