import { useState } from 'react';
import { fetchSatelliteByNorad, searchSatellites } from '../api/client';
import { parsePastedTle } from '../lib/customTle';
import type { TleRecord } from '../types';

interface Props {
  customTles: TleRecord[];
  onAdd: (tle: TleRecord) => string | null;
  onRemove: (satnum: string) => void;
}

type Mode = 'search' | 'norad' | 'paste';

/** Below this the query matches most of the catalogue; the server rejects it. */
const MIN_SEARCH_LENGTH = 3;

export function AddSatellite({ customTles, onAdd, onRemove }: Props) {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TleRecord[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [noradId, setNoradId] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < MIN_SEARCH_LENGTH) {
      setError(`Type at least ${MIN_SEARCH_LENGTH} characters — anything shorter matches most of the catalogue.`);
      return;
    }
    setBusy(true);
    setError(null);
    searchSatellites(q)
      .then((res) => {
        setResults(res.tles);
        setTruncated(res.truncated);
        if (res.tles.length === 0) setError(`Nothing in the catalogue is called "${q}".`);
      })
      .catch((err) => {
        setResults(null);
        setError(err instanceof Error ? err.message : 'Search failed');
      })
      .finally(() => setBusy(false));
  };

  const addFromSearch = (tle: TleRecord) => {
    const rejection = onAdd(tle);
    setError(rejection);
    if (!rejection) setResults((prev) => prev?.filter((t) => t.satnum !== tle.satnum) ?? null);
  };

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
          Search the whole catalogue by name, look one up by NORAD catalog number, or paste its TLE directly if
          you already have it (e.g. your own spacecraft's elements). Search reaches objects in groups this app
          does not track, so anything Celestrak knows about can be added.
        </p>
      </div>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setMode('search');
            setError(null);
          }}
          className={`text-[11px] px-2.5 py-1 rounded-lg border transition ${
            mode === 'search'
              ? 'bg-glow-600/20 text-glow-400 border-glow-600/40'
              : 'bg-space-900/60 text-space-300 border-space-700 hover:text-space-200 hover:border-space-600'
          }`}
        >
          Search by name
        </button>
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

      {mode === 'search' ? (
        <SearchPanel
          query={query}
          setQuery={setQuery}
          busy={busy}
          results={results}
          truncated={truncated}
          onSubmit={submitSearch}
          onAdd={addFromSearch}
        />
      ) : mode === 'norad' ? (
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

/**
 * Name search results.
 *
 * Kept as a plain list of buttons rather than a live-filtering combo box: each
 * query is a real upstream request, so it fires on submit rather than on every
 * keystroke.
 */
function SearchPanel({
  query,
  setQuery,
  busy,
  results,
  truncated,
  onSubmit,
  onAdd,
}: {
  query: string;
  setQuery: (q: string) => void;
  busy: boolean;
  results: TleRecord[] | null;
  truncated: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onAdd: (tle: TleRecord) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. hubble, sentinel, tiangong"
          className="flex-1 bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
        />
        <button
          type="submit"
          disabled={busy || query.trim().length < MIN_SEARCH_LENGTH}
          className="text-xs px-3 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results && results.length > 0 && (
        <>
          <ul className="max-h-56 overflow-y-auto divide-y divide-space-800/60 rounded-lg border border-space-800">
            {results.map((tle) => (
              <li key={tle.satnum} className="flex items-center gap-3 px-3 py-1.5">
                <span className="text-xs text-space-100 flex-1 truncate" title={tle.name}>
                  {tle.name}
                </span>
                <span className="text-[11px] font-mono text-space-400 shrink-0">#{tle.satnum}</span>
                <button
                  type="button"
                  onClick={() => onAdd(tle)}
                  className="text-[11px] px-2 py-0.5 rounded border border-space-600 text-space-200 hover:border-glow-500 hover:text-glow-400 transition shrink-0"
                >
                  Track
                </button>
              </li>
            ))}
          </ul>
          {truncated && (
            <p className="text-[11px] text-space-400">
              Showing the first {results.length}. Narrow the search if what you want is not here.
            </p>
          )}
        </>
      )}
    </div>
  );
}
