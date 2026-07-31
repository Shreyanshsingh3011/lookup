import { useState } from 'react';
import { fetchStarlinkTrains } from '../api/client';
import {
  TIGHTNESS_NOTES,
  VISIBILITY_NOTES,
  describeTrainDuration,
  passVisibility,
  rankTrains,
  trainTightness,
  type StarlinkTrain,
  type StarlinkTrainsResponse,
} from '../lib/starlinkTrains';
import type { Observer, Pass } from '../types';

/** A busy launch cadence leaves more batches in transit than anyone will read. */
const MAX_LISTED = 6;

function formatPassTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TrainRow({ train }: { train: StarlinkTrain }) {
  const tightness = trainTightness(train.spreadDeg);
  const next: Pass | undefined = train.nextPasses[0];
  const visibilityNote = next ? VISIBILITY_NOTES[passVisibility(next.magnitude)] : null;

  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-space-100">
          {train.count} satellites in formation
        </span>
        <span className="text-[11px] text-space-300 font-mono">
          {train.meanAltitudeKm} km · {train.inclinationDeg}° inclination
        </span>
        <span className="text-[11px] text-space-300 ml-auto">
          {describeTrainDuration(train.passDurationSeconds)}
        </span>
      </div>

      <p className="text-[11px] text-space-400">{TIGHTNESS_NOTES[tightness]}</p>

      {next ? (
        <>
          <div className="text-xs text-space-200">
            Next pass{' '}
            <span className="font-mono text-space-100">{formatPassTime(next.start.time)}</span>,
            rising in the {next.start.direction} to{' '}
            <span className="font-mono text-space-100">{next.max.altitudeDeg.toFixed(0)}°</span> in
            the {next.max.direction}
            {next.magnitude !== null && (
              <span className="text-space-300"> · brightest mag {next.magnitude.toFixed(1)}</span>
            )}
          </div>
          {visibilityNote && <p className="text-[11px] text-amber-glow/80">{visibilityNote}</p>}
        </>
      ) : (
        <div className="text-xs text-space-400">
          Overhead, but no visible pass in the next few days — its orbital plane is currently
          oriented so the satellites are in the Earth's shadow whenever your sky is dark.
        </div>
      )}
    </div>
  );
}

/**
 * Starlink trains overhead.
 *
 * Opt-in rather than automatic: the scan pulls the entire Starlink catalogue
 * server-side, which is a much heavier request than anything else on the page,
 * and most nights there is no train to find.
 */
export function StarlinkTrains({ observer }: { observer: Observer }) {
  const [result, setResult] = useState<StarlinkTrainsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = () => {
    setLoading(true);
    setError(null);
    fetchStarlinkTrains(observer)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to scan for trains'))
      .finally(() => setLoading(false));
  };

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-space-100">Starlink trains</h2>
          <p className="text-xs text-space-300">
            Freshly launched batches still flying in a line
          </p>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={loading}
          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-glow-400/50 text-glow-400 hover:bg-glow-400/10 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Scanning…' : result ? 'Rescan' : 'Scan for trains'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-glow/40 bg-amber-glow/5 px-4 py-3 text-xs text-amber-glow">
          {error}
        </div>
      )}

      {result && result.trains.length > 0 && (
        <>
          <div className="glass-panel rounded-xl divide-y divide-space-800/70">
            {rankTrains(result.trains)
              .slice(0, MAX_LISTED)
              .map((train) => (
                <TrainRow key={train.satnums[0]} train={train} />
              ))}
          </div>
          {result.trains.length > MAX_LISTED && (
            <p className="text-[11px] text-space-400">
              {result.trains.length - MAX_LISTED} more batches are still in formation but have no
              better pass than these from your location.
            </p>
          )}
        </>
      )}

      {result && result.trains.length === 0 && (
        <div className="glass-panel rounded-xl px-4 py-3 text-xs text-space-300">
          No trains in formation right now. Scanned {result.catalogueSize.toLocaleString()} Starlink
          satellites — a batch has to be both recently launched and not yet raised to its
          operational altitude to still be flying as a string.
        </div>
      )}

      {result && (
        <p className="text-[11px] text-space-400 leading-relaxed">
          A batch spreads along its orbit continuously after deployment, so trains fade out over
          days to a couple of weeks rather than ending at a moment. Celestrak's elements also lag a
          new launch by a day or two — exactly when a train is tightest and brightest — so a launch
          from the last night or so will not appear here yet.
        </p>
      )}
    </section>
  );
}
