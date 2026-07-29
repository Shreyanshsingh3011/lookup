import type { TleSource } from '../types';

/**
 * Surfaces degraded orbital-element provenance. Silently showing predictions
 * derived from stale or fixture TLEs would be worse than showing nothing.
 */
export function SourceBanner({ source }: { source: TleSource | null }) {
  if (!source || source === 'live') return null;

  const isFixture = source === 'fixture';

  return (
    <div
      role="status"
      className={`rounded-xl px-4 py-2.5 text-sm border ${
        isFixture
          ? 'bg-amber-glow/10 border-amber-glow/30 text-amber-glow'
          : 'bg-space-700/40 border-space-600 text-space-200'
      }`}
    >
      {isFixture ? (
        <>
          <span className="font-semibold">Development fixture data.</span> Celestrak is unreachable, so bundled
          2024-epoch elements are being used. Positions and pass times shown are <strong>not accurate</strong>.
        </>
      ) : (
        <>
          <span className="font-semibold">Using cached orbital elements.</span> Celestrak is currently unreachable;
          predictions may drift until fresh elements are fetched.
        </>
      )}
    </div>
  );
}
