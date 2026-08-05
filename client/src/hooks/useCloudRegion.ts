import { useMemo } from 'react';
import { cloudSkyDensity, type CloudSkyDensity } from '../lib/debrisCloudSky';
import type { Observer, TleRecord } from '../types';

/**
 * A cloud's sky density, recomputed on a coarse clock.
 *
 * This propagates every fragment it is given — up to about two thousand for
 * Fengyun-1C — and the dome's display time advances continuously. Recomputing
 * on every tick would be a couple of thousand SGP4 evaluations per frame,
 * which is a different order of cost from the handful of markers around it.
 *
 * So the input time is quantised. A cloud is a diffuse thing spread across
 * whole quadrants of sky; a minute of orbital motion moves the picture by less
 * than a bin is wide, so recomputing more often would cost real work to
 * produce an identical image.
 */
const RECOMPUTE_INTERVAL_MS = 60_000;

const EMPTY: CloudSkyDensity = {
  bins: [],
  aboveHorizon: 0,
  total: 0,
  unreadable: 0,
  peakBinCount: 0,
};

export function useCloudRegion(
  fragments: TleRecord[] | null,
  observer: Observer,
  displayTime: Date,
  enabled: boolean
): CloudSkyDensity {
  const bucketedTime = useMemo(
    () => new Date(Math.floor(displayTime.getTime() / RECOMPUTE_INTERVAL_MS) * RECOMPUTE_INTERVAL_MS),
    [displayTime]
  );

  return useMemo(() => {
    if (!enabled || !fragments || fragments.length === 0) return EMPTY;
    return cloudSkyDensity(fragments, observer, bucketedTime);
  }, [enabled, fragments, observer, bucketedTime]);
}
