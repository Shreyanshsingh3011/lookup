import { useMemo, useState } from 'react';
import {
  PRECISION_GOAL_RMS_MM,
  PRECISION_STRETCH_RMS_MM,
  PRECISION_MODES,
  runPrecisionBenchmark,
  type PrecisionMode,
} from '../research/autonomy/precisionRanging';

const MM = (n: number | null) => n === null ? 'No valid fix' : n.toFixed(3) + ' mm';
const PCT = (n: number | null) => n === null ? 'N/A' : n.toFixed(1) + '%';

/**
 * Deterministic simulation leaderboard. NEVER equate its millimetre numbers
 * with physical spacecraft precision or operational flight qualification.
 */
export function PrecisionBenchmark() {
  const [selected, setSelected] = useState<PrecisionMode>('ideal');
  const results = useMemo(
    () => PRECISION_MODES.map(({ id }) => runPrecisionBenchmark(id, 256)),
    [],
  );
  const mode = PRECISION_MODES.find(item => item.id === selected)!;
  const active = results.find(r => r.mode === selected)!;
  const subMillimetre = active.rms3dMm !== null &&
    active.rms3dMm < PRECISION_GOAL_RMS_MM && active.accepted === active.trials;

  return (
    <section className="glass-panel rounded-xl p-5 flex flex-col gap-4 print:hidden">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="uppercase text-xs tracking-wide text-glow-400">WP1.6 · precision research benchmark</p>
          <h3 className="text-lg font-semibold mt-1 text-space-100">Can we beat a 1 mm simulation target?</h3>
          <p className="text-sm mt-1 text-space-200">
            Deterministic 3-D trilateration from ten simulated cooperative ranging transponders.
            Each scenario repeats 256 seeded trials with separately hidden ground truth.
          </p>
        </div>
        <span className="text-xs font-semibold text-amber-glow border border-amber-glow/40 rounded-md px-3 py-2">
          HYPOTHETICAL SENSORS — NO FLIGHT DATA
        </span>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg bg-space-900/60 p-3 border border-space-700/60">
          <div className="text-xs text-space-300">Research goal</div>
          <div className="font-mono text-lg text-space-100">Below {PRECISION_GOAL_RMS_MM} mm</div>
        </div>
        <div className="rounded-lg bg-space-900/60 p-3 border border-space-700/60">
          <div className="text-xs text-space-300">Stretch goal</div>
          <div className="font-mono text-lg text-space-100">Below {PRECISION_STRETCH_RMS_MM} mm</div>
        </div>
        <div className="rounded-lg bg-space-900/60 p-3 border border-space-700/60">
          <div className="text-xs text-space-300">Trials per scenario</div>
          <div className="font-mono text-lg text-space-100">256</div>
        </div>
        <div className="rounded-lg bg-space-900/60 p-3 border border-space-700/60">
          <div className="text-xs text-space-300">Reference frame</div>
          <div className="font-mono text-lg text-space-100">Local 3D</div>
        </div>
      </div>

      <label className="text-xs text-space-200 flex flex-col gap-2 max-w-lg">
        Select sensor conditions
        <select value={selected} onChange={e => setSelected(e.target.value as PrecisionMode)}
          className="rounded-lg border border-space-600 bg-space-900 text-space-100 px-3 py-2">
          {PRECISION_MODES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
      <p className="text-xs text-space-300">{mode.note}</p>

      <div className="flex flex-wrap gap-3 items-start">
        <span className={'rounded-lg border px-3 py-2 text-sm font-medium ' +
          (subMillimetre ? 'text-glow-400 border-glow-600/40 bg-glow-600/10'
            : 'text-amber-glow border-amber-glow/40 bg-amber-glow/10')}>
          {subMillimetre ? 'Synthetic 1 mm target passed' : 'Synthetic 1 mm target not demonstrated'}
        </span>
        <span className="text-xs text-space-300 pt-2">
          This status does NOT mean Lookup outperforms any deployed spacecraft system.
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <div className="text-xs text-space-300">3D RMS error</div>
          <div className="font-mono text-lg font-semibold text-space-100">{MM(active.rms3dMm)}</div>
        </div>
        <div>
          <div className="text-xs text-space-300">95th-percentile error</div>
          <div className="font-mono text-lg font-semibold text-space-100">{MM(active.p95ErrorMm)}</div>
        </div>
        <div>
          <div className="text-xs text-space-300">Valid fixes</div>
          <div className="font-mono text-lg font-semibold text-space-100">{active.accepted}/{active.trials}</div>
        </div>
        <div>
          <div className="text-xs text-space-300">Model-envelope coverage*</div>
          <div className="font-mono text-lg font-semibold text-space-100">{PCT(active.envelopeCoveragePercent)}</div>
        </div>
      </div>

      <p className="text-xs text-space-300">
        Rejected individual readings: <strong className="text-space-100">{active.rejectedMeasurements}</strong>
        {' · '}Rejected complete fixes: <strong className="text-space-100">{active.trials - active.accepted}</strong>
        {' · '}Stretch target: <strong className="text-space-100">
          {active.rms3dMm !== null && active.rms3dMm < PRECISION_STRETCH_RMS_MM && active.accepted === active.trials
            ? 'Passed under this synthetic setup' : 'Not demonstrated'}
        </strong>
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs min-w-[610px]">
          <thead className="text-space-300 border-b border-space-700">
            <tr>
              <th className="py-2 pr-2">Scenario</th>
              <th className="py-2 pr-2">RMS 3D error</th>
              <th className="py-2 pr-2">P95 error</th>
              <th className="py-2 pr-2">Accepted</th>
              <th className="py-2">Nominal envelope coverage*</th>
            </tr>
          </thead>
          <tbody className="text-space-200">
            {results.map(row => <tr key={row.mode}
              className={'border-b border-space-800/80 '+(selected===row.mode?'bg-space-700/30':'')}>
              <td className="py-2 pr-2">
                <button type="button" className="text-glow-400 hover:underline text-left"
                  onClick={() => setSelected(row.mode)}>
                  {PRECISION_MODES.find(m=>m.id===row.mode)!.name}
                </button>
              </td>
              <td className="py-2 pr-2 font-mono">{MM(row.rms3dMm)}</td>
              <td className="py-2 pr-2 font-mono">{MM(row.p95ErrorMm)}</td>
              <td className="py-2 pr-2 font-mono">{row.accepted}/{row.trials}</td>
              <td className="py-2 font-mono">{PCT(row.envelopeCoveragePercent)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-relaxed text-space-300">
        *Coverage is calculated only among accepted fixes and uses a conservative
        spherical covariance approximation. It is not certified statistical coverage
        and low availability must not be hidden by a favourable RMS error.
      </p>
      <div className="rounded-lg p-3 border border-amber-glow/30 bg-amber-glow/5 text-xs text-space-200 leading-relaxed">
        <strong>Interpretation:</strong> Sub-millimetre simulation is possible when
        we assume sub-millimetre ranging sensors, accurate calibration, a known 3-D
        transponder geometry, a nearby cooperative target and synchronous measurements.
        Those capabilities have NOT been built or demonstrated on real hardware.
        StarFOX optical angles-only orbit navigation and GNSS carrier-phase relative
        orbit positioning solve different problems. Their published results cannot
        be compared directly with this short-baseline thought experiment.
      </div>
      <div className="text-xs text-space-300">
        Published reference: <a className="text-glow-400 underline" href="https://www.ion.org/publications/abstract.cfm?articleID=20605"
          target="_blank" rel="noreferrer">ION 2026 Galileo HAS precision relative orbit determination</a>
        {' · '}
        <a className="text-glow-400 underline" href="https://ntrs.nasa.gov/citations/20240007230"
          target="_blank" rel="noreferrer">NASA StarFOX results</a>
      </div>
    </section>
  );
}
