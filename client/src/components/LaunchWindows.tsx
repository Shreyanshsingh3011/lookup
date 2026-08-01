import { useMemo, useState } from 'react';
import type { SatRec } from 'satellite.js';
import { ascentBudget, planeAt, rendezvousWindows } from '../lib/launchPlanner';
import { minimumInclinationDeg, rotationalAssistKmS } from '../lib/orbitalMechanics';
import { azToCompass, parseSatrec } from '../lib/sky';
import type { Observer, TleRecord } from '../types';

/**
 * Launching from where you are standing.
 *
 * The point of putting the observer's own location in as the launch site is
 * that the two hardest constraints in launch planning are both properties of
 * the site: you cannot reach an orbit less inclined than your own latitude, and
 * you must lift off at the instant the ground carries you into the target's
 * plane. Both become obvious the moment they are your latitude and your
 * timezone rather than someone else's.
 */

const ALTITUDE_KM = 400;
/** Kerosene-class first stage; the Isp most launch vehicles actually fly. */
const ISP_SECONDS = 330;

function formatTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function countdown(from: Date, to: Date): string {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

export function LaunchWindows({
  observer,
  tles,
  displayTime,
}: {
  observer: Observer;
  tles: TleRecord[];
  displayTime: Date;
}) {
  // Only objects the app is already tracking can be rendezvous targets: a real
  // element set is what makes the window real rather than illustrative.
  const targets = useMemo(() => {
    const parsed: { tle: TleRecord; satrec: SatRec }[] = [];
    for (const tle of tles) {
      const satrec = parseSatrec(tle);
      if (satrec) parsed.push({ tle, satrec });
    }
    return parsed;
  }, [tles]);

  const [selected, setSelected] = useState<string | null>(null);
  const target = useMemo(() => {
    if (targets.length === 0) return null;
    if (selected) {
      const match = targets.find((t) => t.tle.satnum === selected);
      if (match) return match;
    }
    // The station is the target everyone means, when it is in the catalogue.
    return targets.find((t) => /\bISS\b|ZARYA/i.test(t.tle.name)) ?? targets[0];
  }, [targets, selected]);

  const plan = useMemo(() => {
    if (!target) return null;
    const plane = planeAt(target.satrec, displayTime);
    if (!plane) return null;

    const reachable = Math.abs(observer.latitude) <= plane.inclinationDeg;
    const windows = reachable
      ? rendezvousWindows(target.satrec, observer.latitude, observer.longitude, displayTime, 48).slice(0, 4)
      : [];
    const budget = windows[0]
      ? ascentBudget(observer.latitude, ALTITUDE_KM, windows[0].azimuthDeg, ISP_SECONDS)
      : null;

    return { plane, reachable, windows, budget };
  }, [target, observer.latitude, observer.longitude, displayTime]);

  if (!target || !plan) return null;

  const assist = rotationalAssistKmS(observer.latitude);
  const floor = minimumInclinationDeg(observer.latitude);

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-medium text-space-100">Launching from here</h2>
        <p className="text-xs text-space-300 hidden sm:block">
          your latitude as a launch site · real element sets
        </p>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-space-800/70 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
          <Fact label="Pad latitude" value={`${Math.abs(observer.latitude).toFixed(2)}° ${observer.latitude >= 0 ? 'N' : 'S'}`}>
            Every orbit passes over the pad, so nothing below this inclination is reachable directly.
          </Fact>
          <Fact label="Lowest orbit reachable" value={`${floor.toFixed(1)}° inclination`}>
            Anything shallower needs a plane change in orbit, which costs about as much as launching.
          </Fact>
          <Fact label="Free speed from rotation" value={`${(assist * 1000).toFixed(0)} m/s`}>
            The ground here is already moving east this fast. At the equator it would be 465 m/s.
          </Fact>
        </div>

        <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-space-800/70">
          <label className="text-xs text-space-300" htmlFor="launch-target">
            Rendezvous with
          </label>
          <select
            id="launch-target"
            value={target.tle.satnum}
            onChange={(e) => setSelected(e.target.value)}
            className="text-xs bg-space-800/80 border border-space-600 rounded-lg px-2 py-1.5 text-space-100 max-w-[16rem]"
          >
            {targets.map((t) => (
              <option key={t.tle.satnum} value={t.tle.satnum}>
                {t.tle.name}
              </option>
            ))}
          </select>
          <span className="text-xs font-mono text-space-300">
            {plan.plane.inclinationDeg.toFixed(2)}° inclination · node at {plan.plane.raanDeg.toFixed(1)}°
          </span>
        </div>

        {!plan.reachable ? (
          <p className="px-4 py-4 text-sm text-space-300">
            No window exists at all. This orbit is inclined {plan.plane.inclinationDeg.toFixed(1)}°, less
            than your latitude of {Math.abs(observer.latitude).toFixed(1)}°, so its ground track never
            reaches you — there is no heading and no time of day that would work. This is the constraint
            that decides where launch sites get built.
          </p>
        ) : plan.windows.length === 0 ? (
          <p className="px-4 py-4 text-sm text-space-300">No crossing in the next 48 hours.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-space-400">
                <tr className="border-b border-space-800/70">
                  <th className="text-left font-medium px-4 py-2">Window</th>
                  <th className="text-left font-medium px-4 py-2">Heading</th>
                  <th className="text-left font-medium px-4 py-2 hidden sm:table-cell">Crossing</th>
                  <th className="text-right font-medium px-4 py-2">Opens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-space-800/50">
                {plan.windows.map((w) => (
                  <tr key={w.time.toISOString()}>
                    <td className="px-4 py-2 font-mono text-space-100">{formatTime(w.time)}</td>
                    <td className="px-4 py-2 text-space-200">
                      {w.azimuthDeg.toFixed(0)}° · {azToCompass(w.azimuthDeg)}
                    </td>
                    <td className="px-4 py-2 text-space-300 hidden sm:table-cell">
                      {w.node === 'ascending' ? 'northbound' : 'southbound'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-300">
                      {countdown(displayTime, w.time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {plan.plane.inclinationDeg - Math.abs(observer.latitude) < 3 && (
              <p className="px-4 py-2 text-[11px] text-space-300 border-t border-space-800/70 leading-relaxed">
                Your latitude is within {(plan.plane.inclinationDeg - Math.abs(observer.latitude)).toFixed(1)}°
                of this orbit's inclination, so you sit almost at the highest point its ground track reaches.
                That is why the two crossings fall so close together and why the heading is nearly due east:
                a site at exactly the inclination has one tangent window a day, not two.
              </p>
            )}

            {plan.budget && (
              <div className="px-4 py-3 border-t border-space-800/70">
                <h3 className="text-xs uppercase tracking-wide text-space-400 mb-2">
                  What it costs to get there — {ALTITUDE_KM} km, {ISP_SECONDS}s engine
                </h3>
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                  <Line label="Orbital speed" value={`+${plan.budget.orbitalSpeedKmS.toFixed(2)} km/s`} />
                  <Line
                    label="Earth's rotation"
                    value={`${plan.budget.rotationAssistKmS >= 0 ? '−' : '+'}${Math.abs(
                      plan.budget.rotationAssistKmS
                    ).toFixed(2)} km/s`}
                    tone={plan.budget.rotationAssistKmS >= 0 ? 'good' : 'bad'}
                  />
                  <Line label="Gravity & drag" value={`+${plan.budget.lossesKmS.toFixed(2)} km/s`} tone="estimate" />
                  <Line label="Total" value={`${plan.budget.totalKmS.toFixed(2)} km/s`} strong />
                </dl>
                <p className="text-[11px] text-space-400 leading-relaxed mt-2">
                  Which means a vehicle {plan.budget.massRatio.toFixed(1)}× its own dry mass at lift-off —{' '}
                  {(plan.budget.propellantFraction * 100).toFixed(1)}% propellant. The rocket equation is
                  exponential, so shaving the {(plan.budget.rotationAssistKmS * 1000).toFixed(0)} m/s the
                  rotation gives you off the top is worth far more than it looks.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      <p className="text-[11px] text-space-400 leading-relaxed">
        Window times come from the target's real orbital plane, propagated with SGP4 at each instant, so
        the node's ~5°/day westward drift is included. The orbital speed and rotational assist are exact.
        The gravity-and-drag allowance is not derived — it is a representative 1.7 km/s taken from what
        real launchers pay; the true figure depends on the vehicle's thrust and pitch programme, which
        this app does not model. Real crewed launches also carry phasing constraints beyond the plane.
      </p>
    </section>
  );
}

function Fact({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-space-400">{label}</dt>
      <dd className="text-sm font-mono text-space-100">{value}</dd>
      <p className="text-[11px] text-space-400 leading-snug mt-0.5">{children}</p>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'good' | 'bad' | 'estimate';
}) {
  const colour =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'bad'
        ? 'text-amber-glow'
        : tone === 'estimate'
          ? 'text-space-300'
          : 'text-space-100';
  return (
    <div>
      <dt className="text-[11px] text-space-400">{label}</dt>
      <dd className={`font-mono ${strong ? 'text-space-100 font-semibold' : colour}`}>{value}</dd>
    </div>
  );
}
