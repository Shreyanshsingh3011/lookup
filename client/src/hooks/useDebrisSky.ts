import { useEffect, useMemo, useState } from 'react';
import { fetchDebrisCatalogue } from '../api/client';
import { preFilter } from '../lib/debris';
import type { NotableDerelict, Observer, ResolvedDerelict, TleRecord } from '../types';

/**
 * Derelicts, ready to plot in the live dome.
 *
 * Fetched once and pre-filtered before anything is propagated. That order
 * matters more here than it does on the debris list: the dome re-propagates
 * everything it holds on every tick of the clock, so an object that can never
 * rise at this latitude would otherwise be integrated forward several times a
 * second, forever, to be found below the horizon each time.
 *
 * Only the named derelicts are returned. The breakup clouds deliberately are
 * not — see the note on `DEBRIS_IN_DOME` below.
 */

/**
 * Why the clouds are not drawn.
 *
 * Two separate reasons, either of which would be enough.
 *
 * The cheap one is cost: the four clouds are the better part of ten thousand
 * fragments, and the dome propagates what it is given on every frame. That is
 * precisely what the coarse pre-filter exists to prevent, and the pre-filter
 * cannot save it — those clouds are inclined 74 to 99 degrees and genuinely do
 * pass over most of the inhabited world, so almost nothing gets rejected.
 *
 * The real one is honesty. A ten-centimetre fragment is around magnitude 12
 * even directly overhead — a thousand times fainter than anything the naked
 * eye can reach. Drawing thousands of them as points in a view whose whole
 * premise is "this is what is above you right now" would be showing a sky that
 * does not exist. The debris screen says what is up there and how much of it;
 * the dome shows what you could actually pick out, which for this population
 * is the handful of large derelicts below.
 *
 * A labelled region marking where a cloud currently is would convey the fact
 * without the fiction, and is the natural next step. It is not this change.
 */
export const DEBRIS_IN_DOME = 'derelicts-only' as const;

export interface DebrisSky {
  /** Element sets to plot, already pre-filtered for this observer. */
  tles: TleRecord[];
  /** Keyed by catalogue number, for the detail panel. */
  entries: Map<string, NotableDerelict>;
  /** Just the prose, keyed the same way — what the dome's marker panel needs. */
  notes: Map<string, string>;
  /** Everything the catalogue resolved, including the ones that are gone. */
  resolved: ResolvedDerelict[];
  /** Rejected before propagating because they can never rise here. */
  unreachableCount: number;
  /** Listed but no longer in the catalogue, which is an ordinary outcome. */
  missingCount: number;
  loading: boolean;
  error: string | null;
}

const EMPTY_TLES: TleRecord[] = [];

export function useDebrisSky(observer: Observer, enabled: boolean): DebrisSky {
  const [resolved, setResolved] = useState<ResolvedDerelict[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Fetched only once the layer is switched on, and kept afterwards: toggling
  // the layer off and on again should not re-hit the catalogue.
  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setLoading(true);
    fetchDebrisCatalogue()
      .then((res) => {
        if (cancelled) return;
        setResolved(res.derelicts);
        setLoaded(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the debris catalogue');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded]);

  const usable = useMemo(
    () => resolved.filter((d) => d.status === 'resolved' && d.tle !== null),
    [resolved]
  );

  const filtered = useMemo(() => {
    if (!enabled || usable.length === 0) return { candidates: EMPTY_TLES, skipped: 0 };
    const result = preFilter(usable.map((d) => d.tle!), observer);
    const skipped = Object.values(result.rejected).reduce((a, b) => a + b, 0);
    return { candidates: result.candidates, skipped };
  }, [enabled, usable, observer]);

  const entries = useMemo(() => {
    const map = new Map<string, NotableDerelict>();
    for (const d of resolved) map.set(d.entry.satnum, d.entry);
    return map;
  }, [resolved]);

  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const [satnum, entry] of entries) map.set(satnum, entry.note);
    return map;
  }, [entries]);

  return {
    tles: filtered.candidates,
    entries,
    notes,
    resolved,
    unreachableCount: filtered.skipped,
    missingCount: resolved.filter((d) => d.status !== 'resolved').length,
    loading,
    error,
  };
}
