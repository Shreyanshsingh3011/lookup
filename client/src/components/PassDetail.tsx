import { useMemo } from 'react';
import { decayLabel, estimateDecay } from '../lib/decay';
import { computePassTrack } from '../lib/passTrack';
import { CloudCover } from './CloudCover';
import { GroundTrackMap } from './GroundTrackMap';
import { PolarSkyChart } from './PolarSkyChart';
import type { Observer, Pass, TleRecord } from '../types';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface Props {
  pass: Pass;
  observer: Observer;
  tles: TleRecord[];
  onClose: () => void;
  onShowInSky: (pass: Pass) => void;
  /** Record this pass as something actually seen. */
  onLogSighting: (pass: Pass) => void;
}

function EventRow({ label, time, altitudeDeg, azimuthDeg, direction }: {
  label: string;
  time: string;
  altitudeDeg: number;
  azimuthDeg: number;
  direction: string;
}) {
  return (
    <tr className="border-b border-space-800/70 last:border-0">
      <th scope="row" className="text-left py-1.5 pr-3 font-medium text-space-200 whitespace-nowrap">
        {label}
      </th>
      <td className="py-1.5 pr-3 font-mono text-xs text-space-100 whitespace-nowrap">
        {timeFmt.format(new Date(time))}
      </td>
      <td className="py-1.5 pr-3 font-mono text-xs text-glow-400 whitespace-nowrap">
        {Math.round(altitudeDeg)}°
      </td>
      <td className="py-1.5 font-mono text-xs text-space-300 whitespace-nowrap">
        {Math.round(azimuthDeg)}° {direction}
      </td>
    </tr>
  );
}

export function PassDetail({ pass, observer, tles, onClose, onShowInSky, onLogSighting }: Props) {
  const tle = useMemo(() => tles.find((t) => t.satnum === pass.satnum), [tles, pass.satnum]);

  const track = useMemo(
    () => (tle ? computePassTrack(tle, observer, pass) : []),
    [tle, observer, pass]
  );

  const decay = useMemo(() => (tle ? estimateDecay(tle, new Date()) : null), [tle]);

  const displayName = pass.name.replace(/\s*\(.*?\)\s*/g, '').trim();

  return (
    <section className="glass-panel rounded-xl p-4 sm:p-5" aria-label="Pass detail">
      <header className="flex items-start justify-between gap-3 mb-4">
        <div className="print-invert-text">
          <h3 className="text-base font-semibold text-space-100">
            {displayName}
            <span className="text-space-300 font-normal"> · sky track</span>
          </h3>
          <p className="text-xs text-space-300 mt-0.5">
            {dateFmt.format(new Date(pass.start.time))} · observer {observer.latitude.toFixed(3)}°,{' '}
            {observer.longitude.toFixed(3)}°
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 print:hidden">
          <button
            type="button"
            onClick={() => onShowInSky(pass)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-glow-600/15 text-glow-400 border border-glow-600/30 hover:bg-glow-600/25 hover:shadow-[var(--shadow-glow-sm)] transition"
          >
            Show in 3D
          </button>
          <button
            type="button"
            onClick={() => onLogSighting(pass)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
          >
            I saw this
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pass detail"
            className="text-xs px-2 py-1.5 rounded-lg text-space-300 hover:text-space-100 transition"
          >
            ✕
          </button>
        </div>
      </header>

      {!tle ? (
        <p className="text-sm text-space-300">
          Orbital elements for this satellite aren't loaded, so the track can't be drawn.
        </p>
      ) : (
        <div className="flex flex-col lg:flex-row gap-5">
          <div className="shrink-0 mx-auto lg:mx-0">
            <PolarSkyChart pass={pass} track={track} />
          </div>

          <div className="flex-1 min-w-0 print-invert-text">
            {/* The event cells are nowrap, so the table has an intrinsic
                min-width that would otherwise push past the panel edge. */}
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[300px]">
              <caption className="sr-only">Pass events with time, altitude and azimuth</caption>
              <thead>
                <tr className="border-b border-space-700">
                  <th scope="col" className="text-left py-1.5 pr-3 text-[10px] uppercase tracking-wider text-space-300">
                    Event
                  </th>
                  <th scope="col" className="text-left py-1.5 pr-3 text-[10px] uppercase tracking-wider text-space-300">
                    Time
                  </th>
                  <th scope="col" className="text-left py-1.5 pr-3 text-[10px] uppercase tracking-wider text-space-300">
                    Alt
                  </th>
                  <th scope="col" className="text-left py-1.5 text-[10px] uppercase tracking-wider text-space-300">
                    Azimuth
                  </th>
                </tr>
              </thead>
              <tbody>
                <EventRow label="Becomes visible" {...pass.start} />
                <EventRow label="Highest point" {...pass.max} />
                <EventRow label="Ends" {...pass.end} />
              </tbody>
            </table>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-space-300">Brightest magnitude</dt>
                <dd className="font-mono text-space-100">{pass.magnitude?.toFixed(1) ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-space-300">Visible duration</dt>
                <dd className="font-mono text-space-100">
                  {Math.floor(pass.durationSeconds / 60)}m {pass.durationSeconds % 60}s
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-space-300">Travels</dt>
                <dd className="font-mono text-space-100">
                  {pass.start.direction} → {pass.end.direction}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-space-300">Forecast sky</dt>
                <dd className="mt-0.5">
                  <CloudCover percent={pass.cloudCoverPercent} showLabel />
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-space-300">Pass ends because</dt>
                <dd className="text-space-100">
                  {pass.endReason === 'shadow'
                    ? 'enters Earth’s shadow'
                    : pass.endReason === 'daylight'
                      ? 'sky too bright'
                      : pass.endReason === 'window'
                        ? 'still up when the search ended'
                        : 'sets below horizon'}
                </dd>
              </div>
              {decay && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wider text-space-300">Orbital decay</dt>
                  <dd className="font-mono text-space-100">{decayLabel(decay)}</dd>
                </div>
              )}
            </dl>

            <p className="text-[11px] text-space-300 mt-4">
              Times are shown in your device's local timezone. Look for a steady, unblinking point of
              light moving {pass.start.direction} to {pass.end.direction} — aircraft blink, satellites
              don't.
            </p>
          </div>
        </div>
      )}

      {tle && (
        <div className="mt-5 pt-5 border-t border-space-700/60">
          <GroundTrackMap pass={pass} tle={tle} observer={observer} />
        </div>
      )}
    </section>
  );
}
