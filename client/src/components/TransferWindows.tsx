import { useMemo } from 'react';
import { allTransferWindows } from '../lib/transferWindows';

/**
 * When you could leave for another planet.
 *
 * The recurring twenty-six-month Mars window is one of those facts that gets
 * quoted far more often than it gets explained. It falls straight out of the
 * geometry: the transfer takes 259 days, so Mars has to be about 44 degrees
 * ahead of Earth when you go, and Earth laps Mars only every 780 days. Showing
 * the required angle next to the current one makes the wait legible.
 */

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function describeWait(from: Date, departure: Date): string {
  const days = Math.round((departure.getTime() - from.getTime()) / 86_400_000);
  if (days < 45) return `${days} days away`;
  const months = days / 30.44;
  return months < 24 ? `${months.toFixed(0)} months away` : `${(days / 365.25).toFixed(1)} years away`;
}

function formatFlight(days: number): string {
  return days < 400 ? `${days.toFixed(0)} days` : `${(days / 365.25).toFixed(1)} years`;
}

/**
 * A lead angle read the short way round.
 *
 * The phase angle is defined as how far the target leads Earth, so a target
 * that trails by 54 degrees comes out as 306. That is correct and unreadable:
 * "Venus needs to be 306° ahead" describes the same geometry as "54° behind"
 * while sounding like most of a lap.
 */
function describeLead(deg: number): string {
  const wrapped = ((deg % 360) + 360) % 360;
  if (wrapped < 1 || wrapped > 359) return 'alongside';
  return wrapped <= 180 ? `${wrapped.toFixed(0)}° ahead` : `${(360 - wrapped).toFixed(0)}° behind`;
}

export function TransferWindows({ displayTime }: { displayTime: Date }) {
  // The ephemeris search costs about 60 ms and the windows are months apart, so
  // it is pinned to the top of the hour rather than re-run on every scrubber
  // tick. Crucially the *same* instant is then used to measure how far off each
  // window is: searching from midnight while counting down from now reported a
  // departure earlier today as "-1 days away", which happened on every day a
  // window actually opened.
  const hour = Math.floor(displayTime.getTime() / 3600_000);
  const searchFrom = useMemo(() => new Date(hour * 3600_000), [hour]);
  const windows = useMemo(() => allTransferWindows(searchFrom), [searchFrom]);

  if (windows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-medium text-space-100">Next window to another planet</h2>
        <p className="text-xs text-space-300 hidden sm:block">
          minimum-energy transfers · from live planet positions
        </p>
      </div>

      <div className="glass-panel rounded-xl overflow-x-auto">
        <table className="w-full text-sm min-w-[40rem]">
          <thead className="text-[11px] uppercase tracking-wide text-space-400">
            <tr className="border-b border-space-800/70">
              <th className="text-left font-medium px-4 py-2">Destination</th>
              <th className="text-left font-medium px-4 py-2">Depart</th>
              <th className="text-left font-medium px-4 py-2">Arrive</th>
              <th className="text-right font-medium px-4 py-2">Crossing</th>
              <th className="text-right font-medium px-4 py-2">Δv</th>
              <th className="text-right font-medium px-4 py-2">Recurs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-space-800/50">
            {windows.map((w) => {
              // A departure most of a synodic period out means the geometry has
              // only just gone past, which otherwise reads as a contradiction:
              // a target sitting almost exactly at the required angle, with the
              // next chance years away. Saying so is the whole lesson — this is
              // why a slipped Mars window costs twenty-six months.
              const waitDays = (w.departure.getTime() - searchFrom.getTime()) / 86_400_000;
              const justMissed = waitDays > 0.85 * w.synodicPeriodDays;
              return (
                <tr key={w.target.body}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-space-100">{w.target.label}</div>
                    <div className="text-[11px] text-space-400">
                      now {describeLead(w.currentPhaseAngleDeg)} · needs{' '}
                      {describeLead(w.requiredPhaseAngleDeg)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-space-100">{formatDate(w.departure)}</div>
                    <div className="text-[11px] text-space-400">{describeWait(searchFrom, w.departure)}</div>
                    {justMissed && (
                      <div className="text-[11px] text-amber-glow">just missed — waiting a full cycle</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-space-200">{formatDate(w.arrival)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-space-200">
                    {formatFlight(w.flightTimeDays)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-space-100">
                    {w.totalDeltaVKmS.toFixed(2)}
                    <span className="text-space-400 text-[11px]"> km/s</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-space-300">
                    {(w.synodicPeriodDays / 30.44).toFixed(0)} mo
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-space-400 leading-relaxed">
        A Hohmann transfer aims at where the target will be after a crossing that takes months, not at
        where it is now — so the target has to lead Earth by a particular angle at departure, and that
        geometry only comes round once per synodic period. Departure dates are found by searching the
        real planet positions for the moment that angle is met. Two honest simplifications: orbits are
        treated as circular and coplanar, which is what a Hohmann transfer assumes. Real planets are
        neither, so actual mission windows land within a few weeks of these and their Δv differs by a
        few hundred m/s. The Δv shown is departure plus arrival burn in deep space; it excludes getting
        off Earth in the first place and any aerobraking on the far end.
      </p>
    </section>
  );
}
