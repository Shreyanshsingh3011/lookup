import { useEffect, useMemo, useState } from 'react';
import { fetchSmallBodies } from '../api/client';
import { localSiderealTime } from '../lib/celestialMath';
import { periodDays, positionOf, type SmallBody } from '../lib/smallBodies';
import { azToCompass } from '../lib/sky';
import type { Observer, SmallBodyRecord } from '../types';

/**
 * Comets and asteroids.
 *
 * Sorted by what is actually up and bright, because a list ordered by
 * catalogue number would bury the one thing worth going outside for under
 * forty rocks below the horizon.
 */

/** Roughly the naked-eye limit under a suburban sky; below this needs optics. */
const NAKED_EYE_LIMIT = 5.5;
const BINOCULAR_LIMIT = 10;

function toSmallBody(record: SmallBodyRecord): SmallBody {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    elements: {
      e: record.e,
      q: record.q,
      tp: new Date(record.tp),
      i: record.i,
      node: record.node,
      peri: record.peri,
    },
    absoluteMagnitude: record.absoluteMagnitude,
    slope: record.slope,
  };
}

function describeReach(magnitude: number | null): string {
  if (magnitude === null) return 'brightness unknown';
  if (magnitude <= NAKED_EYE_LIMIT) return 'naked eye';
  if (magnitude <= BINOCULAR_LIMIT) return 'binoculars';
  return 'telescope';
}

export function SmallBodies({ observer, displayTime }: { observer: Observer; displayTime: Date }) {
  const [records, setRecords] = useState<SmallBodyRecord[] | null>(null);
  const [source, setSource] = useState<'live' | 'cache' | 'builtin'>('live');
  const [note, setNote] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSmallBodies()
      .then((res) => {
        if (cancelled) return;
        setRecords(res.bodies);
        setSource(res.source);
        setNote(res.error ?? null);
      })
      .catch(() => {
        if (!cancelled) setRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Positions move by arcminutes an hour, so this is pinned to the minute
  // rather than re-solving Kepler's equation on every tick of the clock.
  const minute = Math.floor(displayTime.getTime() / 60_000);
  const rows = useMemo(() => {
    if (!records) return [];
    const when = new Date(minute * 60_000);
    const lst = localSiderealTime(when, observer.longitude);

    return records
      .map((record) => {
        const body = toSmallBody(record);
        try {
          return { record, body, position: positionOf(body, observer, when, lst) };
        } catch {
          return null;
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null && Number.isFinite(row.position.distanceAu))
      .sort((a, b) => {
        // Up and bright first: something below the horizon cannot be looked at
        // however bright it is.
        const aUp = a.position.elevationDeg > 0;
        const bUp = b.position.elevationDeg > 0;
        if (aUp !== bUp) return aUp ? -1 : 1;
        return (a.position.magnitude ?? 99) - (b.position.magnitude ?? 99);
      });
  }, [records, observer, minute]);

  if (!records) return null;

  const visible = rows.filter((r) => r.position.elevationDeg > 0);
  const shown = showAll ? rows : rows.slice(0, 8);

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-medium text-space-100">Comets and asteroids</h2>
        <p className="text-xs text-space-300">
          {visible.length} of {rows.length} above the horizon
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="glass-panel rounded-xl px-4 py-3 text-sm text-space-300">
          No small-body elements available right now.
        </p>
      ) : (
        <div className="glass-panel rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[40rem]">
            <thead className="text-[11px] uppercase tracking-wide text-space-400">
              <tr className="border-b border-space-800/70">
                <th className="text-left font-medium px-4 py-2">Object</th>
                <th className="text-left font-medium px-4 py-2">Where</th>
                <th className="text-right font-medium px-4 py-2">Mag</th>
                <th className="text-right font-medium px-4 py-2">From Sun</th>
                <th className="text-right font-medium px-4 py-2">From Earth</th>
                <th className="text-right font-medium px-4 py-2">Orbit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-space-800/50">
              {shown.map(({ record, body, position }) => {
                const up = position.elevationDeg > 0;
                const period = periodDays(body.elements);
                return (
                  <tr key={record.id} className={up ? '' : 'opacity-55'}>
                    <td className="px-4 py-2">
                      <div className="text-space-100">{record.name}</div>
                      <div className="text-[11px] text-space-400">
                        {record.kind === 'comet' ? 'comet' : 'asteroid'} ·{' '}
                        {describeReach(position.magnitude)}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-space-200">
                      {up ? (
                        <>
                          {position.elevationDeg.toFixed(0)}° up in the{' '}
                          {azToCompass(position.azimuthDeg)}
                        </>
                      ) : (
                        <span className="text-space-400">below the horizon</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-100">
                      {position.magnitude === null ? '—' : position.magnitude.toFixed(1)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-300">
                      {position.heliocentricAu.toFixed(2)} AU
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-300">
                      {position.distanceAu.toFixed(2)} AU
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-space-300">
                      {period === null
                        ? record.e >= 1
                          ? 'never returns'
                          : '—'
                        : `${(period / 365.25).toFixed(1)} yr`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full px-4 py-2 text-[11px] text-glow-400 hover:underline text-left"
            >
              Show the other {rows.length - shown.length}
            </button>
          )}
        </div>
      )}

      <p className="text-[11px] text-space-400 leading-relaxed">
        {note && <span className="text-amber-glow">{note} Showing the built-in asteroids. </span>}
        {source === 'cache' && <span className="text-amber-glow">Elements from a cached copy. </span>}
        Positions are solved from published orbital elements as a two-body problem, which is exact for the
        orbit as given and ignores the tug of the planets — good to well under a degree over the months
        an element set is meant to cover, and progressively less so beyond it. Asteroid magnitudes follow
        the standard H–G system and are reliable. Comet magnitudes are not: a comet's brightness depends
        on how much of it happens to be sublimating, and the fitted relation used here routinely misses by
        a couple of magnitudes in either direction. Treat a predicted comet magnitude as a hope rather
        than a forecast.
      </p>
    </section>
  );
}
