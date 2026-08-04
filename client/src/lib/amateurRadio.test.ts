import { strict as assert } from 'node:assert';
import test from 'node:test';
import * as satellite from 'satellite.js';
import {
  dopplerShiftHz,
  formatFrequency,
  formatShift,
  radioPasses,
  rangeSample,
  receivedFrequencyHz,
  transmitFrequencyHz,
} from './amateurRadio';

// A real ISS element set, epoch day 212.5 of 2026 — 31 July, midday.
const ISS = satellite.twoline2satrec(
  '1 25544U 98067A   26212.50000000  .00016717  00000-0  10270-3 0  9004',
  '2 25544  51.6393 339.7896 0004825 137.7699 222.3564 15.50227766    09'
);
const EPOCH = new Date('2026-07-31T12:00:00Z');

const LONDON = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };
const VHF_HZ = 145_800_000; // the ISS packet and SSTV downlink
const UHF_HZ = 437_800_000; // the ISS voice repeater downlink

test('range and range rate come out physical', () => {
  const sample = rangeSample(ISS, LONDON, EPOCH)!;
  assert.ok(sample, 'the station must propagate at its own epoch');
  // Nothing in low orbit is closer than its altitude or further than the
  // slant range to the horizon, about 2400 km for the ISS.
  assert.ok(sample.rangeKm > 300 && sample.rangeKm < 12_000, `range ${sample.rangeKm.toFixed(0)} km`);
  // Range rate can never exceed the orbital speed itself.
  assert.ok(Math.abs(sample.rangeRateKmS) < 8, `range rate ${sample.rangeRateKmS.toFixed(2)} km/s`);
  assert.ok(sample.elevationDeg >= -90 && sample.elevationDeg <= 90);
  assert.ok(sample.azimuthDeg >= 0 && sample.azimuthDeg < 360);
});

test('range rate is the derivative of range, checked numerically', () => {
  // The whole feature rests on this one number, and a sign error in it would
  // be invisible in the UI while telling every operator to tune the wrong way.
  const dt = 2; // seconds
  for (const offsetMinutes of [0, 7, 19, 34, 51]) {
    const at = new Date(EPOCH.getTime() + offsetMinutes * 60_000);
    const before = rangeSample(ISS, LONDON, new Date(at.getTime() - dt * 500))!;
    const after = rangeSample(ISS, LONDON, new Date(at.getTime() + dt * 500))!;
    const here = rangeSample(ISS, LONDON, at)!;

    const numerical = (after.rangeKm - before.rangeKm) / dt;
    assert.ok(
      Math.abs(numerical - here.rangeRateKmS) < 0.01,
      `at +${offsetMinutes} min: analytic ${here.rangeRateKmS.toFixed(4)}, numerical ${numerical.toFixed(4)} km/s`
    );
  }
});

test('the ISS Doppler matches the figures operators actually use', () => {
  // Every ham knows these: about ±3.5 kHz on 2 m and ±10 kHz on 70 cm for the
  // station. If the arithmetic were out by even a factor of two this would
  // fail, and the numbers are memorable enough to check against the world.
  let maxVhf = 0;
  let maxUhf = 0;
  for (let minute = 0; minute < 1440; minute += 1) {
    const sample = rangeSample(ISS, LONDON, new Date(EPOCH.getTime() + minute * 60_000));
    if (!sample || sample.elevationDeg <= 0) continue;
    maxVhf = Math.max(maxVhf, Math.abs(dopplerShiftHz(VHF_HZ, sample.rangeRateKmS)));
    maxUhf = Math.max(maxUhf, Math.abs(dopplerShiftHz(UHF_HZ, sample.rangeRateKmS)));
  }
  assert.ok(maxVhf > 2500 && maxVhf < 4200, `2 m peak shift was ${maxVhf.toFixed(0)} Hz, expected ~3.5 kHz`);
  assert.ok(maxUhf > 7500 && maxUhf < 12_500, `70 cm peak shift was ${maxUhf.toFixed(0)} Hz, expected ~10 kHz`);
  // And the shift scales with frequency, since it is a fractional effect.
  assert.ok(Math.abs(maxUhf / maxVhf - UHF_HZ / VHF_HZ) < 0.1);
});

test('approaching means high, receding means low', () => {
  // The sign convention is the thing an operator would notice first and the
  // easiest to get backwards.
  const approaching = -5; // km/s, closing
  const receding = 5;

  assert.ok(receivedFrequencyHz(VHF_HZ, approaching) > VHF_HZ, 'a closing satellite arrives high');
  assert.ok(receivedFrequencyHz(VHF_HZ, receding) < VHF_HZ, 'a departing one arrives low');
  assert.ok(dopplerShiftHz(VHF_HZ, approaching) > 0);

  // The uplink correction runs the other way: transmit low into an approaching
  // satellite, because its motion toward you raises what it hears.
  assert.ok(transmitFrequencyHz(VHF_HZ, approaching) < VHF_HZ, 'transmit low at a closing satellite');
  assert.ok(transmitFrequencyHz(VHF_HZ, receding) > VHF_HZ);

  // At closest approach there is no shift at all. Compared by magnitude:
  // the arithmetic yields a signed zero, which is the same frequency.
  assert.equal(receivedFrequencyHz(VHF_HZ, 0), VHF_HZ);
  assert.equal(transmitFrequencyHz(VHF_HZ, 0), VHF_HZ);
  assert.equal(Math.abs(dopplerShiftHz(VHF_HZ, 0)), 0);
});

