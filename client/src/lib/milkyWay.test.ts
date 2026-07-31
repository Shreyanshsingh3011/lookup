import { strict as assert } from 'node:assert';
import test from 'node:test';
import { equatorialToGalactic } from './milkyWay';
import { raDecToEquatorial } from './celestial';

/**
 * The Milky Way band is placed entirely by the galactic frame the shader is
 * handed, so testing that frame is testing where the band lands. Reference
 * positions are checked against their published galactic coordinates: if the
 * frame were wrong, the band would run through the wrong constellations and
 * nothing else would complain.
 */

function galacticOf(raDeg: number, decDeg: number) {
  return equatorialToGalactic(...raDecToEquatorial(raDeg, decDeg));
}

test('the galactic centre sits at the origin of the frame', () => {
  const { l, b } = galacticOf(266.4051, -28.936175);
  assert.ok(l < 0.05 || l > 359.95, `expected l≈0, got ${l}`);
  assert.ok(Math.abs(b) < 0.05, `expected b≈0, got ${b}`);
});

test('the north galactic pole is at b = +90', () => {
  const { b } = galacticOf(192.85948, 27.12825);
  assert.ok(Math.abs(b - 90) < 0.01, `expected b≈90, got ${b}`);
});

test('the celestial poles land at their known galactic latitudes', () => {
  // The north celestial pole is at galactic latitude +27.13, which is just
  // the complement of the galactic pole's declination.
  const north = galacticOf(0, 90);
  assert.ok(Math.abs(north.b - 27.13) < 0.05, `expected b≈27.13, got ${north.b}`);

  const south = galacticOf(0, -90);
  assert.ok(Math.abs(south.b + 27.13) < 0.05, `expected b≈-27.13, got ${south.b}`);
});

test('bright Milky Way landmarks fall on the band', () => {
  // Deneb, in Cygnus, sits in the thick of the summer Milky Way.
  const deneb = galacticOf(310.358, 45.28);
  assert.ok(Math.abs(deneb.b) < 3, `Deneb should be near b=0, got ${deneb.b}`);
  assert.ok(Math.abs(deneb.l - 84.3) < 1, `Deneb should be near l=84, got ${deneb.l}`);

  // Shaula, in the Scorpius sting, near the galactic centre direction.
  const shaula = galacticOf(263.402, -37.104);
  assert.ok(Math.abs(shaula.b + 2) < 3, `Shaula should be near the band, got b=${shaula.b}`);
});

test('the galactic poles are far from the band, where the sky is emptiest', () => {
  // Arcturus and Fomalhaut are both well off the galactic plane, which is why
  // neither sits in a crowded star field.
  assert.ok(Math.abs(galacticOf(213.915, 19.182).b) > 60, 'Arcturus should be high above the plane');
  assert.ok(Math.abs(galacticOf(344.413, -29.622).b) > 50, 'Fomalhaut should be well below it');
});

test('longitude increases the way galactic longitude does', () => {
  // From the centre, l runs toward Cygnus (l≈80) rather than away from it.
  const centre = galacticOf(266.4051, -28.936175);
  const cygnus = galacticOf(310.358, 45.28);
  assert.ok(centre.l < 1 || centre.l > 359);
  assert.ok(cygnus.l > 60 && cygnus.l < 110, `Cygnus should be near l=84, got ${cygnus.l}`);
});

test('the frame is orthonormal, so latitudes never exceed the sphere', () => {
  for (let ra = 0; ra < 360; ra += 17) {
    for (let dec = -85; dec <= 85; dec += 17) {
      const { l, b } = galacticOf(ra, dec);
      assert.ok(b >= -90.001 && b <= 90.001, `b out of range at ${ra},${dec}: ${b}`);
      assert.ok(l >= 0 && l < 360.001, `l out of range at ${ra},${dec}: ${l}`);
    }
  }
});
