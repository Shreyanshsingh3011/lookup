import { useMemo } from 'react';
import { isDerelictByName } from '../lib/debris';
import { derelictByCatalogue } from './useSatcat';
import { observerToGeodetic, parseSatrec, skySampleAt, trailPoints } from '../lib/sky';
import type { LiveSatellite, SkyObjectKind } from '../components/sky/SatelliteMarker';
import type { Observer, Pass, SatcatEntry, TleRecord } from '../types';

/**
 * Propagate every TLE to `displayTime` and keep the ones currently above the
 * observer's horizon, along with their recent sky track.
 */
export function useSkyObjects(
  tles: TleRecord[],
  observer: Observer,
  displayTime: Date,
  passes: Pass[],
  /**
   * What to assume for objects whose name does not settle the question.
   *
   * Kind is decided per object, not per call: a spent rocket body is derelict
   * whichever list it arrived in, and most of the brightest satellites group
   * is spent rocket bodies. This is only the fallback for the ones the name
   * cannot prove either way.
   */
  defaultKind: SkyObjectKind = 'active',
  /**
   * Catalogue metadata, when it could be fetched. Takes precedence over the
   * name, because it is an answer where the name is only ever an inference —
   * nothing in "ENVISAT" says the satellite died in 2012.
   */
  satcat?: Map<string, SatcatEntry>
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
        // Catalogue first, name second, caller's default last. Each step only
        // runs when the one before it had nothing to say.
        kind: (derelictByCatalogue(satcat?.get(tle.satnum)) ?? isDerelictByName(tle.name))
          ? 'derelict'
          : defaultKind,
        satcat: satcat?.get(tle.satnum) ?? null,
      });
    }
    return out;
  }, [satrecs, observerGd, displayTime, passes, defaultKind, satcat]);
}