test('the observer’s own rotation is included', () => {
  // A geostationary satellite and a ground station co-rotate rigidly, so the
  // distance between them never changes and the range rate is exactly zero.
  // That makes it the decisive test for this term: omit the station's own
  // 465 m/s and the same geometry reports 0.2465 km/s of range rate, which at
  // 435 MHz would be 358 Hz of Doppler on a satellite that has none.
  const geo = satellite.twoline2satrec(
    '1 99999U 26001A   26212.50000000  .00000000  00000-0  00000-0 0  9992',
    '2 99999   0.0050  75.0000 0000100   0.0000   0.0000  1.00270000    05'
  );
  assert.equal(geo.error, 0, 'the synthetic geostationary elements must parse');

  let worst = 0;
  let samples = 0;
  for (const observer of [LONDON, { latitude: 0, longitude: 20, elevation: 0 }]) {
    for (let hour = 0; hour < 24; hour += 1) {
      const sample = rangeSample(geo, observer, new Date(EPOCH.getTime() + hour * 3_600_000));
      if (!sample || sample.elevationDeg <= 0) continue;
      samples++;
      worst = Math.max(worst, Math.abs(sample.rangeRateKmS));
    }
  }
  assert.ok(samples > 10, `expected the geostationary satellite to be visible, got ${samples} samples`);
  assert.ok(worst < 0.01, `a geostationary satellite must not appear to move: ${worst.toFixed(4)} km/s`);
});

test('radio passes are found in daylight too, unlike visible ones', () => {
  // The point of the whole feature. Optical passes need the observer dark and
  // the satellite lit, which throws away most of the day; a radio pass needs
  // neither. There must be far more of them.
  const passes = radioPasses(ISS, LONDON, EPOCH, 24);
  assert.ok(passes.length >= 4, `expected several ISS passes a day, got ${passes.length}`);
  assert.ok(passes.length <= 12, `implausibly many: ${passes.length}`);

  for (let i = 1; i < passes.length; i++) {
    assert.ok(passes[i].aos > passes[i - 1].aos, 'passes must be in order');
    assert.ok(passes[i].aos > passes[i - 1].los, 'passes must not overlap');
  }
});

test('each pass is internally consistent', () => {
  for (const pass of radioPasses(ISS, LONDON, EPOCH, 24)) {
    assert.ok(pass.los > pass.aos, 'a pass must end after it starts');
    assert.ok(pass.tca >= pass.aos && pass.tca <= pass.los, 'closest approach falls inside the pass');
    assert.ok(pass.maxElevationDeg > 0, 'a pass must clear the horizon');
    assert.ok(pass.maxElevationDeg <= 90);
    // The ISS is above the horizon for at most about ten minutes.
    assert.ok(
      pass.durationSeconds > 30 && pass.durationSeconds < 900,
      `${pass.durationSeconds}s is not an ISS pass`
    );
    assert.ok(pass.minRangeKm > 300 && pass.minRangeKm < 2600, `min range ${pass.minRangeKm.toFixed(0)} km`);
    assert.ok(pass.aosAzimuthDeg >= 0 && pass.aosAzimuthDeg < 360);
  }
});

test('the Doppler crosses zero at closest approach', () => {
  // This is what makes the time of closest approach the moment to be on the
  // nominal frequency, and it is a property rather than a coincidence.
  for (const pass of radioPasses(ISS, LONDON, EPOCH, 12)) {
    const atTca = rangeSample(ISS, LONDON, pass.tca)!;
    const early = rangeSample(ISS, LONDON, new Date(pass.aos.getTime() + 30_000))!;
    const late = rangeSample(ISS, LONDON, new Date(pass.los.getTime() - 30_000))!;

    assert.ok(early.rangeRateKmS < 0, 'the satellite must be closing just after AOS');
    assert.ok(late.rangeRateKmS > 0, 'and receding just before LOS');
    assert.ok(
      Math.abs(atTca.rangeRateKmS) < Math.abs(early.rangeRateKmS),
      'the shift must be smallest near closest approach'
    );
  }
});

test('a higher minimum elevation yields fewer, better passes', () => {
  const all = radioPasses(ISS, LONDON, EPOCH, 48, 0);
  const good = radioPasses(ISS, LONDON, EPOCH, 48, 30);
  assert.ok(good.length <= all.length);
  for (const pass of good) assert.ok(pass.maxElevationDeg > 30);
});

test('frequencies are formatted the way a radio displays them', () => {
  assert.equal(formatFrequency(145_800_000), '145.8000 MHz');
  assert.equal(formatFrequency(437_800_000), '437.8000 MHz');
  assert.equal(formatShift(3456.7), '+3,457 Hz');
  assert.equal(formatShift(-3456.7), '−3,457 Hz');
  assert.equal(formatShift(0), '+0 Hz');
});
