import { useMemo, useState } from 'react';
import { PredictiveTrajectory } from './PredictiveTrajectory';
import { PrecisionBenchmark } from './PrecisionBenchmark';
import {
  estimateOpticalPosition,
  makeScenario,
  SCENARIOS,
  type PointKm,
  type ScenarioId,
} from '../research/autonomy/opticalNavigation';

const plotX = (p: PointKm) => 50 + (p.x + 85) * 2.25;
const plotY = (p: PointKm) => 36 + (120 - p.y) * 1.32;
const km = (n: number | null) => n === null ? 'Unavailable' : n.toFixed(2) + ' km';

/** Synthetic educational navigation only. Never issue actuator commands. */
export function AutonomyResearch() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('nominal');
  const scenario = useMemo(() => makeScenario(scenarioId), [scenarioId]);
  const result = useMemo(() => estimateOpticalPosition(scenario), [scenario]);
  const error = result.positionKm
    ? Math.hypot(
        result.positionKm.x - scenario.groundTruthKm.x,
        result.positionKm.y - scenario.groundTruthKm.y,
      )
    : null;

  return (
    <div className="flex flex-col gap-5">
      <section className="glass-panel rounded-xl p-5 flex flex-col gap-3">
        <div className="flex flex-wrap gap-4 justify-between items-start">
          <div>
            <p className="uppercase tracking-wider text-xs text-glow-400">Sthapana research prototype · WP1</p>
            <h2 className="text-xl font-semibold text-space-100 mt-1">Optical navigation &amp; integrity lab</h2>
            <p className="mt-2 text-sm text-space-200 max-w-2xl">
              Test how independent synthetic camera bearings toward known landmarks produce a
              two-dimensional position fix — and when an integrity gate must reject it.
            </p>
          </div>
          <span className="text-xs font-semibold rounded-lg border border-amber-glow/40 bg-amber-glow/10 px-3 py-2 text-amber-glow">
            SIMULATION ONLY
          </span>
        </div>
        <div className="text-xs leading-relaxed rounded-lg bg-amber-glow/5 border border-amber-glow/30 p-3 text-space-200">
          <strong>Not flight software.</strong> No real camera input, star identification,
          telemetry, collision-warning service, or thruster interface is connected.
          All landmarks and observations are synthetic. A single star bearing cannot determine spacecraft position.
          The uncertainty shown below is approximate and not flight-calibrated.
        </div>
        <label className="flex flex-col gap-1 max-w-md text-sm text-space-200">
          Research test scenario
          <select
            value={scenarioId}
            onChange={e => setScenarioId(e.target.value as ScenarioId)}
            className="rounded-lg border border-space-600 bg-space-900 text-space-100 px-3 py-2"
          >
            {SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <p className="text-sm text-space-300">{scenario.description}</p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(270px,1fr)] gap-4">
        <section className="glass-panel rounded-xl p-4 flex flex-col gap-3">
          <h3 className="font-medium text-space-100">Simulated bearing geometry</h3>
          <p className="text-xs text-space-300">
            Coordinates in km. Dashed rays are reverse-projected landmark bearing lines,
            not spacecraft trajectories or avoidance maneuvers.
          </p>
          <svg viewBox="0 0 550 330" role="img"
            aria-label="Known landmarks, synthetic optical bearing lines, simulation ground truth and estimated position"
            className="w-full h-auto rounded-lg">
            <rect width="550" height="330" rx="12" fill="#0a0e18" />
            {[-60, -20, 20, 60, 100].map(x =>
              <line key={'gridx-' + x} x1={plotX({x,y:0})} x2={plotX({x,y:0})}
                y1="15" y2="310" stroke="#2a3450" strokeWidth="1" />)}
            {[-60, 0, 60, 120].map(y =>
              <line key={'gridy-' + y} y1={plotY({x:0,y})} y2={plotY({x:0,y})}
                x1="15" x2="535" stroke="#2a3450" strokeWidth="1" />)}
            {scenario.landmarks.map(lm => {
              const obs = scenario.observations.find(o => o.landmarkId === lm.id);
              if (!obs?.detected || obs.ageSeconds > 30) return null;
              const a = obs.bearingDeg * Math.PI / 180;
              const endpoint = {
                x: lm.positionKm.x - Math.cos(a) * 160,
                y: lm.positionKm.y - Math.sin(a) * 160,
              };
              return <line key={'ray-' + lm.id}
                x1={plotX(lm.positionKm)} y1={plotY(lm.positionKm)}
                x2={plotX(endpoint)} y2={plotY(endpoint)}
                stroke="#5eead4" strokeOpacity="0.50" strokeDasharray="5 5" strokeWidth="1.3" />;
            })}
            {scenario.landmarks.map(lm =>
              <g key={lm.id}>
                <circle cx={plotX(lm.positionKm)} cy={plotY(lm.positionKm)} r="6" fill="#b8c0d9" />
                <text x={plotX(lm.positionKm) + 9} y={plotY(lm.positionKm) - 9} fontSize="12" fill="#e2e6f2">{lm.id}</text>
              </g>)}
            <circle cx={plotX(scenario.groundTruthKm)} cy={plotY(scenario.groundTruthKm)} r="5" fill="#fbbf24" />
            {result.positionKm && <>
              <ellipse cx={plotX(result.positionKm)} cy={plotY(result.positionKm)}
                rx={2.25 * (result.uncertainty95Km ?? 0)}
                ry={1.32 * (result.uncertainty95Km ?? 0)}
                fill="#2dd4bf" fillOpacity="0.12" stroke="#2dd4bf"
                strokeDasharray="3 3" />
              <circle cx={plotX(result.positionKm)} cy={plotY(result.positionKm)} r="4" fill="#2dd4bf" />
            </>}
          </svg>
          <div className="text-xs text-space-300 flex flex-wrap gap-x-4 gap-y-1">
            <span><span className="text-amber-glow">●</span> Ground truth</span>
            <span><span className="text-glow-400">●</span> Estimated position</span>
            <span><span className="text-space-200">●</span> Known landmark</span>
          </div>
        </section>

        <section className="glass-panel rounded-xl p-4 flex flex-col gap-3">
          <h3 className="font-medium text-space-100">Navigation integrity gate</h3>
          <span className={'self-start text-xs font-semibold rounded-md border px-3 py-2 ' +
            (result.status === 'ADVISORY'
              ? 'border-glow-600/40 bg-glow-600/10 text-glow-400'
              : 'border-amber-glow/40 bg-amber-glow/10 text-amber-glow')}>
            {result.status === 'ADVISORY' ? 'SIMULATED FIX · ADVISORY' : 'HOLD · FIX NOT TRUSTWORTHY'}
          </span>
          <p className="text-sm text-space-200">{result.reason}</p>
          <dl className="grid grid-cols-2 gap-3 border-t border-space-700/70 pt-3 text-xs">
            <div><dt className="text-space-300">Accepted observations</dt>
              <dd className="text-space-100 font-mono text-lg">{result.usedObservations}/{scenario.observations.length}</dd></div>
            <div><dt className="text-space-300">Rejected observations</dt>
              <dd className="text-space-100 font-mono text-lg">{result.rejectedObservations}</dd></div>
            <div><dt className="text-space-300">Ground truth error</dt>
              <dd className="text-space-100 font-mono">{km(error)}</dd></div>
            <div><dt className="text-space-300">Cross-track RMS residual</dt>
              <dd className="text-space-100 font-mono">{km(result.residualRmsKm)}</dd></div>
            <div><dt className="text-space-300">Illustrative uncertainty radius</dt>
              <dd className="text-space-100 font-mono">{km(result.uncertainty95Km)}</dd></div>
            <div><dt className="text-space-300">Geometry condition</dt>
              <dd className="text-space-100 font-mono">{result.conditionNumber?.toFixed(2) ?? 'Unavailable'}</dd></div>
          </dl>
          <p className="text-xs border-t border-space-700/70 pt-3 text-space-300">
            Even an ADVISORY result cannot authorise a manoeuvre.
            A HOLD means the simulated estimate cannot be trusted.
          </p>
        </section>
      </div>

      <PredictiveTrajectory />

      <PrecisionBenchmark />

      <section className="glass-panel rounded-xl p-4">
        <h3 className="font-medium text-space-100 text-sm">What comes next</h3>
        <p className="text-sm text-space-200 mt-2">
          This research lab now includes the original 2D synthetic bearing-line estimator
          and a separate simplified 3D position-and-velocity prediction simulator.
          Neither uses live cameras, spacecraft sensors or certified orbital dynamics.
          True multi-angle image processing, IMU fusion, calibrated uncertainty,
          collision-risk analysis and autonomous guidance remain future milestones.
        </p>
        <p className="text-xs text-space-300 mt-3">
          <a className="text-glow-400 underline" href="https://github.com/Shreyanshsingh3011/lookup/blob/claude/satellite-tracking-3d-sky-ues006/AUTONOMY_ENGINEERING_ROADMAP.md" target="_blank" rel="noreferrer">Engineering roadmap</a>
          {' · '}
          <a className="text-glow-400 underline" href="https://github.com/Shreyanshsingh3011/lookup/blob/claude/satellite-tracking-3d-sky-ues006/AUTONOMOUS_SPACECRAFT_VISION.md" target="_blank" rel="noreferrer">Long-term vision</a>
        </p>
      </section>
    </div>
  );
}
