import { useEffect, useMemo, useState } from 'react';
import { fetchTransmitters } from '../api/client';
import {
  dopplerShiftHz,
  formatFrequency,
  formatShift,
  radioPassesForTles,
  rangeSample,
  receivedFrequencyHz,
  transmitFrequencyHz,
} from '../lib/amateurRadio';
import { parseSatrec } from '../lib/sky';
import { azToCompass } from '../lib/sky';
import type { Observer, TleRecord, TransmitterResponse } from '../types';

/**
 * Working satellites rather than watching them.
 *
 * The rest of the app is about seeing things, which needs the observer in
 * darkness and the satellite in sunlight and so throws away most of the day. A
 * radio operator needs neither: the satellite is workable whenever it is above
 * the horizon, in broad daylight and through cloud. These are its own passes
 * for that reason.
 */

const SOURCE_NOTE: Record<TransmitterResponse['source'], string | null> = {
  live: null,
  cache: 'Frequencies from a cached copy of the register.',
  builtin: 'The frequency register is unreachable — these are the built-in ISS figures.',
  unavailable: null,
};

function clock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function RadioPasses({
  tles,
  observer,
  displayTime,
}: {
  tles: TleRecord[];
  observer: Observer;
  displayTime: Date;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [radio, setRadio] = useState<TransmitterResponse | null>(null);

  const target = useMemo(() => {
    if (tles.length === 0) return null;
    if (selected) {
      const match = tles.find((t) => t.satnum === selected);
      if (match) return match;
    }
    // The station is the one nearly everybody means, and the one with a
    // built-in fallback if the register cannot be reached.
    return tles.find((t) => /\bISS\b|ZARYA/i.test(t.name)) ?? tles[0];
  }, [tles, selected]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setRadio(null);
    fetchTransmitters(target.satnum)
      .then((res) => {
        if (!cancelled) setRadio(res);
      })
      .catch(() => {
        if (!cancelled) {
          setRadio({ satnum: target.satnum, transmitters: [], source: 'unavailable' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target]);

  // Pass geometry is fixed for the day, so it is pinned to the minute rather
  // than recomputed on every tick of the clock.
  const minute = Math.floor(displayTime.getTime() / 60_000);
  const passes = useMemo(() => {
    if (!target) return [];
    return radioPassesForTles([target], observer, new Date(minute * 60_000), 24, 0).slice(0, 6);
  }, [target, observer, minute]);

  // The live Doppler, on the other hand, is the whole point of being on this
  // panel during a pass, so it does follow the clock.
  const live = useMemo(() => {
    if (!target) return null;
    const satrec = parseSatrec(target);
    if (!satrec) return null;
    return rangeSample(satrec, observer, displayTime);
  }, [target, observer, displayTime]);

  if (!target) return null;

  const working = radio?.transmitters.filter((t) => t.alive) ?? [];
  const note = radio ? SOURCE_NOTE[radio.source] : null;
  const overhead = live !== null && live.elevationDeg > 0;

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-medium text-space-100">Working it by radio</h2>
        <p className="text-xs text-space-300 hidden sm:block">
          every pass, day or night · Doppler from the orbit
        </p>
      </div>

      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-space-800/70">
          <label className="text-xs text-space-300" htmlFor="radio-target">
            Satellite
          </label>
          <select
            id="radio-target"
            value={target.satnum}
            onChange={(e) => setSelected(e.target.value)}
            className="text-xs bg-space-800/80 border border-space-600 rounded-lg px-2 py-1.5 text-space-100 max-w-[16rem]"
          >
            {tles.map((t) => (
              <option key={t.satnum} value={t.satnum}>
                {t.name}
              </option>
            ))}
          </select>
          {live && (
            <span className="text-xs font-mono text-space-300">
              {overhead ? (
                <span className="text-emerald-300">
                  up now · {live.elevationDeg.toFixed(0)}° in the {azToCompass(live.azimuthDeg)} ·{' '}
                  {live.rangeKm.toFixed(0)} km
                </span>
              ) : (
                <>below the horizon · {live.rangeKm.toFixed(0)} km away</>
              )}
            </span>
          )}
        </div>

        {radio && working.length > 0 && live && (
          <div className="px-4 py-3 border-b border-space-800/70">
            <h3 className="text-xs uppercase tracking-wide text-space-400 mb-2">
              Tune to {overhead ? 'now' : 'at the moment shown'}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[34rem]">
                <thead className="text-[11px] uppercase tracking-wide text-space-400">
                  <tr className="border-b border-space-800/70">
                    <th className="text-left font-medium py-1.5 pr-4">Service</th>
                    <th className="text-right font-medium py-1.5 pr-4">Receive on</th>
                    <th className="text-right font-medium py-1.5 pr-4">Transmit on</th>
                    <th className="text-right font-medium py-1.5">Shift</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-space-800/50">
                  {working.map((t) => (
                    <tr key={`${t.description}-${t.downlinkHz ?? t.uplinkHz}`}>
                      <td className="py-1.5 pr-4 text-space-200">
                        {t.description}
                        {t.mode && <span className="text-[11px] text-space-400"> · {t.mode}</span>}
                      </td>
                      <td className="py-1.5 pr-4 text-right font-mono text-space-100">
                        {t.downlinkHz
                          ? formatFrequency(receivedFrequencyHz(t.downlinkHz, live.rangeRateKmS))
                          : <span className="text-space-500">—</span>}
                      </td>
                      <td className="py-1.5 pr-4 text-right font-mono text-space-100">
                        {t.uplinkHz
                          ? formatFrequency(transmitFrequencyHz(t.uplinkHz, live.rangeRateKmS))
                          : <span className="text-space-500">—</span>}
                      </td>
                      <td className="py-1.5 text-right font-mono text-space-300">
                        {t.downlinkHz ? formatShift(dopplerShiftHz(t.downlinkHz, live.rangeRateKmS)) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-space-400 mt-2 leading-relaxed">
              Receive high on the way in and low on the way out; the uplink correction runs the other way,
              because the satellite's motion toward you raises what it hears. Range rate right now is{' '}
              <span className="font-mono">{live.rangeRateKmS.toFixed(3)} km/s</span>
              {live.rangeRateKmS < 0 ? ' — closing.' : ' — receding.'}
            </p>
          </div>
        )}

        {radio && working.length === 0 && (
          <p className="px-4 py-3 text-sm text-space-300 border-b border-space-800/70">
            {radio.source === 'unavailable'
              ? `No frequencies available — ${radio.error ?? 'the register could not be reached'}. The pass times below come from the orbit and do not depend on it.`
              : `${target.name} carries no amateur radio service the register knows about.`}
          </p>
        )}

        {passes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[36rem]">
              <thead className="text-[11px] uppercase tracking-wide text-space-400">
                <tr className="border-b border-space-800/70">
                  <th className="text-left font-medium px-4 py-2">AOS</th>
                  <th className="text-left font-medium px-4 py-2">Peak</th>
                  <th className="text-left font-medium px-4 py-2">LOS</th>
                  <th className="text-right font-medium px-4 py-2">Max el</th>
                  <th className="text-right font-medium px-4 py-2">Length</th>
                  <th className="text-right font-medium px-4 py-2">Closest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-space-800/50">
                {passes.map((p) => (
                  <tr key={p.aos.toISOString()}>
                    <td className="px-4 py-2 font-mono text-space-100">
                      {clock(p.aos)}
                      <span className="text-[11px] text-space-400"> {azToCompass(p.aosAzimuthDeg)}</span>
                    </td>
                    <td className="px-4 py-2 font-mono text-space-300">{clock(p.tca)}</td>
                    <td className="px-4 py-2 font-mono text-space-100">
                      {clock(p.los)}
                      <span className="text-[11px] text-space-400"> {azToCompass(p.losAzimuthDeg)}</span>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-200">
                      {p.maxElevationDeg.toFixed(0)}°
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-300">
                      {duration(p.durationSeconds)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-300">
                      {p.minRangeKm.toFixed(0)} km
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-space-300">
            No passes above the horizon in the next 24 hours.
          </p>
        )}
      </div>

      <p className="text-[11px] text-space-400 leading-relaxed">
        {note && <span className="text-amber-glow">{note} </span>}
        These are radio passes, not visible ones: they need neither darkness nor sunlight, so there are far
        more of them than the visible list shows, and low ones are included because a station with a beam
        can work them. Doppler is computed from the orbit and includes your own motion with the Earth —
        about 465 m/s at the equator, worth a few hundred hertz at 435 MHz. No signal strength is
        predicted: that depends on your antenna, your feedline and your horizon, none of which this app
        knows. Frequencies come from the SatNOGS register and are worth confirming before you key up.
      </p>
    </section>
  );
}
