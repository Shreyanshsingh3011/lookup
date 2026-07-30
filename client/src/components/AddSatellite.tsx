import { useState } from 'react';
import { fetchSatelliteByNorad } from '../api/client';
import { parsePastedTle } from '../lib/customTle';
import type { TleRecord } from '../types';

interface Props {
  customTles: TleRecord[];
  onAdd: (tle: TleRecord) => string | null;
  onRemove: (satnum: string) => void;
}

type Mode = 'norad' | 'paste';

export function AddSatellite({ customTles, onAdd, onRemove }: Props) {
  const [mode, setMode] = useState<Mode>('norad');
  const [noradId, setNoradId] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitNorad = (e: React.FormEvent) => {
    e.preventDefault();
    const catnr = noradId.trim();
    if (!/^\d+$/.test(catnr)) {
      setError('NORAD catalog number must be numeric, e.g. 25544.');
      return;
    }
    setBusy(true);
    setError(null);
    fetchSatelliteByNorad(catnr)
      .then((res) => {
        const rejection = onAdd(res.tle);
        if (rejection) {
          setError(rejection);
          return;
        }
        setNoradId('');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to look up that satellite'))
      .finally(() => setBusy(false));
  };

  const submitPaste = (e: React.FormEvent) => {
    e.preventDefault();
    const result = parsePastedTle(pasted);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    const rejection = onAdd(result);
    if (rejection) {
      setError(rejection);
      return;
    }
    setError(null);
    setPasted('');
  };

  return (
    <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-space-100">Track a satellite</h3>
        <p className="text-xs text-space-300 mt-0.5">
          Not one of the bundled stations — look one up by NORAD catalog number, or paste its TLE directly if you
          already have it (e.g. your own spacecraft's elements).
        </p>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMode('norad');
            setError(null);
          }}
          className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
            mode === 'norad'
              ? 'bg-glow-600/20 text-glow-400 border-glow-600/40'
              : 'bg-space-900/60 text-space-300 border-space-700 hover:text-space-200 hover:border-space-600'
          }`}
        >
          By NORAD ID
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('paste');
            setError(null);
          }}
          className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
            mode === 'paste'
              ? 'bg-glow-600/20 text-glow-400 border-glow-600/40'
              : 'bg-space-900/60 text-space-300 border-space-700 hover:text-space-200 hover:border-space-600'
          }`}
        >
          Paste TLE
        </button>
      </div>

      {mode === 'norad' ? (
        <form onSubmit={submitNorad} className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={noradId}
            onChange={(e) => setNoradId(e.target.value)}
            placeholder="e.g. 25544"
            className="flex-1 bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 font-mono text-sm focus:outline-none focus:border-glow-500"
          />
          <button
            type="submit"
            disabled={busy || noradId.trim().length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {busy ? 'Looking up…' : 'Add'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitPaste} className="flex flex-col gap-2">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'ISS (ZARYA)\n1 25544U 98067A   24058.53472222 ...\n2 25544  51.6416 247.4627 ...'}
            rows={3}
            className="bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 font-mono text-xs resize-none focus:outline-none focus:border-glow-500"
          />
          <button
            type="submit"
            disabled={pasted.trim().length === 0}
            className="self-start text-xs px-3 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </form>
      )}

      {error && <div className="text-xs text-amber-glow">{error}</div>}

      {customTles.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-space-700/60 pt-2.5">
          {customTles.map((t) => (
            <li key={t.satnum} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-space-200">
                {t.name} <span className="text-space-400 font-mono">#{t.satnum}</span>
              </span>
              <button
                type="button"
                onClick={() => onRemove(t.satnum)}
                aria-label={`Stop tracking ${t.name}`}
                className="text-space-400 hover:text-space-200 shrink-0"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
