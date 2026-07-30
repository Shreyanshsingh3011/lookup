import { useState } from 'react';
import { DEFAULT_THRESHOLD_KM, findCloseApproaches, type CloseApproach } from '../lib/conjunctions';
import type { TleRecord } from '../types';

interface Props {
  tles: TleRecord[];
}

type Status = 'idle' | 'scanning' | 'done';

const WINDOW_HOURS = 24;

const timeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function ConjunctionScan({ tles }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [results, setResults] = useState<CloseApproach[]>([]);

  const runScan = () => {
    setStatus('scanning');
    // Let the "scanning…" state paint before the synchronous search runs —
    // this is thousands of SGP4 calls and would otherwise freeze the click.
    setTimeout(() => {
      setResults(findCloseApproaches(tles, new Date(), { windowHours: WINDOW_HOURS }));
      setStatus('done');
    }, 20);
  };

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-space-100">Close-approach scan</h3>
        <p className="text-xs text-space-300 mt-0.5">
          Checks every pair of tracked satellites for how close their real, published trajectories
          come to each other over the next {WINDOW_HOURS} hours.
        </p>
      </div>

      <div className="rounded-lg px-3 py-2.5 text-xs bg-amber-glow/10 border border-amber-glow/30 text-amber-glow leading-relaxed">
        <span className="font-semibold">This is a geometric proximity check, not a collision warning.</span>{' '}
        It has no data on either object's position uncertainty, which real conjunction assessments
        depend on — two objects flagged here are not necessarily at any real risk, and objects it
        doesn't flag aren't guaranteed safe either. For an operational conjunction assessment, use a
        service built for it, such as CelesTrak SOCRATES or Space-Track.
      </div>

      <button
        type="button"
        onClick={runScan}
        disabled={status === 'scanning' || tles.length < 2}
        className="self-start text-xs px-3 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === 'scanning' ? 'Scanning…' : `Scan ${tles.length} tracked satellites`}
      </button>

      {tles.length < 2 && (
        <p className="text-xs text-space-300">Track at least two satellites to scan for close approaches.</p>
      )}

      {status === 'done' && (
        <div>
          {results.length === 0 ? (
            <p className="text-sm text-space-200">
              No pair came within {DEFAULT_THRESHOLD_KM} km of each other in the next {WINDOW_HOURS} hours.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse min-w-[480px]">
                <thead>
                  <tr className="border-b border-space-700/70">
                    <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wider text-space-300">Pair</th>
                    <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wider text-space-300">
                      Closest approach
                    </th>
                    <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wider text-space-300">When</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={`${r.satnumA}-${r.satnumB}`} className="border-b border-space-800/80">
                      <td className="px-2 py-1.5 text-space-100">
                        {r.nameA} <span className="text-space-400">×</span> {r.nameB}
                      </td>
                      <td className="px-2 py-1.5 font-mono text-glow-400">{r.minDistanceKm.toFixed(1)} km</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-space-200">
                        {timeFmt.format(new Date(r.timeOfClosestApproach))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
