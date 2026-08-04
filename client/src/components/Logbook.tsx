import { useEffect, useMemo, useState } from 'react';
import { downloadTextFile } from '../lib/exportData';
import {
  addEntry,
  createEntry,
  entriesToCsv,
  loadEntries,
  removeEntry,
  saveEntries,
  summarise,
  type LogEntry,
  type SeeingQuality,
} from '../lib/logbook';
import type { Observer } from '../types';

/**
 * What you actually saw.
 *
 * Everything else on this page is a prediction. This is the only part that
 * records something that happened, and so the only part whose value grows by
 * being used.
 *
 * Local to this browser, and exportable, because there are no accounts to sync
 * to and inventing somewhere to keep people's observing history would be a
 * much larger promise than the app can currently keep. Saying so is better
 * than implying a cloud that is not there.
 */

const SEEING_OPTIONS: Array<{ value: SeeingQuality; label: string }> = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
];

/** A datetime-local value for an instant, in the browser's own zone. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatObserved(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Logbook({
  observer,
  prefill,
  onPrefillUsed,
}: {
  observer: Observer;
  /** A sighting handed over from elsewhere, e.g. a pass the user just watched. */
  prefill: { subject: string; satnum: string | null; magnitude: number | null; maxElevationDeg: number | null; observedAt: Date } | null;
  onPrefillUsed: () => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const [subject, setSubject] = useState('');
  const [satnum, setSatnum] = useState<string | null>(null);
  const [observedAt, setObservedAt] = useState(() => toLocalInput(new Date()));
  const [seeing, setSeeing] = useState<SeeingQuality | ''>('');
  const [magnitude, setMagnitude] = useState('');
  const [elevation, setElevation] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    setEntries(loadEntries());
  }, []);

  // A pass handed over from the table arrives with everything already known,
  // so recording it is a matter of confirming rather than transcribing.
  useEffect(() => {
    if (!prefill) return;
    setSubject(prefill.subject);
    setSatnum(prefill.satnum);
    setObservedAt(toLocalInput(prefill.observedAt));
    setMagnitude(prefill.magnitude === null ? '' : String(prefill.magnitude));
    setElevation(prefill.maxElevationDeg === null ? '' : String(prefill.maxElevationDeg));
    setOpen(true);
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  const summary = useMemo(() => summarise(entries), [entries]);

  const persist = (next: LogEntry[]) => {
    setEntries(next);
    setSaveFailed(!saveEntries(next));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const entry = createEntry({
      observedAt: new Date(observedAt),
      subject,
      satnum,
      observer,
      magnitude: magnitude === '' ? null : Number(magnitude),
      maxElevationDeg: elevation === '' ? null : Number(elevation),
      seeing: seeing === '' ? null : seeing,
      note,
    });
    if (!entry) return;

    persist(addEntry(entries, entry));
    setSubject('');
    setSatnum(null);
    setNote('');
    setMagnitude('');
    setElevation('');
    setSeeing('');
    setObservedAt(toLocalInput(new Date()));
    setOpen(false);
  };

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-space-100">Logbook</h2>
          <p className="text-xs text-space-300">
            {summary.total === 0
              ? 'Nothing recorded yet'
              : `${summary.total} sighting${summary.total === 1 ? '' : 's'} across ${summary.nights} night${
                  summary.nights === 1 ? '' : 's'
                } · ${summary.distinctSubjects} different object${summary.distinctSubjects === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entries.length > 0 && (
            <button
              type="button"
              onClick={() => downloadTextFile('lookup-logbook.csv', entriesToCsv(entries), 'text/csv')}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
            >
              Export CSV
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition"
          >
            {open ? 'Cancel' : 'Record a sighting'}
          </button>
        </div>
      </div>

      {saveFailed && (
        <p className="text-xs text-amber-glow">
          This browser refused to save — private browsing, or storage is full. The entries below are in
          memory only and will be lost when you close the tab. Export them if they matter.
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="glass-panel rounded-xl p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="What did you see?">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="ISS, a Starlink train, an unidentified flash…"
                required
                className="w-full bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
              />
            </Field>
            <Field label="When">
              <input
                type="datetime-local"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
                required
                className="w-full bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Peak elevation">
              <input
                type="number"
                // step defaults to 1, which silently rejects the app's own
                // figures: pass elevations are reported to one decimal, so a
                // prefilled 30.7 failed validation and the form refused to
                // submit with nothing on screen to say why.
                step="any"
                min={0}
                max={90}
                value={elevation}
                onChange={(e) => setElevation(e.target.value)}
                placeholder="°"
                className="w-full bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
              />
            </Field>
            <Field label="Magnitude">
              <input
                type="number"
                step="any"
                value={magnitude}
                onChange={(e) => setMagnitude(e.target.value)}
                placeholder="−3.1"
                className="w-full bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
              />
            </Field>
            <Field label="Seeing">
              <select
                value={seeing}
                onChange={(e) => setSeeing(e.target.value as SeeingQuality | '')}
                className="w-full bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm focus:outline-none focus:border-glow-500"
              >
                <option value="">—</option>
                {SEEING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What it looked like, where it faded, who was with you."
              className="w-full bg-space-900 border border-space-600 rounded-md px-2 py-1.5 text-space-100 text-sm resize-none focus:outline-none focus:border-glow-500"
            />
          </Field>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={subject.trim().length === 0}
              className="text-xs px-3 py-1.5 rounded-lg bg-glow-600 text-space-950 font-medium hover:bg-glow-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save to logbook
            </button>
            <span className="text-[11px] text-space-400">
              Recorded at {observer.latitude.toFixed(3)}°, {observer.longitude.toFixed(3)}°
            </span>
          </div>
        </form>
      )}

      {entries.length > 0 && (
        <div className="glass-panel rounded-xl divide-y divide-space-800/60">
          {entries.slice(0, 20).map((entry) => (
            <div key={entry.id} className="px-4 py-2.5 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-space-100">
                  {entry.subject}
                  {entry.satnum && <span className="text-[11px] text-space-400 font-mono"> #{entry.satnum}</span>}
                </div>
                <div className="text-[11px] text-space-400">
                  {formatObserved(entry.observedAt)}
                  {entry.maxElevationDeg !== null && ` · ${entry.maxElevationDeg}° up`}
                  {entry.magnitude !== null && ` · magnitude ${entry.magnitude}`}
                  {entry.seeing && ` · ${entry.seeing} seeing`}
                </div>
                {entry.note && <p className="text-xs text-space-300 mt-1 whitespace-pre-wrap">{entry.note}</p>}
              </div>
              <button
                type="button"
                onClick={() => persist(removeEntry(entries, entry.id))}
                aria-label={`Delete the entry for ${entry.subject}`}
                className="text-[11px] text-space-500 hover:text-amber-glow transition shrink-0"
              >
                Delete
              </button>
            </div>
          ))}
          {entries.length > 20 && (
            <p className="px-4 py-2 text-[11px] text-space-400">
              Showing the most recent 20 of {entries.length}. Export to see them all.
            </p>
          )}
        </div>
      )}

      {summary.mostSeen.length > 1 && (
        <p className="text-[11px] text-space-400">
          Most seen: {summary.mostSeen.map((m) => `${m.subject} (${m.count})`).join(', ')}.
        </p>
      )}

      <p className="text-[11px] text-space-400 leading-relaxed">
        Kept in this browser only. There are no accounts, so there is nowhere to sync to and nothing is
        sent anywhere — which also means clearing your browser data clears this. Export the CSV if it is
        worth keeping. An evening that runs past midnight counts as one night, not two.
      </p>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-space-400">{label}</span>
      {children}
    </label>
  );
}
