import { useState } from 'react';
import type { Observer } from '../types';

interface Props {
  observer: Observer;
  source: 'default' | 'stored' | 'geolocation' | 'manual';
  geoStatus: 'idle' | 'locating' | 'error';
  geoError: string | null;
  onUseGeolocation: () => void;
  onSetManual: (observer: Observer) => void;
}

export function LocationPicker({ observer, source, geoStatus, geoError, onUseGeolocation, onSetManual }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(observer);

  function openEditor() {
    setDraft(observer);
    setEditing(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (Number.isNaN(draft.latitude) || Number.isNaN(draft.longitude)) return;
    onSetManual(draft);
    setEditing(false);
  }

  return (
    <div className="glass-panel rounded-xl px-4 py-3 flex flex-col gap-2 min-w-[260px]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-space-300">Observer location</div>
          <div className="font-mono text-sm text-space-100">
            {observer.latitude.toFixed(4)}°, {observer.longitude.toFixed(4)}°
            <span className="text-space-300"> · {Math.round(observer.elevation)} m</span>
          </div>
          <div className="text-[11px] text-space-300">
            {source === 'geolocation' && 'from device geolocation'}
            {source === 'manual' && 'manually set'}
            {source === 'stored' && 'saved location'}
            {source === 'default' && 'default: Greenwich Observatory'}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onUseGeolocation}
            disabled={geoStatus === 'locating'}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-glow-600/15 text-glow-400 border border-glow-600/30 hover:bg-glow-600/25 hover:shadow-[var(--shadow-glow-sm)] transition disabled:opacity-50"
          >
            {geoStatus === 'locating' ? 'Locating…' : 'Use my location'}
          </button>
          <button
            type="button"
            onClick={openEditor}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
          >
            Enter manually
          </button>
        </div>
      </div>
      {geoStatus === 'error' && geoError && <div className="text-xs text-amber-glow">{geoError}</div>}

      {editing && (
        <form onSubmit={submit} className="grid grid-cols-3 gap-2 pt-2 border-t border-space-700/60">
          <label className="flex flex-col gap-0.5 text-[11px] text-space-300">
            Latitude
            <input
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              value={draft.latitude}
              onChange={(e) => setDraft((d) => ({ ...d, latitude: Number(e.target.value) }))}
              className="bg-space-900 border border-space-600 rounded-md px-2 py-1 text-space-100 font-mono text-xs focus:outline-none focus:border-glow-500"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-space-300">
            Longitude
            <input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={draft.longitude}
              onChange={(e) => setDraft((d) => ({ ...d, longitude: Number(e.target.value) }))}
              className="bg-space-900 border border-space-600 rounded-md px-2 py-1 text-space-100 font-mono text-xs focus:outline-none focus:border-glow-500"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-[11px] text-space-300">
            Altitude (m)
            <input
              type="number"
              step="1"
              value={draft.elevation}
              onChange={(e) => setDraft((d) => ({ ...d, elevation: Number(e.target.value) }))}
              className="bg-space-900 border border-space-600 rounded-md px-2 py-1 text-space-100 font-mono text-xs focus:outline-none focus:border-glow-500"
            />
          </label>
          <div className="col-span-3 flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs px-2.5 py-1 rounded-md text-space-300 hover:text-space-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="text-xs px-3 py-1 rounded-md bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition"
            >
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
