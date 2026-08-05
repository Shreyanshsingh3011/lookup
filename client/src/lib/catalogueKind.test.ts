import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { derelictByCatalogue } from '../hooks/useSatcat';
import { isDerelictByName } from './debris';
import type { SatcatEntry } from '../types';

function entry(over: Partial<SatcatEntry>): SatcatEntry {
  return {
    satnum: '00000',
    name: 'THING',
    objectType: 'PAYLOAD',
    opsStatus: 'unknown',
    rcsSquareMetres: null,
    launchDate: null,
    decayDate: null,
    ...over,
  };
}

/** The rule the dome applies: catalogue, then name, then the caller's default. */
function resolve(satcat: SatcatEntry | undefined, name: string): boolean {
  return derelictByCatalogue(satcat) ?? isDerelictByName(name);
}

test('the catalogue answers what the name never could', () => {
  // Envisat died in 2012 and its name says nothing. This is the whole point.
  assert.equal(isDerelictByName('ENVISAT'), false, 'the name cannot know');
  assert.equal(resolve(entry({ name: 'ENVISAT', opsStatus: 'nonoperational' }), 'ENVISAT'), true);
});

test('an absent catalogue leaves the name rule exactly as it was', () => {
  // The fallback has to be lossless, or an unreachable SATCAT would be worse
  // than never having had one.
  assert.equal(resolve(undefined, 'SL-16 R/B'), true);
  assert.equal(resolve(undefined, 'ENVISAT'), false);
  assert.equal(resolve(undefined, 'ISS (ZARYA)'), false);
});

test('"unknown" defers to the name rather than being read as death', () => {
  // A silent catalogue is not a claim. If it were treated as "derelict",
  // every object SATCAT does not describe would turn amber.
  assert.equal(resolve(entry({ opsStatus: 'unknown', name: 'ISS (ZARYA)' }), 'ISS (ZARYA)'), false);
  assert.equal(resolve(entry({ opsStatus: 'unknown', name: 'SL-16 R/B' }), 'SL-16 R/B'), true);
});

test('the catalogue can also overrule the name in the other direction', () => {
  // LAGEOS 2 is on the derelict shortlist and SATCAT lists it operational —
  // a passive sphere with no power, ranged by laser to this day. Verified
  // against production on 2026-08-05. The name rule already said "not
  // derelict"; what matters is that the catalogue is what settles it.
  assert.equal(resolve(entry({ name: 'LAGEOS 2', opsStatus: 'operational' }), 'LAGEOS 2'), false);
});

test('declared type beats the name for objects the convention misses', () => {
  // Plenty of debris predates the "DEB" convention, and some has no hint at
  // all in its name. A camera lost on a spacewalk is real: the live stations
  // group carries "HRC MONOBLOCK CAMERA", typed DEBRIS by SATCAT.
  assert.equal(isDerelictByName('HRC MONOBLOCK CAMERA'), false);
  assert.equal(resolve(entry({ name: 'HRC MONOBLOCK CAMERA', objectType: 'DEBRIS' }), 'HRC MONOBLOCK CAMERA'), true);
});

test('dormant spacecraft are not swept into the debris bucket', () => {
  for (const status of ['operational', 'partially-operational', 'backup', 'spare', 'extended-mission'] as const) {
    assert.equal(
      resolve(entry({ opsStatus: status, name: 'SOME SAT' }), 'SOME SAT'),
      false,
      `${status} still describes a working spacecraft`
    );
  }
});

test('a rocket body stays derelict whatever status the catalogue carries', () => {
  for (const status of ['operational', 'unknown'] as const) {
    assert.equal(resolve(entry({ objectType: 'ROCKET BODY', opsStatus: status }), 'SL-16 R/B'), true);
  }
});

test('derelictByCatalogue distinguishes "no answer" from "alive"', () => {
  // null and false must not collapse: null means fall back to the name,
  // false means the catalogue actively says it is working.
  assert.equal(derelictByCatalogue(undefined), null);
  assert.equal(derelictByCatalogue(entry({ opsStatus: 'unknown' })), null);
  assert.equal(derelictByCatalogue(entry({ opsStatus: 'operational' })), false);
});
