import { useState } from 'react';
import { fetchOrbitAdvice } from '../api/client';
import { MISSION_TYPE_LABELS, MISSION_TYPES, type MissionType, type OrbitAdviceResult } from '../lib/orbitAdvice';
import type { Observer } from '../types';

interface Props {
  observer: Observer;
}

type Status = 'idle' | 'loading' | 'result' | 'error';

const MAX_GOAL_LENGTH = 500;
const MAX_TIMING_LENGTH = 200;

export function OrbitAdvisor({ observer }: Props) {
  const [missionType, setMissionType] = useState<MissionType>('earth-observation');
  const [missionGoal, setMissionGoal] = useState('');
  const [timingNotes, setTimingNotes] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<OrbitAdviceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const goalTooLong = missionGoal.length > MAX_GOAL_LENGTH;
  const timingTooLong = timingNotes.length > MAX_TIMING_LENGTH;
  const canSubmit = missionGoal.trim().length > 0 && !goalTooLong && !timingTooLong && status !== 'loading';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('loading');
    setResult(null);
    setError(null);
    fetchOrbitAdvice({
      missionType,
      missionGoal: missionGoal.trim(),
      launchSiteLatitudeDeg: observer.latitude,
      timingNotes: timingNotes.trim() || null,
    })
      .then((r) => {
        setResult(r);
        setStatus('result');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to get orbit advice');
        setStatus('error');
      });
  };

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-space-100">Mission orbit advisor</h3>
        <p className="text-xs text-space-300 mt-0.5">
          Describe what you're trying to accomplish and get orbital-mechanics guidance grounded in real physics —
          not a real launch quote. It doesn't know current providers, prices, or schedules.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-space-300">
          Mission type
          <select
            value={missionType}
            onChange={(e) => setMissionType(e.target.value as MissionType)}
            className="bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
          >
            {MISSION_TYPES.map((t) => (
              <option key={t} value={t}>
                {MISSION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-space-300">
          What are you trying to accomplish?
          <textarea
            value={missionGoal}
            onChange={(e) => setMissionGoal(e.target.value)}
            placeholder="e.g. Monitor crop health over a specific region on a weekly cadence"
            rows={2}
            className="bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm resize-none focus:outline-none focus:border-glow-500"
          />
          <span className={goalTooLong ? 'text-amber-glow' : 'text-space-400'}>
            {missionGoal.length}/{MAX_GOAL_LENGTH}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-[11px] text-space-300">
          Timing preference (optional)
          <input
            type="text"
            value={timingNotes}
            onChange={(e) => setTimingNotes(e.target.value)}
            placeholder="e.g. within the next year, no rush, as soon as possible"
            className="bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
          />
          <span className={timingTooLong ? 'text-amber-glow' : 'text-space-400'}>
            {timingNotes.length}/{MAX_TIMING_LENGTH}
          </span>
        </label>

        <div className="text-[11px] text-space-400">
          Launch site latitude: <span className="font-mono text-space-200">{observer.latitude.toFixed(2)}°</span>{' '}
          (from your observer location above)
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="self-start text-xs px-3 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {status === 'loading' ? 'Thinking…' : 'Get orbit advice'}
        </button>
      </form>

      {status === 'error' && error && (
        <div className="text-xs text-amber-glow border-t border-space-700/60 pt-3">{error}</div>
      )}

      {status === 'result' && result && (
        <div className="text-sm text-space-200 leading-relaxed border-t border-space-700/60 pt-3 whitespace-pre-line">
          {result.advice}
        </div>
      )}
    </div>
  );
}
