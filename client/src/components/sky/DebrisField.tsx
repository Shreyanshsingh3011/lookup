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
 * rather than as sky. Flat, uniform, unlit, and in the same violet the breakup
 * regions use, which is the colour this app reserves for "population, not
 * object". Teal is a working satellite and amber is a derelict you could
 * actually go and look at; neither of those meanings applies here.
 *
 * What that no longer means is "too small to find". The first version made the
 * points sub-pixel in the name of not overstating them, which just meant the
 * dome silently omitted objects its own status line was counting. Distinctness
 * carries the caveat now; size does not.
 */

const FIELD_COLOR = '#8b7fd4';

/**
 * Big enough to actually see, in CSS pixels rather than device pixels.
 *
 * This was 1.6 with `sizeAttenuation` off, chosen so the field would not imply
 * these objects are visible to the eye. It went too far: three.js sizes points
 * in the drawing buffer, so on a 2x display 1.6 became 0.8 CSS pixels, and at
 * 55% opacity the field was drawing 195 objects that nobody could find. A
 * status line reporting objects the dome does not show is worse than either
 * choice on its own.
 *
 * So the size is now multiplied by the renderer's pixel ratio, which makes it
 * mean the same thing on every display. The honesty that the small size was
 * carrying moves to where it belongs: the colour is still the violet reserved
 * for "population, not object", and the status line under the dome states the
 * magnitude outright.
 *
 * `sizeAttenuation` stays off so zooming magnifies the sky without inflating
 * the data — a fragment must not grow into something that looks bright.
 */
const POINT_SIZE_CSS_PX = 3.4;
const POINT_OPACITY = 0.85;

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

  // Point size is in drawing-buffer pixels, so it has to be scaled by the
  // renderer's ratio or the field is half size on a retina screen and double on
  // none. Read from the renderer rather than window.devicePixelRatio, because
  // the canvas is what actually decides it.
  const pixelRatio = useThree((s) => s.gl.getPixelRatio());

  /**
   * A round dot rather than the default square.
   *
   * At three pixels a square reads as a hard speck of dust; a disc with a soft
   * edge reads as a plotted object and survives being drawn two thousand times
   * without turning the sky into gravel. Built once, in code, so there is no
   * image to fetch and nothing to go missing offline.
   */
  const dotTexture = useMemo(() => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);
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
  useEffect(() => () => dotTexture?.dispose(), [dotTexture]);

  if (parsed.recs.length === 0) return null;

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        color={FIELD_COLOR}
        size={POINT_SIZE_CSS_PX * pixelRatio}
        map={dotTexture}
        alphaTest={0.01}
        sizeAttenuation={false}
        transparent
        opacity={POINT_OPACITY}
        depthWrite={false}
      />
    </points>
  );
}
