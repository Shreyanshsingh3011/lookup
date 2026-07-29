import { useMemo, useState } from 'react';
import type { Pass } from '../types';

type SortKey = 'start' | 'magnitude' | 'duration' | 'maxAltitude';
type SortDir = 'asc' | 'desc';

interface Props {
  passes: Pass[];
  loading: boolean;
  error: string | null;
}

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function formatTime(iso: string) {
  return timeFmt.format(new Date(iso));
}

function magClass(mag: number | null) {
  if (mag === null) return 'text-space-300';
  if (mag <= -2) return 'text-glow-400 font-semibold';
  if (mag <= 0) return 'text-glow-500';
  if (mag <= 2) return 'text-space-100';
  return 'text-space-300';
}

function SortHeader({ label, sortKey, active, dir, onSort }: { label: string; sortKey: SortKey; active: boolean; dir: SortDir; onSort: (k: SortKey) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 uppercase tracking-wider text-[11px] font-medium transition hover:text-glow-400 ${active ? 'text-glow-400' : 'text-space-300'}`}
    >
      {label}
      {active && <span className="text-[9px]">{dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

export function PassTable({ passes, loading, error }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('start');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Pass | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = useMemo(() => {
    const withValue = (p: Pass) => {
      switch (sortKey) {
        case 'magnitude':
          return p.magnitude ?? 99;
        case 'duration':
          return p.durationSeconds;
        case 'maxAltitude':
          return p.max.altitudeDeg;
        case 'start':
        default:
          return new Date(p.start.time).getTime();
      }
    };
    const copy = [...passes];
    copy.sort((a, b) => (withValue(a) - withValue(b)) * (sortDir === 'asc' ? 1 : -1));
    return copy;
  }, [passes, sortKey, sortDir]);

  if (loading) {
    return (
      <div className="glass-panel rounded-xl p-6">
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-space-800" />
          ))}
        </div>
        <p className="text-center text-space-300 text-sm mt-4">Computing visible passes…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-panel rounded-xl p-6 text-center">
        <p className="text-amber-glow font-medium">Couldn't load pass predictions</p>
        <p className="text-space-300 text-sm mt-1">{error}</p>
      </div>
    );
  }

  if (passes.length === 0) {
    return (
      <div className="glass-panel rounded-xl p-8 text-center">
        <p className="text-space-200 font-medium">No visible passes found</p>
        <p className="text-space-300 text-sm mt-1">
          No passes above the minimum elevation were found for this location in the selected window.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse min-w-[820px]">
          <thead>
            <tr className="border-b border-space-700/70">
              <th className="text-left px-4 py-3"><SortHeader label="Date" sortKey="start" active={sortKey === 'start'} dir={sortDir} onSort={handleSort} /></th>
              <th className="text-left px-3 py-3">Satellite</th>
              <th className="text-left px-3 py-3"><SortHeader label="Mag" sortKey="magnitude" active={sortKey === 'magnitude'} dir={sortDir} onSort={handleSort} /></th>
              <th className="text-left px-3 py-3">Start</th>
              <th className="text-left px-3 py-3"><SortHeader label="Max alt" sortKey="maxAltitude" active={sortKey === 'maxAltitude'} dir={sortDir} onSort={handleSort} /></th>
              <th className="text-left px-3 py-3">End</th>
              <th className="text-left px-3 py-3"><SortHeader label="Duration" sortKey="duration" active={sortKey === 'duration'} dir={sortDir} onSort={handleSort} /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr
                key={`${p.satnum}-${p.start.time}`}
                onClick={() => setSelected(p)}
                className={`cursor-pointer border-b border-space-800/80 hover:bg-space-800/50 transition ${i % 2 === 1 ? 'bg-space-900/30' : ''} ${selected === p ? 'bg-glow-600/10 hover:bg-glow-600/10' : ''}`}
              >
                <td className="px-4 py-3 whitespace-nowrap text-space-200">{dateFmt.format(new Date(p.start.time))}</td>
                <td className="px-3 py-3 whitespace-nowrap font-medium text-space-100">{p.name.replace(/\s*\(.*?\)\s*/g, '')}</td>
                <td className={`px-3 py-3 font-mono whitespace-nowrap ${magClass(p.magnitude)}`}>{p.magnitude?.toFixed(1) ?? '—'}</td>
                <td className="px-3 py-3 whitespace-nowrap text-space-200 font-mono text-xs">
                  {formatTime(p.start.time)} <span className="text-space-300">{p.start.direction}</span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-space-200 font-mono text-xs">
                  {formatTime(p.max.time)} <span className="text-glow-400">{Math.round(p.max.altitudeDeg)}°</span> <span className="text-space-300">{p.max.direction}</span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-space-200 font-mono text-xs">
                  {formatTime(p.end.time)} <span className="text-space-300">{p.end.direction}</span>
                  {p.endReason === 'shadow' && <span className="ml-1 text-[10px] text-space-500" title="Satellite enters Earth's shadow">🌑</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-space-300 font-mono text-xs">{Math.round(p.durationSeconds / 60)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="border-t border-space-700/70 p-4 bg-space-900/40">
          <div className="flex items-center justify-between">
            <p className="text-sm text-space-200">
              Selected: <span className="text-glow-400 font-medium">{selected.name}</span> pass on {dateFmt.format(new Date(selected.start.time))}
            </p>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-space-300 hover:text-space-100">
              Close
            </button>
          </div>
          <p className="text-xs text-space-300 mt-2">Detailed sky-track chart coming in the next milestone — this will show a 2D polar plot of the pass.</p>
        </div>
      )}
    </div>
  );
}
