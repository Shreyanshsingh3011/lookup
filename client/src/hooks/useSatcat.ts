import { useEffect, useMemo, useState } from 'react';
import { fetchSatcat } from '../api/client';
import type { SatcatEntry } from '../types';

/**
 * Catalogue metadata for the groups currently being drawn.
 *
 * The dome decides whether an object is derelict from its name, which is
 * reliable in exactly one direction: "R/B" proves a spent stage, but nothing
 * in "ENVISAT" says the satellite died in 2012. Envisat, ERS-1, Seasat and
 * Hitomi are all dead and all draw as working spacecraft.
 *
 * SATCAT carries a declared operational status per catalogue number, so this
 * turns that guess into an answer. Purely additive: an unreachable SATCAT
 * yields an empty map, and every caller falls back to the name-based rule it
 * used before rather than losing the distinction.
 *
 * Fetched per group and merged. Groups are small — a few hundred rows — and
 * the result is cached hard upstream, since operational status changes on the
 * scale of years while orbital elements change hourly.
 */
export interface Satcat {
  /** Keyed by catalogue number in the form TLEs carry, including Alpha-5. */
  byId: Map<string, SatcatEntry>;
  /** True once at least one group answered, so callers can tell empty from absent. */
  loaded: boolean;
  /** Groups whose metadata could not be fetched, named so the UI can say so. */
  unavailable: string[];
}

const EMPTY: Satcat = { byId: new Map(), loaded: false, unavailable: [] };

export function useSatcat(groupIds: string[]): Satcat {
  const [state, setState] = useState<Satcat>(EMPTY);

  // Sorted and joined so a re-render with the same groups in a different order
  // does not refetch. The dome re-renders constantly; this must not.
  const key = useMemo(() => [...groupIds].sort().join(','), [groupIds]);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setState(EMPTY);
      return;
    }

    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetchSatcat(id);
          return { id, entries: res.source === 'unavailable' ? null : res.entries };
        } catch {
          return { id, entries: null };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const byId = new Map<string, SatcatEntry>();
      const unavailable: string[] = [];
      for (const { id, entries } of results) {
        if (entries === null) {
          unavailable.push(id);
          continue;
        }
        for (const entry of entries) byId.set(entry.satnum, entry);
      }
      setState({ byId, loaded: true, unavailable });
    });

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}

/**
 * Whether the catalogue says this object is derelict.
 *
 * Returns null when the catalogue has nothing to say, which is different from
 * saying "alive" — the caller then falls back to the name. Collapsing those
 * two into a boolean is exactly how a missing answer turns into a wrong one.
 *
 * Only an explicit "nonoperational" makes a payload derelict. Backup, spare
 * and extended-mission describe spacecraft that still work; "unknown" means
 * the catalogue does not say. And "operational" genuinely means alive even for
 * an object with no moving parts — LAGEOS 2 has no power and no instruments,
 * and ground stations range it by laser to this day.
 */
export function derelictByCatalogue(entry: SatcatEntry | undefined): boolean | null {
  if (!entry) return null;
  if (entry.objectType === 'ROCKET BODY' || entry.objectType === 'DEBRIS') return true;
  if (entry.opsStatus === 'nonoperational') return true;
  if (entry.opsStatus === 'unknown') return null;
  return false;
}
