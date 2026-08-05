import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { azElToVec3, observerToGeodetic, parseSatrec, skySampleAt } from '../../lib/sky';
import { nearestToBoresight } from '../../hooks/useDebrisField';
import type { Observer, TleRecord } from '../../types';

/**
 * The bulk catalogue, drawn as one object.
 *
 * A single THREE.Points holding every tracked fragment above the horizon: one
 * geometry, one draw call, and per update nothing but a buffer write and a draw
 * range change. Twelve thousand marker components would be twelve thousand
 * React nodes and tens of thousands of draw calls; this is one of each.
 *
 * Drawn deliberately unlike everything else in the dome. These are catalogued
 * positions, not things you could see — each is around magnitude 12, some 250
 * times fainter than the naked eye reaches — so the field has to read as data
 * rather than as sky. Small, dim, flat, uniform, and in the same violet the
 * breakup regions use, which is the colour this app reserves for "population,
 * not object". Teal is a working satellite and amber is a derelict you could
 * actually go and look at; neither of those meanings applies here.
 */

const FIELD_COLOR = '#8b7fd4';

/**
 * Small enough not to imply visibility.
 *
 * A point large enough to look like a star would be the whole problem: the
 * field would read as a sky full of objects rather than as a plotted catalogue.
 * `sizeAttenuation` off keeps each one a fixed pixel size, so zooming in
 * magnifies the sky without inflating the data.
 */
const POINT_SIZE = 1.6;
const POINT_OPACITY = 0.55;

/** Propagation interval for the bulk field, in milliseconds. */
export const FIELD_TICK_MS = 250;

/**
 * How much of the field becomes individually identified when you zoom in.
 *
 * A cone around the boresight, with a hard cap. Each promoted object becomes a
 * real marker with a label, a trail and a hit target, so its cost is per object
 * in a way the point field's is not — the field holds twelve thousand precisely
 * because none of them is any of those things.
 */
const PROMOTE_CONE_DEG = 12;
const MAX_PROMOTED = 24;

/**
 * Positions are computed and written inside the frame loop, never through React.
 *
 * This was state at first, and the state was the problem: setting it every
 * quarter second re-rendered the entire scene tree, which cost several times
 * more than the propagation it was delivering — 9.1 fps down to 7.3 under
 * software rendering, against an SGP4 burst that should have accounted for a
 * fraction of that. Nothing about a buffer of positions needs to travel through
 * React, so now nothing does: the array, the satrecs and the clock all live in
 * refs, and the only thing that reaches state is a count, throttled hard and
 * only when it actually changes.
 */
export function DebrisField({
  tles,
  observer,
  displayTime,
  labelled,
  onCountChange,
  onPromotedChange,
}: {
  tles: TleRecord[];
  observer: Observer;
  displayTime: Date;
  /** Zoomed in far enough that objects near the boresight become markers. */
  labelled: boolean;
  onCountChange: (visible: number, tracked: number) => void;
  onPromotedChange: (satnums: string[]) => void;
}) {
  const geometry = useMemo(() => new THREE.BufferGeometry(), []);
  const attribute = useRef<THREE.BufferAttribute | null>(null);
  const drawn = useRef(0);
  const lastTick = useRef(-1);
  const reportedCount = useRef(-1);

  // Parsed once per catalogue. twoline2satrec is the expensive part and the
  // elements do not change between frames.
  const parsed = useMemo(() => {
    const recs = [];
    const ids: string[] = [];
    for (const tle of tles) {
      const rec = parseSatrec(tle);
      if (rec) {
        recs.push(rec);
        ids.push(tle.satnum);
      }
    }
    return { recs, ids };
  }, [tles]);

  const observerGd = useMemo(() => observerToGeodetic(observer), [observer]);

  // One allocation per catalogue size, reused for the field's whole lifetime.
  const buffer = useMemo(() => new Float32Array(parsed.recs.length * 3), [parsed.recs.length]);
  const visibleIds = useRef<string[]>([]);

  useEffect(() => {
    if (buffer.length === 0) return;
    attribute.current = new THREE.BufferAttribute(buffer, 3);
    attribute.current.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', attribute.current);
    lastTick.current = -1;
  }, [buffer, geometry]);

  // The scrubber's time, read through a ref so a moving clock does not re-render.
  const timeRef = useRef(displayTime);
  timeRef.current = displayTime;

  const camera = useThree((s) => s.camera);
  const boresight = useRef(new THREE.Vector3());
  const promotedKey = useRef('');

  useFrame(() => {
    if (parsed.recs.length === 0 || !attribute.current) return;
    const tick = Math.floor(timeRef.current.getTime() / FIELD_TICK_MS);

    // Promotion tracks the camera, so it is checked every frame while zoomed in
    // even when positions have not moved. It is a dot product per visible
    // object against a list that is already in hand.
    if (tick === lastTick.current) {
      if (!labelled) {
        if (promotedKey.current !== '') {
          promotedKey.current = '';
          onPromotedChange([]);
        }
        return;
      }
      camera.getWorldDirection(boresight.current);
      const near = nearestToBoresight(buffer, drawn.current, visibleIds.current, boresight.current, PROMOTE_CONE_DEG, MAX_PROMOTED);
      const key = near.join(',');
      if (key !== promotedKey.current) {
        promotedKey.current = key;
        onPromotedChange(near);
      }
      return;
    }
    lastTick.current = tick;

    const when = new Date(tick * FIELD_TICK_MS);
    const ids: string[] = [];
    let n = 0;
    for (let i = 0; i < parsed.recs.length; i++) {
      const sample = skySampleAt(parsed.recs[i], observerGd, when);
      if (!sample || sample.elevationDeg < 0) continue;
      const [x, y, z] = azElToVec3(sample.azimuthDeg, sample.elevationDeg);
      buffer[n * 3] = x;
      buffer[n * 3 + 1] = y;
      buffer[n * 3 + 2] = z;
      ids.push(parsed.ids[i]);
      n++;
    }
    visibleIds.current = ids;
    drawn.current = n;
    attribute.current.needsUpdate = true;
    geometry.setDrawRange(0, n);

    // Only this crosses into React, and only when it moves.
    if (n !== reportedCount.current) {
      reportedCount.current = n;
      onCountChange(n, parsed.recs.length);
    }
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (parsed.recs.length === 0) return null;

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        color={FIELD_COLOR}
        size={POINT_SIZE}
        sizeAttenuation={false}
        transparent
        opacity={POINT_OPACITY}
        depthWrite={false}
      />
    </points>
  );
}
