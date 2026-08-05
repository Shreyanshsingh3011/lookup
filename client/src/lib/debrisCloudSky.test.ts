import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  AZIMUTH_BIN_DEG,
  ELEVATION_BIN_DEG,
  cloudSkyDensity,
  timesFainterThanEye,
} from './debrisCloudSky';
import { observerToGeodetic, parseSatrec, skySampleAt } from './sky';
import type { Observer, TleRecord } from '../types';

/**
 * Real Iridium 33 fragments, taken verbatim from production on 2026-08-05.
 * Fixed so these assertions mean the same thing every run.
 */
const FRAGMENTS: TleRecord[] = [
  ['IRIDIUM 33 DEB', '33773', '1 33773U 97051L   26217.26190867  .00000598  00000+0  16995-3 0  9996', '2 33773  86.4043 320.7682 0013406  94.8801 265.3931 14.43721862917455'],
  ['IRIDIUM 33 DEB', '33775', '1 33775U 97051N   26217.25462228  .00000882  00000+0  26198-3 0  9992', '2 33775  86.3647 308.9689 0015279 105.0780 307.7474 14.42135117915342'],
  ['IRIDIUM 33 DEB', '33776', '1 33776U 97051P   26216.44652134  .00000599  00000+0  18914-3 0  9992', '2 33776  86.4080 342.1754 0015903 141.1636 290.5831 14.38595632914569'],
  ['IRIDIUM 33 DEB', '33777', '1 33777U 97051Q   26217.28354758  .00002230  00000+0  48982-3 0  9999', '2 33777  86.3774 292.6251 0007339 164.0274 196.1167 14.57158240919622'],
  ['IRIDIUM 33 DEB', '33850', '1 33850U 97051T   26217.28788839  .00000783  00000+0  22867-3 0  9997', '2 33850  86.3400 288.8568 0014088 109.7618 319.5536 14.42774361915488'],
  ['IRIDIUM 33 DEB', '33860', '1 33860U 97051AD  26217.23376560  .00003603  00000+0  58737-3 0  9996', '2 33860  86.3795 282.6798 0006508 229.5345 193.4493 14.70717951921806'],
  ['IRIDIUM 33 DEB', '33862', '1 33862U 97051AF  26216.98971961  .00002287  00000+0  33923-3 0  9992', '2 33862  86.4077 293.3624 0045801 334.1265 201.0182 14.73915793922845'],
  ['IRIDIUM 33 DEB', '33870', '1 33870U 97051AP  26217.30574323  .00001506  00000+0  40754-3 0  9992', '2 33870  86.3771 317.2077 0022771 118.1477 302.6974 14.46974859915429'],
].map(([name, satnum, line1, line2]) => ({ name, satnum, line1, line2 }));

const LONDON: Observer = { latitude: 51.5, longitude: -0.13, elevation: 0 };
const WHEN = new Date('2026-08-05T22:00:00Z');

test('every fragment counted as above the horizon really is', () => {
  const density = cloudSkyDensity(FRAGMENTS, LONDON, WHEN);
  const gd = observerToGeodetic(LONDON);

  // Independently recount, rather than trusting the function's own tally.
  let expected = 0;
  for (const tle of FRAGMENTS) {
    const rec = parseSatrec(tle);
    if (!rec) continue;
    const sample = skySampleAt(rec, gd, WHEN);
    if (sample && sample.elevationDeg >= 0) expected++;
  }
  assert.equal(density.aboveHorizon, expected);
  assert.equal(density.total, FRAGMENTS.length);
});

test('bin counts add up to the number above the horizon, losing nothing', () => {
  const density = cloudSkyDensity(FRAGMENTS, LONDON, WHEN);
  const summed = density.bins.reduce((n, b) => n + b.count, 0);
  assert.equal(summed, density.aboveHorizon);
});

test('bin centres land inside the sky, never below the horizon', () => {
  const density = cloudSkyDensity(FRAGMENTS, LONDON, WHEN);
  for (const bin of density.bins) {
    assert.ok(bin.azimuthDeg >= 0 && bin.azimuthDeg < 360, `azimuth ${bin.azimuthDeg}`);
    assert.ok(bin.elevationDeg > 0 && bin.elevationDeg < 90, `elevation ${bin.elevationDeg}`);
  }
});

test('weight is relative to the densest bin, so a renderer needs no context', () => {
  const density = cloudSkyDensity(FRAGMENTS, LONDON, WHEN);
  if (density.bins.length === 0) return;
  assert.equal(density.bins[0].weight, 1, 'the densest bin is the reference');
  for (const bin of density.bins) {
    assert.ok(bin.weight > 0 && bin.weight <= 1, `weight ${bin.weight}`);
    assert.equal(bin.weight, bin.count / density.peakBinCount);
  }
});

test('bins come back densest first, so a capped renderer keeps the signal', () => {
  const density = cloudSkyDensity(FRAGMENTS, LONDON, WHEN);
  for (let i = 1; i < density.bins.length; i++) {
    assert.ok(density.bins[i - 1].count >= density.bins[i].count);
  }
});

test('an observer who can see nothing gets an empty field, not a fabricated one', () => {
  // Iridium fragments sit near 86 degrees inclination, so they reach everywhere
  // — but at a given instant a specific observer may have none up. Whatever the
  // answer, bins and count must agree.
  const density = cloudSkyDensity(FRAGMENTS, { latitude: -89, longitude: 0, elevation: 0 }, WHEN);
  if (density.aboveHorizon === 0) assert.equal(density.bins.length, 0);
  assert.equal(
    density.bins.reduce((n, b) => n + b.count, 0),
    density.aboveHorizon
  );
});

test('unreadable element sets are reported, not silently dropped from the total', () => {
  const withJunk = [...FRAGMENTS, { name: 'BROKEN', satnum: '00000', line1: 'nonsense', line2: 'nonsense' }];
  const density = cloudSkyDensity(withJunk, LONDON, WHEN);
  assert.equal(density.total, withJunk.length);
  assert.ok(density.unreadable >= 1);
  // The junk must not be counted as being anywhere in the sky.
  assert.equal(
    density.bins.reduce((n, b) => n + b.count, 0),
    density.aboveHorizon
  );
});

test('an empty cloud produces nothing rather than a zero-weight grid', () => {
  const density = cloudSkyDensity([], LONDON, WHEN);
  assert.deepEqual(density.bins, []);
  assert.equal(density.aboveHorizon, 0);
  assert.equal(density.peakBinCount, 0);
});

test('bins are coarser than the positional error these element sets carry', () => {
  // Fragment TLEs go stale fast — high area-to-mass debris can be kilometres
  // off within days. At 800 km, one degree is about 14 km of cross-range, so
  // ten and fifteen degree bins are comfortably larger than the uncertainty.
  // Binning finer would draw structure the data cannot support.
  assert.ok(AZIMUTH_BIN_DEG >= 10);
  assert.ok(ELEVATION_BIN_DEG >= 10);
});

test('the faintness figure is a real brightness ratio, not a slogan', () => {
  // Magnitude 12 against a naked-eye limit of 6 is six magnitudes, and each
  // five magnitudes is a factor of 100 — so almost exactly 250 times fainter.
  assert.ok(Math.abs(timesFainterThanEye(12) - 251.19) < 0.1);
  assert.equal(timesFainterThanEye(6), 1);
  // Five magnitudes is exactly a hundredfold, which is the definition.
  assert.ok(Math.abs(timesFainterThanEye(11) - 100) < 1e-9);
});
