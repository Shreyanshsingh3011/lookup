import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  MILITARY_BLOCKS,
  airframeFor,
  classifyMilitary,
  describeMilitary,
  isHighPerformance,
} from './militaryAircraft';
import type { AircraftState } from './aircraft';

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    icao24: '400a1b',
    callsign: 'BAW244',
    originCountry: 'United Kingdom',
    latitudeDeg: 51.5,
    longitudeDeg: -0.1,
    altitudeM: 10_000,
    velocityMS: 230,
    trueTrackDeg: 90,
    category: 'A3',
    verticalRateMS: 0,
    onGround: false,
    lastContact: Date.now() / 1000,
    ...overrides,
  };
}

test('an ordinary airliner is not flagged', () => {
  const result = classifyMilitary(aircraft());
  assert.equal(result.military, false);
  assert.equal(result.basis, null);
  assert.equal(describeMilitary(result), null);
});

test('addresses inside a national military block are flagged', () => {
  // 0x43C123 sits inside the UK military range 0x43C000-0x43CFFF.
  const uk = classifyMilitary(aircraft({ icao24: '43c123', callsign: null }));
  assert.equal(uk.military, true);
  assert.equal(uk.basis, 'address-block');
  assert.equal(uk.country, 'United Kingdom');

  // 0xAE1234 sits inside the US range 0xADF7C8-0xAFFFFF.
  const us = classifyMilitary(aircraft({ icao24: 'ae1234', callsign: null }));
  assert.equal(us.country, 'United States');
  assert.match(describeMilitary(us) ?? '', /United States military address block/);
});

test('addresses just outside a block are not flagged', () => {
  // One below the UK block, and one above it.
  assert.equal(classifyMilitary(aircraft({ icao24: '43bfff', callsign: null })).military, false);
  assert.equal(classifyMilitary(aircraft({ icao24: '43d000', callsign: null })).military, false);
  // And immediately below the US block start of 0xADF7C8.
  assert.equal(classifyMilitary(aircraft({ icao24: 'adf7c7', callsign: null })).military, false);
  assert.equal(classifyMilitary(aircraft({ icao24: 'adf7c8', callsign: null })).military, true);
});

test('military callsigns are recognised, but only with a flight number', () => {
  const reach = classifyMilitary(aircraft({ icao24: '000000', callsign: 'RCH471' }));
  assert.equal(reach.military, true);
  assert.equal(reach.basis, 'callsign');
  assert.match(describeMilitary(reach) ?? '', /US Air Mobility Command callsign/);

  // A bare prefix with no number is too weak to act on.
  assert.equal(classifyMilitary(aircraft({ icao24: '000000', callsign: 'RCH' })).military, false);
});

test('airline callsigns that merely start with the same letters are left alone', () => {
  // These would all be false positives on a naive prefix match.
  for (const callsign of ['BAF', 'GAFFER', 'NAFTA']) {
    assert.equal(
      classifyMilitary(aircraft({ icao24: '000000', callsign })).military,
      false,
      `${callsign} should not be flagged`
    );
  }
});

test('an address block outranks a callsign, being the stronger evidence', () => {
  const both = classifyMilitary(aircraft({ icao24: '43c123', callsign: 'RCH471' }));
  assert.equal(both.basis, 'address-block');
  assert.equal(both.country, 'United Kingdom');
});

test('a missing or malformed address does not throw', () => {
  assert.equal(classifyMilitary(aircraft({ icao24: '', callsign: null })).military, false);
  assert.equal(classifyMilitary(aircraft({ icao24: 'zzzzzz', callsign: null })).military, false);
});

test('the block table is well formed and non-overlapping', () => {
  for (const block of MILITARY_BLOCKS) {
    assert.ok(block.from <= block.to, `${block.country} block is inverted`);
    assert.ok(block.from >= 0 && block.to <= 0xffffff, `${block.country} block is out of range`);
    assert.ok(block.country.length > 0);
  }
  const sorted = [...MILITARY_BLOCKS].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i].from > sorted[i - 1].to,
      `${sorted[i - 1].country} and ${sorted[i].country} blocks overlap`
    );
  }
});

test('a fighter silhouette is drawn only when the aircraft says it is one', () => {
  // A6 is "capable of >5g and >400kt" — the aircraft's own description.
  assert.ok(isHighPerformance('A6'));
  assert.equal(airframeFor(aircraft({ category: 'A6' })), 'fast-jet');

  // Being in a military address block is not a claim about the airframe: a
  // tanker and a fighter share the same block, so the shape must not be
  // inferred from it.
  assert.equal(airframeFor(aircraft({ icao24: '43c123', category: 'A5' })), 'airliner');
  assert.equal(airframeFor(aircraft({ icao24: '43c123', category: null })), 'airliner');

  assert.equal(airframeFor(aircraft({ category: 'A7' })), 'rotorcraft');
  assert.equal(airframeFor(aircraft({ category: 'A3' })), 'airliner');
  assert.equal(isHighPerformance(null), false);
});
