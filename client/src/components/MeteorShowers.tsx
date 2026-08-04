import { useMemo } from 'react';
import { localSiderealTime, raDecToAzEl } from '../lib/celestialMath';
import {
  activeShowers,
  describePeak,
  describeRate,
  expectedRateRange,
  moonInterference,
} from '../lib/meteorShowers';
import { usePlanetPositions } from '../hooks/usePlanetPositions';
import { azToCompass } from '../lib/sky';
import type { Observer } from '../types';

const MOON_NOTES: Record<ReturnType<typeof moonInterference>, string | null> = {
  none: null,
  slight: 'The Moon is up but faint enough to ignore.',
  moderate: 'Moonlight will wash out the fainter meteors.',
  severe: 'A bright Moon is up — expect far fewer than the figures above.',
};

/**
 * What is falling tonight.
 *
 * Rates are given as a range rather than a single number on purpose. ZHR is
 * defined for a radiant at the zenith under a sky where sixth-magnitude stars
 * are visible, which is not a sky most people have; quoting it directly is how
 * meteor showers end up over-promised. The range spans a suburban sky to a
 * genuinely dark one, and the radiant's real elevation is folded in.
 */
export function MeteorShowers({ observer, displayTime }: { observer: Observer; displayTime: Date }) {
  const planets = usePlanetPositions(
    displayTime,
    observer.latitude,
    observer.longitude,
    observer.elevation
  );

  const showers = useMemo(() => {
    const lstRad = localSiderealTime(displayTime, observer.longitude);
    return activeShowers(displayTime).map((activity) => {
      const radiant = raDecToAzEl(
        activity.shower.radiantRaDeg,
        activity.shower.radiantDecDeg,
        lstRad,
        observer.latitude
      );
      return { activity, radiant, rate: expectedRateRange(activity, radiant.elevationDeg) };
    });
  }, [displayTime, observer.latitude, observer.longitude]);

  if (showers.length === 0) return null;

  const moon = planets.find((p) => p.body === 'Moon');
  const interference = moonInterference(moon?.phase ?? null, moon?.elevationDeg ?? null);
  const moonNote = MOON_NOTES[interference];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-medium text-space-100">Meteor showers</h2>
        <p className="text-xs text-space-300 hidden sm:block">no equipment needed · just look up</p>
      </div>

      <div className="glass-panel rounded-xl divide-y divide-space-800/70">
        {showers.map(({ activity, radiant, rate }) => {
          const up = radiant.elevationDeg > 0;

          return (
            <div key={activity.shower.id} className="px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 items-baseline">
              <div className="min-w-[10rem]">
                <div className="text-sm font-semibold text-space-100">{activity.shower.name}</div>
                <div className="text-[11px] text-space-300">
                  {describePeak(activity.daysFromPeak)} · debris from {activity.shower.parent}
                </div>
              </div>

              <div className="text-xs text-space-200">
                {up ? (
                  <>
                    Radiant {radiant.elevationDeg.toFixed(0)}° up in the{' '}
                    {azToCompass(radiant.azimuthDeg)}
                  </>
                ) : (
                  <span className="text-space-400">Radiant below the horizon</span>
                )}
              </div>

              <div className="text-xs font-mono text-space-100 ml-auto">
                {up ? describeRate(rate) : <span className="text-space-400">nothing to see yet</span>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-space-400 leading-relaxed">
        Ranges span a light-polluted suburban sky to a genuinely dark one, at the radiant's
        current elevation. Rates are IMO nominal figures for a typical year — the real strength
        varies as Earth crosses denser and thinner parts of each debris stream, and outbursts
        happen.
        {moonNote && <> {moonNote}</>}
      </p>
    </section>
  );
}
