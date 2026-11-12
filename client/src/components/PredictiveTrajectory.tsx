import { useMemo, useState } from 'react';
import {
  MAX_HORIZON_SECONDS, PRESENT_SECONDS, simulatePrediction,
  type PredictedState, type Vector3,
} from '../research/autonomy/predictiveNavigation';

type Projected = { x: number; y: number };
function project(position: Vector3, yawDegrees: number): Projected {
  const a = yawDegrees * Math.PI / 180;
  const rotatedX = position.x * Math.cos(a) - position.y * Math.sin(a);
  const rotatedY = position.x * Math.sin(a) + position.y * Math.cos(a);
  return { x: rotatedX, y: 0.65 * position.z + 0.42 * rotatedY };
}
function formatKm(value: number): string { return value.toFixed(3) + ' km'; }
function stateVelocityMs(state: PredictedState): number {
  const v = state.velocityKmPerS;
  return Math.hypot(v.x, v.y, v.z) * 1000;
}
function coordText(p: Vector3): string {
  return [p.x, p.y, p.z].map(v => v.toFixed(3)).join(' / ');
}

/**
 * All measurement and motion data are synthetic. The "360-degree view" control
 * rotates a *visualisation*, not a sensor array or real external observations.
 */
export function PredictiveTrajectory() {
  const [horizon, setHorizon] = useState(300);
  const [yaw, setYaw] = useState(40);
  const [followUp, setFollowUp] = useState(true);
  const [maneuver, setManeuver] = useState(false);

  const model = useMemo(() => simulatePrediction({
    horizonSeconds: horizon, followUpObservation: followUp,
    unexpectedManeuver: maneuver,
  }), [horizon, followUp, maneuver]);

  const scene = useMemo(() => {
    const historic = model.history.map(s => project(s.positionKm, yaw));
    const forecast = model.forecast.map(s => project(s.positionKm, yaw));
    const future = project(model.future.positionKm, yaw);
    const current = project(model.now.positionKm, yaw);
    const truth = project(model.truthFutureKm, yaw);
    const radius = Math.max(model.future.uncertainty95Km, model.now.uncertainty95Km, 0.05);
    const xs = [...historic, ...forecast, truth].map(p => p.x);
    const ys = [...historic, ...forecast, truth].map(p => p.y);
    const loX = Math.min(...xs) - radius * 1.25 - 0.4;
    const hiX = Math.max(...xs) + radius * 1.25 + 0.4;
    const loY = Math.min(...ys) - radius * 1.25 - 0.4;
    const hiY = Math.max(...ys) + radius * 1.25 + 0.4;
    const scale = Math.min(520 / (hiX - loX), 228 / (hiY - loY));
    const midX = (hiX + loX) / 2;
    const midY = (hiY + loY) / 2;
    const xy = (p: Projected) => ({
      x: 310 + (p.x - midX) * scale,
      y: 147 - (p.y - midY) * scale,
    });
    const line = (points: Projected[]) => points.map((p, i) => {
      const pt = xy(p);
      return (i === 0 ? 'M' : 'L') + pt.x.toFixed(2) + ' ' + pt.y.toFixed(2);
    }).join(' ');
    return {
      historic: line(historic), forecast: line(forecast),
      current: xy(current), future: xy(future), truth: xy(truth),
      radiusPx: model.future.uncertainty95Km * scale,
    };
  }, [model, yaw]);

  const samples = model.forecast.filter(s =>
    [PRESENT_SECONDS, PRESENT_SECONDS + 60, PRESENT_SECONDS + 180,
      PRESENT_SECONDS + 300, PRESENT_SECONDS + 600].includes(s.seconds),
  );

  return (
    <section className="glass-panel rounded-xl p-5 flex flex-col gap-4 print:hidden">
      <div className="flex gap-3 items-start justify-between flex-wrap">
        <div className="max-w-2xl">
          <p className="text-xs text-glow-400 uppercase tracking-wider">WP1.5 · simulated 3D tracking</p>
          <h3 className="text-lg font-semibold text-space-100 mt-1">Position now, motion &amp; future prediction</h3>
          <p className="text-sm text-space-200 mt-2">
            Track a synthetic object in a local XYZ reference frame. Rotate the view through
            360°, look ahead in time, and compare model predictions with simulated ground truth.
          </p>
        </div>
        <span className="text-amber-glow text-xs border border-amber-glow/40 bg-amber-glow/10 rounded-md px-2.5 py-1.5 font-semibold">
          SIMULATION · NOT FLIGHT DATA
        </span>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-xs text-space-200 flex flex-col gap-2">
          <span className="flex justify-between gap-2">Prediction horizon <strong className="text-glow-400">+{horizon} seconds</strong></span>
          <input type="range" min="0" max={MAX_HORIZON_SECONDS} step="30"
            value={horizon} onChange={e => setHorizon(Number(e.target.value))} />
        </label>
        <label className="text-xs text-space-200 flex flex-col gap-2">
          <span className="flex justify-between gap-2">360° viewing angle <strong className="text-glow-400">{yaw}°</strong></span>
          <input type="range" min="0" max="360" step="15"
            value={yaw} onChange={e => setYaw(Number(e.target.value))} />
        </label>
      </div>

      <div className="flex flex-col sm:flex-row flex-wrap gap-4 text-sm text-space-200">
        <label className="inline-flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={followUp}
            onChange={e => setFollowUp(e.target.checked)} />
          <span>Fuse a second synthetic 3D observation at t=45s</span>
        </label>
        <label className="inline-flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={maneuver}
            onChange={e => setManeuver(e.target.checked)} />
          <span>Introduce an unannounced maneuver after t=120s</span>
        </label>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,1fr)] gap-4">
        <div className="bg-space-900/80 rounded-lg border border-space-700/60 p-3">
          <svg viewBox="0 0 620 300" className="w-full h-auto"
            role="img" aria-label="Rotatable schematic projection of simulated 3D history, forecast uncertainty and simulated truth">
            <rect x="0" y="0" width="620" height="300" rx="10" fill="#0a0e18" />
            {Array.from({length:7},(_,i)=>
              <line key={'h'+i} x1="20" x2="600" y1={25+i*42} y2={25+i*42} stroke="#26314a" strokeWidth="0.8" />)}
            {Array.from({length:9},(_,i)=>
              <line key={'v'+i} y1="15" y2="285" x1={25+i*71} x2={25+i*71} stroke="#26314a" strokeWidth="0.8" />)}
            <path d={scene.historic} fill="none" stroke="#b8c0d9" strokeWidth="2" />
            <path d={scene.forecast} fill="none" stroke="#14b8a6" strokeWidth="2.3" strokeDasharray="5 5" />
            <circle cx={scene.future.x} cy={scene.future.y} r={Math.max(0,scene.radiusPx)}
              fill="#2dd4bf" fillOpacity=".11" stroke="#2dd4bf" strokeOpacity=".55" strokeDasharray="4 4" />
            <circle cx={scene.current.x} cy={scene.current.y} r="6" fill="#e2e6f2" />
            <circle cx={scene.future.x} cy={scene.future.y} r="6" fill="#2dd4bf" stroke="#0a0e18" strokeWidth="1.6"/>
            <circle cx={scene.truth.x} cy={scene.truth.y} r="4.5" fill="#fbbf24" stroke="#0a0e18" strokeWidth="1.2"/>
            <text x="16" y="20" fill="#8b95b3" fontSize="11">Local XYZ · rotated visual projection</text>
            <text x="16" y="285" fill="#8b95b3" fontSize="10">Rotation changes the view, not the measurements</text>
          </svg>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-space-300 mt-2">
            <span><span className="text-space-100">●</span> Current estimate</span>
            <span><span className="text-glow-400">●</span> Future estimate &amp; model envelope</span>
            <span><span className="text-amber-glow">●</span> Simulated future truth</span>
          </div>
          <p className="text-xs text-space-400 mt-2">
            The shaded circle is an illustrative projection of a conservative Gaussian-model uncertainty sphere,
            not a guaranteed physical 95% coverage bound.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-space-700/70 bg-space-900/50 p-3">
            <p className="text-xs text-space-300">Current estimated XYZ (km), at t=45s</p>
            <p className="font-mono text-sm text-space-100 mt-1">{coordText(model.now.positionKm)}</p>
            <p className="text-xs text-space-300 mt-2">Current model uncertainty radius: <strong className="text-space-100">{formatKm(model.now.uncertainty95Km)}</strong></p>
          </div>
          <div className="rounded-lg border border-glow-600/30 bg-glow-600/5 p-3">
            <p className="text-xs text-space-300">Predicted XYZ (km), t=+{horizon}s from now</p>
            <p className="font-mono text-sm text-space-100 mt-1">{coordText(model.future.positionKm)}</p>
            <p className="text-xs text-space-300 mt-2">Projected uncertainty radius: <strong className="text-space-100">{formatKm(model.future.uncertainty95Km)}</strong></p>
            <p className="text-xs text-space-300 mt-1">Estimated relative speed: <strong className="text-space-100">{stateVelocityMs(model.future).toFixed(2)} m/s</strong></p>
          </div>
          <div className="rounded-lg border border-space-700/70 bg-space-900/50 p-3 text-xs space-y-2">
            <p className="text-space-300">Simulation-only future position error: <strong className="text-space-100">{formatKm(model.errorFutureKm)}</strong></p>
            <p className={model.truthInside95Sphere ? 'text-glow-400' : 'text-amber-glow'}>
              {model.truthInside95Sphere ? 'Synthetic truth lies inside the model envelope' : 'Synthetic truth falls outside the model envelope'}
            </p>
            <p className="text-space-300">
              {model.updateAccepted ? 'Additional observation accepted; estimate updated.' : 'No second observation; estimate is coasting.'}
            </p>
            {model.modelMismatch &&
              <p className="text-amber-glow">Unknown maneuver violates the constant-velocity forecast assumptions.</p>}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[510px] text-xs text-left text-space-200">
          <thead className="text-space-300 border-b border-space-700">
            <tr>
              <th className="py-2 pr-3">Look-ahead</th>
              <th className="py-2 pr-3">X (km)</th>
              <th className="py-2 pr-3">Y (km)</th>
              <th className="py-2 pr-3">Z (km)</th>
              <th className="py-2">Model radius (km)</th>
            </tr>
          </thead>
          <tbody>
            {samples.map(s =>
              <tr key={s.seconds} className="border-b border-space-800">
                <td className="py-2 pr-3 font-mono">+{s.seconds - PRESENT_SECONDS}s</td>
                <td className="py-2 pr-3 font-mono">{s.positionKm.x.toFixed(3)}</td>
                <td className="py-2 pr-3 font-mono">{s.positionKm.y.toFixed(3)}</td>
                <td className="py-2 pr-3 font-mono">{s.positionKm.z.toFixed(3)}</td>
                <td className="py-2 font-mono">{s.uncertainty95Km.toFixed(3)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-amber-glow/90 leading-relaxed">
        This is a constant-velocity local reference-frame research model with synthetic initial 3D
        detection, a velocity prior and optional follow-up position measurement. A single camera
        direction does not establish 3D range or velocity. Camera integration, orbital dynamics,
        uncertainty calibration, collision-risk forecasting and spacecraft actuation are NOT implemented.
        No forecast is 100% accurate.
      </p>
    </section>
  );
}
