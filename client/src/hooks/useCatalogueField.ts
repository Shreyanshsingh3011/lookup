import { useEffect, useMemo, useState } from 'react';
import { fetchSpaceTrackDebris } from '../api/client';
import { preFilter } from '../lib/debris';
import type { Observer, TleRecord } from '../types';

/**
 * Every catalogued debris fragment still in orbit, for the dome's point field.
 *
 * Fragments, not the whole catalogue: the endpoint behind this queries
 * OBJECT_TYPE=DEBRIS, and Space-Track files spent stages as ROCKET BODY and dead
 * satellites as PAYLOAD, so neither is in here. Those are the dome's amber
 * derelicts, drawn as individual markers, and the two sets do not overlap. Worth
 * being exact about, because the alternative is a status line claiming to plot
 * everything while silently omitting the only category anyone can actually see.
 *
 * Fetched once when the debris layer is switched on and kept afterwards, so
 * toggling does not re-request. Requests the full set rather than a capped slice
 * — the point field can hold it, which is the entire reason that component
 * exists — and falls back silently to nothing if Space-Track is unavailable,
 * because the curated layer beneath it is already a complete, honest answer.
 *
 * Reach-filtered before it reaches the dome, and that is not optional here: at
 * twelve thousand objects, propagating things that can never rise at this
 * latitude is the largest avoidable cost in the whole pipeline, and the filter
 * settles it from two numbers per element set with no propagation at all.
 */

/** No cap in principle; this only guards against a pathological response. */
const HARD_CEILING = 40_000;

export interface CatalogueField {
  tles: TleRecord[];
  /** Returned by the server before filtering. */
  fetched: number;
  /** Rejected because they cannot rise at this latitude. */
  unreachable: number;
  loading: boolean;
  available: boolean;
  /** Why the field is empty, when it is empty for a reason worth stating. */
  error: string | null;
  /** True when the server has no Space-Track credentials configured. */
  unconfigured: boolean;
}

const EMPTY_TLES: TleRecord[] = [];

export function useCatalogueField(observer: Observer, enabled: boolean): CatalogueField {
  const [objects, setObjects] = useState<TleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setLoading(true);
    fetchSpaceTrackDebris(HARD_CEILING)
      .then((res) => {
        if (cancelled) return;
        setAvailable(res.source !== 'unavailable');
        // An empty field has to say why. Silently rendering nothing is the one
        // outcome this app is not allowed to produce: it looks identical to a
        // sky with no debris in it, which is the opposite of the truth.
        setUnconfigured(res.configured === false);
        setError(res.source === 'unavailable' ? (res.error ?? 'Space-Track is unavailable.') : null);
        setObjects(res.objects.map((o) => o.tle));
        setLoaded(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setAvailable(false);
        setError(err instanceof Error ? err.message : 'The catalogue request failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, loaded]);

  const filtered = useMemo(() => {
    if (!enabled || objects.length === 0) return { tles: EMPTY_TLES, unreachable: 0 };
    const result = preFilter(objects, observer);
    const unreachable = Object.values(result.rejected).reduce((a, b) => a + b, 0);
    return { tles: result.candidates, unreachable };
  }, [enabled, objects, observer]);

  return {
    tles: filtered.tles,
    fetched: objects.length,
    unreachable: filtered.unreachable,
    loading,
    available,
    error,
    unconfigured,
  };
}
