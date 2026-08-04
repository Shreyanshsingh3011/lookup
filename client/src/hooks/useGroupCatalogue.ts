import { useEffect, useState } from 'react';
import { fetchGroupCatalogue } from '../api/client';
import { FALLBACK_GROUPS, type SatelliteGroup } from '../lib/satelliteGroups';

/**
 * The catalogue of trackable groups, from the server.
 *
 * Served rather than bundled so adding a group is a one-file change and the
 * two sides cannot disagree about what a group id means — an id that appears
 * in a shared link has to keep meaning the same thing on both.
 *
 * Falls back to the two groups that are always worth having rather than
 * rendering an empty picker: a failed catalogue fetch should cost you the long
 * tail, not the ability to choose at all.
 */
export function useGroupCatalogue(): {
  groups: SatelliteGroup[];
  maxScanned: number | null;
  loaded: boolean;
} {
  const [groups, setGroups] = useState<SatelliteGroup[]>(FALLBACK_GROUPS);
  const [maxScanned, setMaxScanned] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGroupCatalogue()
      .then((res) => {
        if (cancelled || !Array.isArray(res.groups) || res.groups.length === 0) return;
        setGroups(res.groups);
        setMaxScanned(res.maxScannedSatellites ?? null);
      })
      .catch(() => {
        // Keep the fallback. The banner already tells the user when the server
        // is unreachable; a second complaint here would add nothing.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { groups, maxScanned, loaded };
}
