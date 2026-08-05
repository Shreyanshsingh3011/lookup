import { useEffect, useState } from 'react';
import { fetchCatalogueSearch } from '../api/client';
import type { CatalogueSearchResponse, SpaceTrackObject } from '../types';

/**
 * Search the full non-active catalogue and send objects to the dome.
 *
 * The point of this panel is the last step: something found here is added to
 * the same live dome the Sky tab uses, drawn by the same marker and opening the
 * same detail panel as a curated derelict. It does not replace the default
 * debris layer — that stays exactly as it was — it adds to it.
 *
 * Deliberately one at a time. There is no "add all results", because the honest
 * ceiling is a handful: twelve thousand objects is over half a frame of SGP4
 * before anything is drawn, and every one of them is far too faint to see. A
 * button that promised otherwise would be a button that has to fail.
 */

const DEBOUNCE_MS = 350;

export function CatalogueSearch({
  onPin,
  isPinned,
  pinnedCount,
  maxPinned,
  onUnpin,
}: {
  onPin: (object: SpaceTrackObject) => { ok: boolean; message?: string };
  isPinned: (satnum: string) => boolean;
  pinnedCount: number;
  maxPinned: number;
  onUnpin: (satnum: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [size, setSize] = useState('');
  const [data, setData] = useState<CatalogueSearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Debounced, and never on an empty query with no filters — the catalogue is
  // twelve thousand objects and "everything" is not a useful result.
  useEffect(() => {
    if (query.trim().length < 2 && !type && !size) {
      setData(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setBusy(true);
      fetchCatalogueSearch({ q: query.trim() || undefined, type: type || undefined, size: size || undefined })
        .then((res) => !cancelled && setData(res))
        .catch(() => !cancelled && setData(null))
        .finally(() => !cancelled && setBusy(false));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, type, size]);

  const attempt = (object: SpaceTrackObject) => {
    const result = onPin(object);
    setNotice(result.ok ? `${object.name} added to the sky.` : result.message ?? null);
  };

  const unavailable = data && data.source === 'unavailable';

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-lg font-medium text-space-100">Search the whole catalogue</h2>
        <p className="text-xs text-space-300">
          Every non-active object with current orbital elements — pick any of them out and watch it in
          the live sky
        </p>
      </div>

      <div className="glass-panel rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or catalogue number — SL-16, COSMOS 2251 DEB, 16182…"
            className="flex-1 min-w-[14rem] bg-space-900 border border-space-600 rounded-md px-2.5 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Object type"
            className="bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-200 text-sm"
          >
            <option value="">Any type</option>
            {(data?.facets.types ?? ['DEBRIS', 'ROCKET BODY', 'PAYLOAD', 'UNKNOWN']).map((t) => (
              <option key={t} value={t}>
                {t.toLowerCase()}
              </option>
            ))}
          </select>
          <select
            value={size}
            onChange={(e) => setSize(e.target.value)}
            aria-label="Radar size class"
            className="bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-200 text-sm"
          >
            <option value="">Any size</option>
            {(data?.facets.sizes ?? ['LARGE', 'MEDIUM', 'SMALL']).map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </div>

        {pinnedCount > 0 && (
          <p className="text-[11px] text-space-400">
            <span style={{ color: '#f0a868' }}>
              {pinnedCount} of {maxPinned} catalogue objects in the dome
            </span>{' '}
            — they sit alongside the curated derelicts on the Sky tab, in amber. The default layer is
            unchanged.
          </p>
        )}
        {notice && <p className="text-[11px] text-glow-400">{notice}</p>}

        {unavailable && (
          <p className="text-[11px] text-amber-glow">
            {data?.configured === false
              ? 'The full catalogue needs Space-Track credentials, which are not configured. The curated clouds and derelicts above are unaffected.'
              : 'The full catalogue is unavailable right now. Everything above still works.'}
          </p>
        )}

        {busy && <p className="text-[11px] text-space-400">Searching…</p>}

        {data && !unavailable && (
          <>
            <p className="text-[11px] text-space-400">
              {data.count === 0
                ? 'Nothing matched.'
                : `${data.count}${data.count === data.limit ? '+' : ''} of ${data.searchable.toLocaleString()} searchable objects.`}
            </p>

            {data.results.length > 0 && (
              <div className="border border-space-700 rounded-lg divide-y divide-space-800/60 max-h-80 overflow-y-auto">
                {data.results.map((obj) => {
                  const pinned = isPinned(obj.satnum);
                  return (
                    <div key={obj.satnum} className="px-3 py-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-space-100 truncate">
                          {obj.name}
                          <span className="ml-2 text-[11px] font-mono text-space-500">#{obj.satnum}</span>
                        </div>
                        <div className="text-[11px] text-space-400">
                          {obj.objectType.toLowerCase()}
                          {obj.rcsSize && ` · ${obj.rcsSize.toLowerCase()}`}
                          {obj.perigeeKm !== null &&
                            obj.apogeeKm !== null &&
                            ` · ${Math.round(obj.perigeeKm)}–${Math.round(obj.apogeeKm)} km`}
                          {obj.inclinationDeg !== null && ` · ${obj.inclinationDeg.toFixed(1)}°`}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => (pinned ? onUnpin(obj.satnum) : attempt(obj))}
                        className={`text-[11px] px-2.5 py-1 rounded-lg border transition shrink-0 ${
                          pinned
                            ? 'border-space-600 text-space-300 hover:text-space-100'
                            : 'border-glow-600/40 text-glow-400 bg-glow-600/15 hover:bg-glow-600/25'
                        }`}
                      >
                        {pinned ? 'Remove' : 'Add to sky'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <p className="text-[11px] text-space-400 leading-relaxed">
          Objects are added one at a time on purpose. The whole catalogue is over twelve thousand
          objects still in orbit — more than half an animation frame of propagation before anything is
          drawn, and every fragment is around magnitude 12, so a sky full of them would show points
          nobody could see. Anything you add is checked against your latitude first; something whose
          ground track never reaches you is said so rather than drawn below the horizon forever.
        </p>
      </div>
    </section>
  );
}
