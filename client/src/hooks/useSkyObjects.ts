import { useMemo } from 'react';
import { observerToGeodetic, parseSatrec, skySampleAt, trailPoints } from '../lib/sky';
import type { LiveSatellite, SkyObjectKind } from '../components/sky/SatelliteMarker';
import type { Observer, Pass, TleRecord } from '../types';

/**
 * Propagate every TLE to `displayTime` and keep the ones currently above the
 * observer's horizon, along with their recent sky track.
 */
export function useSkyObjects(
  tles: TleRecord[],
  observer: Observer,
  displayTime: Date,
  passes: Pass[],
  /** Tags everything from this call, so the dome can draw derelicts apart. */
  kind: SkyObjectKind = 'active'
): LiveSatellite[] {
  const satrecs = useMemo(
    () =>
      tles
        .map((tle) => ({ tle, rec: parseSatrec(tle) }))
        .filter((entry): entry is { tle: TleRecord; rec: NonNullable<typeof entry.rec> } => entry.rec !== null),
    [tles]
  );

  const observerGd = useMemo(
    () => observerToGeodetic(observer),
    [observer]
  );

  return useMemo(() => {
    const out: LiveSatellite[] = [];
    for (const { tle, rec } of satrecs) {
      const sample = skySampleAt(rec, observerGd, displayTime);
      if (!sample || sample.elevationDeg < 0) continue;

      const nextPass = passes.find(
        (p) => p.satnum === tle.satnum && new Date(p.start.time).getTime() >= displayTime.getTime()
      );

      out.push({
        satnum: tle.satnum,
        name: tle.name,
        sample,
        trail: trailPoints(rec, observerGd, displayTime),
        nextPassTime: nextPass?.start.time ?? null,
        kind,
      });
    }
    return out;
  }, [satrecs, observerGd, displayTime, passes, kind]);
}
