import { useEffect, useMemo, useState } from 'react';
import { fetchDebrisField, fetchSpaceTrackDebris } from '../api/client';
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
 * toggling does not re-request. Requests the full set rather than a capped
 * slice — the point field can hold it, which is the entire reason that
 * component exists.
 *
 * Two sources, in order. Space-Track has everything but needs an account, and
 * when the deployment has no credentials it returns nothing at all — which is
 * what every visitor to this app was getting: a layer promising the catalogue
 * and drawing an empty sky. CelesTrak publishes the four tracked breakup clouds
 * to anyone, so that is the fallback: a few thousand real, current fragments
 * rather than zero. Which source answered is reported, because the two support
 * very different claims and the dome must not make the larger one on the
 * smaller data.
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
  /**
   * Declared radar cross-section class per catalogue number, where known.
   *
   * Space-Track states LARGE / MEDIUM / SMALL per object. It is the only sourced
   * fact about a fragment's physical size, so the dome draws from it rather than
   * from an invented spread. CelesTrak's breakup groups carry no equivalent, so
   * this is empty on that path and the dome falls back to varying shape alone —
   * which is the honest outcome, not a degraded one.
   */
  rcsBySatnum: Map<string, string>;
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
  /** Which source answered, so the dome can say what it is plotting. */
  source: FieldSource;
  /** True when only some of the CelesTrak clouds could be fetched. */
  partial: boolean;
}

/**
 * Space-Track has everything; CelesTrak has the four tracked breakup clouds and
 * needs no account. Which one answered changes what the dome may claim.
 */
export type FieldSource = 'spacetrack' | 'celestrak' | 'none';

const EMPTY_TLES: TleRecord[] = [];

export function useCatalogueField(observer: Observer, enabled: boolean): CatalogueField {
  const [objects, setObjects] = useState<TleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  const [source, setSource] = useState<FieldSource>('none');
  const [partial, setPartial] = useState(false);
  const [rcs, setRcs] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (!enabled || loaded) return;
    let cancelled = false;
    setLoading(true);

    // Space-Track first, because it is the only source that has everything.
    // CelesTrak second, because it needs no account and having a few thousand
    // real fragments beats having none — which is what every visitor got while
    // the field depended on credentials the deployment did not have.
    (async () => {
      const primary = await fetchSpaceTrackDebris(HARD_CEILING).catch((err: unknown) => ({
        source: 'unavailable' as const,
        configured: true,
        error: err instanceof Error ? err.message : 'The catalogue request failed.',
        objects: [],
      }));
      if (cancelled) return;

      if (primary.source !== 'unavailable' && primary.objects.length > 0) {
        setAvailable(true);
        setUnconfigured(false);
        setError(null);
        setSource('spacetrack');
        setObjects(primary.objects.map((o) => o.tle));
        const sizes = new Map<string, string>();
        for (const o of primary.objects) {
          if (o.rcsSize) sizes.set(o.tle.satnum, o.rcsSize);
        }
        setRcs(sizes);
        setLoaded(true);
        return;
      }

      const unconfiguredNow = primary.configured === false;
      setUnconfigured(unconfiguredNow);

      const fallback = await fetchDebrisField().catch(() => null);
      if (cancelled) return;

      if (fallback && fallback.tles.length > 0) {
        setAvailable(true);
        setSource('celestrak');
        setObjects(fallback.tles);
        setPartial(fallback.source === 'partial');
        // Not an error — a smaller true answer. The reason the larger one is
        // missing still has to reach the reader, so it is kept separately.
        setError(null);
      } else {
        setAvailable(false);
        setSource('none');
        setError(
          ('error' in primary ? primary.error : null) ?? 'No debris catalogue could be loaded.'
        );
      }
      setLoaded(true);
    })().finally(() => {
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
    source,
    partial,
    rcsBySatnum: rcs,
  };
}
