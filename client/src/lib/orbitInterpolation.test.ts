import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as satellite from 'satellite.js';
import {
  DEFAULT_WINDOW_SECONDS,
  InterpolatedOrbits,
  hermiteAt,
  lookAnglesFromEci,
} from './orbitInterpolation';
import { parseSatrec, skySampleAt, observerToGeodetic } from './sky';
import type { TleRecord } from '../types';

/** Real elements: the ISS and two Fengyun-1C fragments in very different orbits. */
const TLES: TleRecord[] = [
  {
    name: 'ISS (ZARYA)',
    satnum: '25544',
    line1: '1 25544U 98067A   26224.43930095  .00003626  00000+0  72910-4 0  9998',
    line2: '2 25544  51.6323  21.6951 0007516  39.2646 320.8886 15.49419670580470',
  },
  {
    name: 'FENGYUN 1C DEB',
    satnum: '30494',
    line1: '1 30494U 99025AHG 26217.33575883  .00000669  00000+0  60469-3 0  9993',
    line2: '2 30494  99.2623 252.9563 0184374 318.2112  40.5084 13.80017283977355',
  },
  {
    name: 'FENGYUN 1C DEB',
    satnum: '29805',
    line1: '1 29805U 99025CX  26217.12301174  .00000024  00000+0  66268-4 0  9993',
    line2: '2 29805  99.4227 269.9780 0187793 337.1770  22.1111 13.72726417979321',
  },
];

const RECS = TLES.map((t) => parseSatrec(t)!);
const FROM = new Date('2026-08-17T12:00:00Z');
const TICK_MS = 250; // the field's own tick

function truthAt(rec: satellite.SatRec, ms: number) {
  const pv = satellite.propagate(rec, new Date(ms));
  assert.ok(pv && pv.position, 'fixture must propagate');
  return pv.position as { x: number; y: number; z: number };
}

test('hermiteAt reproduces both endpoints exactly', () => {
  const a = { position: { x: 1, y: 2, z: 3 }, velocity: { x: 0.1, y: 0.2, z: 0.3 } };
  const b = { position: { x: 4, y: 6, z: 8 }, velocity: { x: 0.4, y: 0.5, z: 0.6 } };
  const start = hermiteAt(a, b, 10, 0);
  const end = hermiteAt(a, b, 10, 1);
  assert.deepEqual(start, a.position);
  assert.deepEqual(end, b.position);
});

test('hermiteAt matches the tangent it was given at the start of the span', () => {
  // The derivative at s=0 must be the supplied velocity, or the curve is not
  // actually honouring the state vector it was built from.
  const a = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 2, y: -1, z: 0.5 } };
  const b = { position: { x: 30, y: -10, z: 5 }, velocity: { x: 1, y: -1, z: 0 } };
  const span = 10;
  const eps = 1e-6;
  const p = hermiteAt(a, b, span, 0);
  const q = hermiteAt(a, b, span, eps);
  const vx = (q.x - p.x) / (eps * span);
  const vy = (q.y - p.y) / (eps * span);
  assert.ok(Math.abs(vx - a.velocity.x) < 1e-4, `dx/dt ${vx} against ${a.velocity.x}`);
  assert.ok(Math.abs(vy - a.velocity.y) < 1e-4, `dy/dt ${vy} against ${a.velocity.y}`);
});

test('interpolated positions stay within metres of full SGP4 across a window', () => {
  // The claim the whole optimisation rests on. Measured over 1,200 real
  // fragments the worst case at an 8 s window was 11.44 m; this checks the same
  // property on three orbits including a highly eccentric one, where the
  // velocity changes fastest and Hermite has the most work to do.
  const orbits = new InterpolatedOrbits(RECS, DEFAULT_WINDOW_SECONDS);
  let worst = 0;
  for (let i = 0; i < RECS.length; i++) {
    for (let ms = 0; ms <= 60_000; ms += TICK_MS) {
      const at = FROM.getTime() + ms;
      const got = orbits.positionAt(i, new Date(at));
      assert.ok(got, 'fixture must interpolate');
      const truth = truthAt(RECS[i], at);
      const d = Math.hypot(got.x - truth.x, got.y - truth.y, got.z - truth.z);
      if (d > worst) worst = d;
    }
  }
  assert.ok(worst < 0.05, `worst interpolation error ${(worst * 1000).toFixed(1)} m exceeds 50 m`);
});

