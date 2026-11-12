import { PRECISION_MODES, runPrecisionBenchmark } from '../src/research/autonomy/precisionRanging';

console.log('SYNTHETIC COOPERATIVE RANGING BENCHMARK — NOT PHYSICAL SPACECRAFT ACCURACY');
console.log('10 known transponders, ideal case 0.35 mm iid Gaussian range noise, perfect calibration, seeded synthetic truth');
console.log('mode | valid/trials | RMS 3D (mm) | P95 error (mm) | envelope coverage of accepted (%)');
for (const m of PRECISION_MODES) {
  const r = runPrecisionBenchmark(m.id, 256);
  console.log([
    m.id, r.accepted + '/' + r.trials,
    r.rms3dMm === null ? 'N/A' : r.rms3dMm.toFixed(6),
    r.p95ErrorMm === null ? 'N/A' : r.p95ErrorMm.toFixed(6),
    r.envelopeCoveragePercent === null ? 'N/A' : r.envelopeCoveragePercent.toFixed(2),
  ].join(' | '));
}
