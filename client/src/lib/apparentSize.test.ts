import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  apparentDiameterDeg,
  describeApparentSize,
  drawnDiameterDeg,
  exaggerationFactor,
  sphereRadiusFor,
  toArcseconds,
} from './apparentSize';

const WHEN = new Date('2026-08-01T00:00:00Z');

test('apparent diameters match the published figures', () => {
  // The Moon runs 29.4-33.5 arcminutes over its orbit, the Sun 31.5-32.5.
  const moon = toArcseconds(apparentDiameterDeg('Moon', WHEN)!) / 60;
  assert.ok(moon > 29 && moon < 34, `Moon should be 29-34 arcmin, got ${moon.toFixed(1)}`);

  const sun = toArcseconds(apparentDiameterDeg('Sun', WHEN)!) / 60;
  assert.ok(sun > 31 && sun < 33, `Sun should be 31-33 arcmin, got ${sun.toFixed(1)}`);

  // Jupiter ranges roughly 30-50 arcsec, Venus 10-63, Mars 3.5-25.
  const jupiter = toArcseconds(apparentDiameterDeg('Jupiter', WHEN)!);
  assert.ok(jupiter > 28 && jupiter < 52, `Jupiter should be ~30-50 arcsec, got ${jupiter.toFixed(1)}`);

  const venus = toArcseconds(apparentDiameterDeg('Venus', WHEN)!);
  assert.ok(venus > 9 && venus < 64, `Venus should be 10-63 arcsec, got ${venus.toFixed(1)}`);

  const mars = toArcseconds(apparentDiameterDeg('Mars', WHEN)!);
  assert.ok(mars > 3 && mars < 26, `Mars should be 3.5-25 arcsec, got ${mars.toFixed(1)}`);
});

test('an unknown body has no size rather than a made-up one', () => {
  assert.equal(apparentDiameterDeg('Pluto', WHEN), null);
  assert.equal(apparentDiameterDeg('', WHEN), null);
});

test('a planet grows as it comes closer', () => {
  // Mars swings between about 0.4 and 2.6 AU, so its disc varies hugely across
  // a synodic period — the strongest test that distance is really being used.
  const sizes: number[] = [];
  for (let month = 0; month < 26; month++) {
    const d = new Date(Date.UTC(2026, month, 1));
    const size = apparentDiameterDeg('Mars', d);
    assert.ok(size !== null);
    sizes.push(toArcseconds(size));
  }
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  assert.ok(max / min > 2, `Mars should vary by more than 2x over two years, got ${(max / min).toFixed(1)}x`);
});

test('the Moon is far larger than any planet, which is the whole point', () => {
  const moon = apparentDiameterDeg('Moon', WHEN)!;
  for (const planet of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']) {
    const size = apparentDiameterDeg(planet, WHEN)!;
    assert.ok(moon / size > 20, `Moon should dwarf ${planet}, ratio was ${(moon / size).toFixed(1)}`);
  }
});

test('true mode draws reality, untouched', () => {
  const real = apparentDiameterDeg('Jupiter', WHEN)!;
  assert.equal(drawnDiameterDeg(real, 'true'), real);
});

test('enhanced mode is strictly increasing, so the order is never wrong', () => {
  // This is the property that matters. The old hardcoded sizes put Mars ahead
  // of Mercury, which is backwards; a monotonic transform cannot do that.
  const bodies = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Moon', 'Sun'];
  const pairs = bodies
    .map((b) => ({ b, real: apparentDiameterDeg(b, WHEN)! }))
    .sort((x, y) => x.real - y.real);

  for (let i = 1; i < pairs.length; i++) {
    const previous = drawnDiameterDeg(pairs[i - 1].real, 'enhanced');
    const current = drawnDiameterDeg(pairs[i].real, 'enhanced');
    assert.ok(
      current > previous,
      `${pairs[i].b} is really bigger than ${pairs[i - 1].b} and must be drawn bigger`
    );
  }
});

test('enhanced mode keeps every planet visible but well under the Moon', () => {
  const moonDrawn = drawnDiameterDeg(apparentDiameterDeg('Moon', WHEN)!, 'enhanced');
  for (const planet of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']) {
    const drawn = drawnDiameterDeg(apparentDiameterDeg(planet, WHEN)!, 'enhanced');
    assert.ok(drawn > 0.3, `${planet} would be too small to see at ${drawn.toFixed(2)}°`);
    assert.ok(drawn < moonDrawn, `${planet} must still be drawn smaller than the Moon`);
  }
});

test('the exaggeration is reported, not hidden', () => {
  const real = apparentDiameterDeg('Mars', WHEN)!;
  const drawn = drawnDiameterDeg(real, 'enhanced');
  const factor = exaggerationFactor(real, drawn);
  assert.ok(factor > 100, 'a planet really is being drawn hundreds of times too large');
  // And true scale must report no exaggeration at all.
  assert.equal(exaggerationFactor(real, drawnDiameterDeg(real, 'true')), 1);
});

test('sphere radius subtends the angle it was asked for', () => {
  // Round-trip: place a sphere, measure the angle it covers from the centre.
  for (const deg of [0.001, 0.05, 0.5, 3.4]) {
    const r = sphereRadiusFor(deg, 100);
    const measured = (2 * Math.atan(r / 100) * 180) / Math.PI;
    assert.ok(Math.abs(measured - deg) < 1e-9, `expected ${deg}°, measured ${measured}°`);
  }
});

test('sizes are described in the units astronomers use', () => {
  assert.match(describeApparentSize(0.52), /0\.52° across/);
  assert.match(describeApparentSize(30.6 / 3600), /30\.6″ across/);
  assert.match(describeApparentSize(1.3 / 3600), /1\.3″ across/);
});