test('a whole minute of ticks costs a handful of propagations per object, not one per tick', () => {
  const orbits = new InterpolatedOrbits(RECS, DEFAULT_WINDOW_SECONDS);
  const ticks = 60_000 / TICK_MS; // 240 ticks
  for (let ms = 0; ms <= 60_000; ms += TICK_MS) {
    for (let i = 0; i < RECS.length; i++) orbits.positionAt(i, new Date(FROM.getTime() + ms));
  }
  const naive = (ticks + 1) * RECS.length;
  // Two propagations per object per 8 s window: about 16 per object per minute.
  assert.ok(
    orbits.propagations < naive / 8,
    `${orbits.propagations} propagations against ${naive} for per-tick SGP4`
  );
});

test('refresh windows are staggered, so objects do not all re-bracket on one tick', () => {
  // A shared window boundary would replace a steady cost with a periodic stall
  // the size of a full-catalogue propagation — the exact thing being removed.
  //
  // The first tick is excluded deliberately: nothing is cached yet, so it
  // necessarily brackets every object. What matters is the steady state, and
  // measuring from cold conflates the two — which is how this test failed on its
  // first writing while the stagger was working correctly.
  const count = 12;
  const many = new InterpolatedOrbits(RECS.concat(RECS, RECS, RECS), 8);
  for (let i = 0; i < count; i++) many.positionAt(i, FROM);

  const spikes: number[] = [];
  for (let ms = TICK_MS; ms <= 40_000; ms += TICK_MS) {
    const before = many.propagations;
    for (let i = 0; i < count; i++) many.positionAt(i, new Date(FROM.getTime() + ms));
    spikes.push(many.propagations - before);
  }

  const worstTick = Math.max(...spikes);
  const busyTicks = spikes.filter((s) => s > 0).length;
  // Well under a full re-bracket, and spread over many ticks rather than a few.
  assert.ok(worstTick <= 4, `a single tick re-bracketed ${worstTick / 2} objects at once`);
  assert.ok(busyTicks > 8, `refreshes bunched into only ${busyTicks} ticks`);
});

test('the same instant gives the same position however the caller arrives at it', () => {
  // Scrubbing backwards must not shift the field. Window placement is aligned to
  // a grid rather than to first use, so this holds.
  const forward = new InterpolatedOrbits(RECS);
  const backward = new InterpolatedOrbits(RECS);
  const probe = FROM.getTime() + 5_500;
  for (let ms = 0; ms <= 11_000; ms += TICK_MS) forward.positionAt(0, new Date(FROM.getTime() + ms));
  for (let ms = 11_000; ms >= 0; ms -= TICK_MS) backward.positionAt(0, new Date(FROM.getTime() + ms));
  const a = forward.positionAt(0, new Date(probe))!;
  const b = backward.positionAt(0, new Date(probe))!;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'scrub direction changed the answer');
});

test('look angles from an interpolated position match the full sky sample', () => {
  // The other half of the saving: the conversion to az/el must be equivalent to
  // what skySampleAt does, or the field would be drawn somewhere else.
  const observer = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };
  const observerGd = observerToGeodetic(observer);
  const orbits = new InterpolatedOrbits(RECS);
  for (let i = 0; i < RECS.length; i++) {
    for (const offset of [0, 3_000, 7_750]) {
      const at = new Date(FROM.getTime() + offset);
      const eci = orbits.positionAt(i, at)!;
      const viaInterp = lookAnglesFromEci(eci, observerGd, at);
      const full = skySampleAt(RECS[i], observerGd, at)!;
      assert.ok(
        Math.abs(viaInterp.elevationDeg - full.elevationDeg) < 0.01,
        `elevation ${viaInterp.elevationDeg} against ${full.elevationDeg}`
      );
      assert.ok(
        Math.abs(viaInterp.rangeKm - full.rangeKm) < 0.05,
        `range ${viaInterp.rangeKm} against ${full.rangeKm}`
      );
    }
  }
});
