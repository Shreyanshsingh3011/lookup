import type { Connection } from '../hooks/useConnection';

/**
 * Two short notices about the app itself rather than about the sky: that the
 * network has gone, and that a newer build is ready.
 *
 * The offline notice is about setting expectations, not about hiding failures.
 * Most of Lookup keeps working with no signal — the star catalog is bundled
 * and satellite positions are propagated in the browser — but the live feeds
 * genuinely cannot, so it says which is which instead of leaving someone to
 * wonder whether the whole app is broken.
 */
export function ConnectionNotice({ online, updateReady, applyUpdate }: Connection) {
  if (online && !updateReady) return null;

  return (
    <div className="flex flex-col gap-2 print:hidden">
      {!online && (
        <div className="rounded-lg border border-amber-glow/40 bg-amber-glow/5 px-4 py-3">
          <p className="text-sm text-amber-glow font-semibold">Offline</p>
          <p className="text-xs text-space-300 mt-0.5">
            The sky dome, pass times and charts still work from stored data. Live aircraft and
            cloud cover need a connection, and orbital elements will not refresh — check the
            banner above for how old they are.
          </p>
        </div>
      )}

      {updateReady && (
        <div className="rounded-lg border border-glow-400/40 bg-glow-400/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-space-200">
            <span className="font-semibold text-glow-400">A new version is ready.</span> Reload to
            pick it up.
          </p>
          <button
            type="button"
            onClick={applyUpdate}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-glow-400/50 text-glow-400 hover:bg-glow-400/10 transition-colors"
          >
            Reload
          </button>
        </div>
      )}
    </div>
  );
}
