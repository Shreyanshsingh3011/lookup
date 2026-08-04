import { useMemo } from 'react';
import { assessTonight, clockIsForeign, clockOffsetHours, type Verdict } from '../lib/tonight';
import type { Observer, Pass } from '../types';

/**
 * The answer to the question the app exists for.
 *
 * Everything below this on the page is detail: which satellite, at what
 * magnitude, on what bearing. This is the bit somebody reads standing at a
 * window deciding whether to put a coat on.
 */

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
  excellent: { label: 'Worth going out', className: 'text-emerald-300 border-emerald-400/40 bg-emerald-400/10' },
  good: { label: 'Worth a look', className: 'text-glow-400 border-glow-400/40 bg-glow-400/10' },
  fair: { label: 'Marginal', className: 'text-amber-glow border-amber-glow/40 bg-amber-glow/10' },
  poor: { label: 'Not tonight', className: 'text-space-300 border-space-600 bg-space-800/60' },
};

function clockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function Tonight({
  observer,
  passes,
  displayTime,
}: {
  observer: Observer;
  passes: Pass[];
  displayTime: Date;
}) {
  // Recomputed hourly: twilight and moonrise move by minutes across a night,
  // and the ephemeris sampling behind the Moon's peak elevation is not worth
  // re-running on every tick of the clock.
  const hour = Math.floor(displayTime.getTime() / 3_600_000);
  const conditions = useMemo(
    () => assessTonight(observer, passes, new Date(hour * 3_600_000)),
    [observer, passes, hour]
  );

  const window = conditions.darkness ?? conditions.fallbackDarkness;
  const style = VERDICT_STYLE[conditions.verdict];
  // Times render on the reader's clock. Harmless while everyone looked at
  // their own sky; misleading now that a link can drop you into somebody
  // else's night, where "dark from 12:27 PM" is right and reads as nonsense.
  const foreignClock = clockIsForeign(observer.longitude);
  const offsetHours = Math.round(clockOffsetHours(observer.longitude));

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-medium text-space-100">Tonight</h2>
        <p className="text-xs text-space-300 hidden sm:block">darkness, Moon and cloud, together</p>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-space-800/70">
          <span className={`text-sm font-semibold px-3 py-1 rounded-lg border ${style.className}`}>
            {style.label}
          </span>
          <ul className="text-xs text-space-200 flex-1 min-w-[14rem] leading-relaxed">
            {conditions.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>

        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
          <Fact label="Dark from">
            {window ? (
              <>
                {clockTime(window.start)} – {clockTime(window.end)}
                <span className="block text-[11px] text-space-400 font-sans">
                  {window.hours.toFixed(1)} h of {window.kind} darkness
                </span>
              </>
            ) : (
              <span className="text-space-400">never, at this latitude now</span>
            )}
          </Fact>

          <Fact label="Moon">
            {Math.round(conditions.moon.illumination * 100)}%
            <span className="block text-[11px] text-space-400 font-sans">
              {conditions.moon.phaseName}
              {conditions.moon.peakElevationDeg !== null && conditions.moon.peakElevationDeg > 0
                ? `, up to ${Math.round(conditions.moon.peakElevationDeg)}° up`
                : ', below the horizon'}
            </span>
          </Fact>

          <Fact label="Cloud">
            {conditions.cloudCoverPercent === null ? (
              <span className="text-space-400">no forecast</span>
            ) : (
              <>
                {Math.round(conditions.cloudCoverPercent)}%
                <span className="block text-[11px] text-space-400 font-sans">
                  averaged over tonight's passes
                </span>
              </>
            )}
          </Fact>

          <Fact label="Passes tonight">
            {conditions.passes.length}
            <span className="block text-[11px] text-space-400 font-sans">
              {conditions.passes.length > 0
                ? `brightest magnitude ${conditions.passes[0].magnitude}`
                : 'in the dark window'}
            </span>
          </Fact>
        </div>

        {conditions.passes.length > 0 && (
          <ul className="px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1">
            {conditions.passes.map((p) => (
              <li key={`${p.satnum}-${p.start.time}`} className="text-[11px] text-space-300">
                <span className="text-space-100">{p.name}</span> at {clockTime(new Date(p.max.time))},{' '}
                {p.max.altitudeDeg}° up in the {p.max.direction}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-space-400 leading-relaxed">
        {foreignClock && (
          <>
            <span className="text-amber-glow">
              Times are on your clock, not the observer's — that location runs about{' '}
              {Math.abs(offsetHours)} hours {offsetHours > 0 ? 'ahead of' : 'behind'} you.
            </span>{' '}
          </>
        )}
        Twilight and moonrise are computed for the observer's exact position. The cloud figure is a forecast, and a
        forecast twelve hours out is a guess — it is the least reliable thing here and the most likely to
        decide your evening, which is why the verdict is coarse and its reasons are listed rather than
        rolled into a score.
      </p>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-space-400">{label}</dt>
      <dd className="text-sm font-mono text-space-100">{children}</dd>
    </div>
  );
}
