import type { EpochSpan, TleSource } from '../types';

/**
 * Beyond this age, SGP4 propagation has drifted enough that pass times are no
 * longer trustworthy to the minute.
 */
const STALE_AFTER_DAYS = 7;

function formatAge(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? '' : 's'} old`;
  }
  const rounded = Math.round(days);
  return `${rounded} day${rounded === 1 ? '' : 's'} old`;
}

/**
 * Surfaces where the orbital elements came from and how old they are.
 *
 * Both matter, and independently: a successful live fetch of week-old elements
 * is no more trustworthy than a cached copy of the same. Predictions derived
 * from stale data are worse than no predictions, so nothing here stays quiet.
 */
export function SourceBanner({
  source,
  epoch,
}: {
  source: TleSource | null;
  epoch?: EpochSpan | null;
}) {
  const ageDays = epoch?.newestAgeDays ?? null;
  const stale = ageDays !== null && ageDays > STALE_AFTER_DAYS;

  // Nothing worth saying: fresh elements from the live source.
  if ((!source || source === 'live') && !stale) return null;

  const severe = source === 'fixture' || stale;

  const provenance = (() => {
    switch (source) {
      case 'fixture':
        return (
          <>
            <span className="font-semibold">Development fixture data.</span> Celestrak is
            unreachable and no elements have been supplied, so bundled fallback elements are in
            use.
          </>
        );
      case 'file':
        return (
          <>
            <span className="font-semibold">Operator-supplied elements.</span> Loaded from{' '}
            <code className="font-mono text-[0.9em]">TLE_FILE</code> rather than fetched from
            Celestrak.
          </>
        );
      case 'cache':
        return (
          <>
            <span className="font-semibold">Cached elements.</span> Celestrak is currently
            unreachable.
          </>
        );
      default:
        return <span className="font-semibold">Live elements from Celestrak.</span>;
    }
  })();

  return (
    <div
      role="status"
      className={`rounded-xl px-4 py-2.5 text-sm border ${
        severe
          ? 'bg-amber-glow/10 border-amber-glow/30 text-amber-glow'
          : 'bg-space-700/40 border-space-600 text-space-200'
      }`}
    >
      {provenance}
      {ageDays !== null && (
        <>
          {' '}
          Elements are <span className="font-mono">{formatAge(ageDays)}</span>
          {stale ? (
            <>
              , so positions and pass times shown are <strong>not accurate</strong>.
            </>
          ) : (
            '.'
          )}
        </>
      )}
      {source === 'file' && !stale && ' Predictions are as current as that file.'}
    </div>
  );
}
