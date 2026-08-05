import { useCallback, useMemo, useState } from 'react';
import { assessReach, preFilter } from '../lib/debris';
import type { Observer, SpaceTrackObject, TleRecord } from '../types';

/**
 * Objects a user has picked out of the full catalogue to watch in the dome.
 *
 * The dome's debris layer defaults to the curated set — four named clouds and
 * eight resolved derelicts — and that stays true whatever happens here. These
 * are additive: searching the catalogue and choosing something adds it to the
 * same layer, drawn by the same marker with the same detail panel. There is no
 * second live view, and the default view does not change because a search
 * happened.
 *
 * Capped, and not as a performance guess. Twelve thousand objects propagate in
 * about nine milliseconds per frame, which is over half a frame before anything
 * is drawn, and each one is a marker component with a trail and a hit target.
 * More importantly every one of them is around magnitude 12 — a sky full of
 * points nobody can see is a worse answer than a handful you chose. So there is
 * no "show everything", and this refuses politely at the cap rather than
 * degrading quietly past it.
 */
export const MAX_PINNED = 40;

export interface PinnedObjects {
  /** Element sets to hand the dome, already reach-filtered for this observer. */
  tles: TleRecord[];
  /** Notes keyed by catalogue number, for the tapped detail panel. */
  notes: Map<string, string>;
  /** Everything pinned, including any that cannot rise here. */
  all: SpaceTrackObject[];
  /** Pinned but rejected by the coarse filter, with why. */
  unreachable: Array<{ object: SpaceTrackObject; reason: string }>;
  pin: (object: SpaceTrackObject) => { ok: boolean; message?: string };
  unpin: (satnum: string) => void;
  clear: () => void;
  isPinned: (satnum: string) => boolean;
  atCapacity: boolean;
}

const REASON_TEXT: Record<string, string> = {
  'never-rises': 'its ground track never reaches your latitude',
  'too-low': 'its perigee is already below 130 km',
  'too-high': 'it is too far out to show in this view',
  unreadable: 'its element set will not parse',
};

/**
 * What to say about an object in the dome when it is tapped.
 *
 * Built from the catalogue's own fields rather than written per object, because
 * there are twelve thousand of them and none has a hand-written story. Declared
 * type and size are facts from Space-Track; the absence of a downlink note is
 * handled by the marker itself, which queries the register on selection.
 */
function describe(object: SpaceTrackObject): string {
  const bits: string[] = [object.objectType.toLowerCase()];
  if (object.rcsSize) bits.push(`${object.rcsSize.toLowerCase()} radar cross-section`);
  if (object.country) bits.push(object.country);
  if (object.launchDate) bits.push(`launched ${object.launchDate}`);
  const orbit =
    object.perigeeKm !== null && object.apogeeKm !== null
      ? `${Math.round(object.perigeeKm)}–${Math.round(object.apogeeKm)} km`
      : null;
  if (orbit) bits.push(orbit);
  if (object.inclinationDeg !== null) bits.push(`${object.inclinationDeg.toFixed(1)}° inclination`);
  return `From the full catalogue: ${bits.join(' · ')}.`;
}

export function usePinnedObjects(observer: Observer): PinnedObjects {
  const [all, setAll] = useState<SpaceTrackObject[]>([]);

  const pin = useCallback(
    (object: SpaceTrackObject): { ok: boolean; message?: string } => {
      let result: { ok: boolean; message?: string } = { ok: true };
      setAll((prev) => {
        if (prev.some((o) => o.satnum === object.satnum)) {
          result = { ok: false, message: `${object.name} is already in the dome.` };
          return prev;
        }
        if (prev.length >= MAX_PINNED) {
          result = {
            ok: false,
            message: `The dome holds ${MAX_PINNED} catalogue objects at once. Remove one to add another.`,
          };
          return prev;
        }
        return [...prev, object];
      });
      return result;
    },
    []
  );

  const unpin = useCallback((satnum: string) => {
    setAll((prev) => prev.filter((o) => o.satnum !== satnum));
  }, []);

  const clear = useCallback(() => setAll([]), []);

  // The coarse reach filter, applied before anything is propagated. Not optional
  // at catalogue scale: an object that can never rise here would otherwise be
  // integrated forward several times a second, forever, to be found below the
  // horizon every time.
  const filtered = useMemo(() => {
    if (all.length === 0) {
      return { tles: [] as TleRecord[], unreachable: [] as Array<{ object: SpaceTrackObject; reason: string }> };
    }
    const kept = preFilter(
      all.map((o) => o.tle),
      observer
    ).candidates;
    const keptIds = new Set(kept.map((t) => t.satnum));
    const unreachable = all
      .filter((o) => !keptIds.has(o.satnum))
      .map((o) => ({
        object: o,
        reason: REASON_TEXT[assessReach(o.tle, observer).reason] ?? 'it cannot be shown from here',
      }));
    return { tles: kept, unreachable };
  }, [all, observer]);

  const notes = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of all) map.set(o.satnum, describe(o));
    return map;
  }, [all]);

  const isPinned = useCallback((satnum: string) => all.some((o) => o.satnum === satnum), [all]);

  return {
    tles: filtered.tles,
    notes,
    all,
    unreachable: filtered.unreachable,
    pin,
    unpin,
    clear,
    isPinned,
    atCapacity: all.length >= MAX_PINNED,
  };
}
