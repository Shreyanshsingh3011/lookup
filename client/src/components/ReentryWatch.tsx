import { useState } from 'react';
import { fetchDebrisField } from '../api/client';
import { decayLabel } from '../lib/decay';
import { SEARCH_LOWEST, WATCH_HORIZON_DAYS, describeReentry, reentryWatch, type ReentryWatch as Watch } from '../lib/reentry';

/**
 * What is coming down, soonest first.
 *
 * Ordered by estimate, and deliberately not called a prediction. estimateDecay
 * forward-searches SGP4 for where the current elements stop being physically
 * representable with drag held constant — and drag is exactly what does not hold
 * constant. Real reentry forecasts tighten as an object descends and are
 * reissued hourly at the end; nothing derived from one element set can do that.
 * So this is useful for "which of these is nearly done" and useless for "where
 * will it land".
 *
 * Scanned on request rather than on load, matching the rest of this screen: the
 * catalogue is a few thousand objects and the forward search is the expensive
 * part of the app.
 */
export function ReentryWatch({ onShowInSky }: { onShowInSky: () => void }) {
  const [watch, setWatch] = useState<Watch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<Date | null>(null);

  const scan = async () => {
    setLoading(true);
    setError(null);
    try {
      const field = await fetchDebrisField();
      if (field.tles.length === 0) {
        setError(
          field.source === 'unavailable'
            ? 'No catalogue could be loaded, so there is nothing to scan.'
            : 'The catalogue came back empty.'
        );
        setWatch(null);
        return;
      }
      const now = new Date();
      setWatch(reentryWatch(field.tles, now));
      setScannedAt(now);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The scan failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-xl border border-space-700 bg-space-800/40 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-space-100">Coming down</h2>
          <p className="text-xs text-space-300">
            Tracked fragments whose orbits are close to the end, soonest first.
          </p>
        </div>
        <button
          type="button"
          onClick={scan}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-lg bg-glow-600/20 text-glow-400 border border-glow-600/40 hover:bg-glow-600/30 transition disabled:opacity-50 shrink-0"
        >
          {loading ? 'Scanning…' : watch ? 'Scan again' : 'Scan for reentries'}
        </button>
      </div>

      {error && <p className="text-xs text-amber-glow">{error}</p>}

      {watch && (
        <>
          <p className="text-[11px] text-space-400 leading-snug">
            {watch.scanned.toLocaleString()} objects considered. Perigee comes free from the element
            set, so only the {Math.min(SEARCH_LOWEST, watch.searched).toLocaleString()} lowest were
            forward-searched — an orbit cannot end soon while its perigee is high, and the search
            costs a hundred propagations an object.
            {watch.unusable > 0 &&
              ` ${watch.unusable} element set${watch.unusable === 1 ? '' : 's'} could not be read.`}
          </p>

          {watch.candidates.length === 0 ? (
            <p className="text-xs text-space-300">
              Nothing in the scanned set is estimated to reenter within{' '}
              {WATCH_HORIZON_DAYS} days. That is a real answer, not an empty one — most catalogued
              fragments are in orbits that will outlast the decade.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {watch.candidates.slice(0, 25).map(({ tle, estimate, daysRemaining }) => (
                <li
                  key={tle.satnum}
                  className="flex items-baseline justify-between gap-3 text-xs border-b border-space-700/60 pb-1.5 last:border-0"
                >
                  <span className="min-w-0">
                    <span className="text-space-100">{tle.name}</span>{' '}
                    <span className="font-mono text-[10px] text-space-400">#{tle.satnum}</span>
                  </span>
                  <span className="font-mono text-[10px] text-space-300 shrink-0 text-right">
                    {describeReentry(daysRemaining)}
                    <span className="text-space-500">
                      {' '}
                      · {Math.round(estimate.perigeeAltitudeKm)}×
                      {Math.round(estimate.apogeeAltitudeKm)} km · {decayLabel(estimate)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {watch.candidates.length > 25 && (
            <p className="text-[11px] text-space-400">
              Showing the 25 soonest of {watch.candidates.length}.
            </p>
          )}

          {/* The caveat is the point, not the small print. An ordered list of
              dates invites being read as a schedule. */}
          <p className="text-[11px] text-space-400 leading-snug">
            These are estimates from a single element set each, holding drag constant. Atmospheric
            density follows the eleven-year solar cycle and swings day to day with geomagnetic
            activity, so a date months out can move by weeks and none of this says where anything
            comes down. An operational reentry prediction is reissued as the object descends — use
            Space-Track's or CelesTrak's for that. Anything reboosted, as the ISS is, cannot be
            forecast from a snapshot at all.
            {scannedAt && ` Scanned ${scannedAt.toLocaleString()}.`}
          </p>

          <button
            type="button"
            onClick={onShowInSky}
            className="self-start text-[11px] px-2 py-1 rounded border border-space-600 text-space-300 hover:border-glow-500 hover:text-glow-400 transition"
          >
            See the field in the sky
          </button>
        </>
      )}
    </section>
  );
}
