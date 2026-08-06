import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { azElToVec3, observerToGeodetic, parseSatrec, skySampleAt } from '../../lib/sky';
import { nearestToBoresight } from '../../hooks/useDebrisField';
import { FrontFacingHtml } from './FrontFacingHtml';
import type { Observer, TleRecord } from '../../types';

/**
 * The bulk catalogue, drawn as one object.
 *
 * A single InstancedMesh holding every tracked fragment above the horizon: one
 * geometry, one material, one draw call, and per update nothing but a matrix
 * per object and an instance count. Twelve thousand marker components would be
 * twelve thousand React nodes and tens of thousands of draw calls; this is one
 * of each.
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
 * Solid bodies, not sprites — and still one draw call.
 *
 * These were flat points, which is what let one object hold the whole
 * catalogue. An InstancedMesh keeps that property: a single geometry and
 * material submitted once, with a transform per instance, so two and a half
 * thousand real octahedra cost one draw call exactly as the point cloud did.
 * A marker component each would be thousands of React nodes and thousands of
 * draws; this is one of each, and the only per-object work is composing a
 * matrix.
 *
 * The shape is the derelict marker's octahedron, which is deliberate: a
 * fragment and a spent stage are the same kind of thing at different sizes, so
 * they should not be different shapes. Lambert rather than basic, so the
 * dome's existing lights actually model them and they read as solid from any
 * angle, with a little emissive so one facing away does not vanish.
 *
 * Nominal radius against a dome radius of 100. At a 60-degree field of view
 * over a 780-pixel canvas this subtends roughly seven pixels before the
 * per-instance shard scaling below stretches it either way — still a fraction
 * of the ~55 pixels a satellite marker occupies. That ordering matters more
 * than the absolute size: a fragment must never look like a thing you could go
 * outside and see.
 *
 * These are world-space geometry, so unlike the points they replaced they grow
 * when you zoom in, the same as every other object in the dome.
 */
const FRAGMENT_RADIUS = 0.58;

/**
 * Irregular, because that is the one thing about their shape that is known.
 *
 * There is no appearance reference for these objects and there cannot be. A
 * catalogued fragment is a ten-centimetre piece of a shredded satellite; it has
 * been tracked by radar, never photographed. Drawing a "realistic" fragment
 * would mean inventing one, so this does not attempt a likeness of any
 * particular object.
 *
 * What is documented is the form. Collision and explosion debris is angular and
 * irregular, spanning a wide range of area-to-mass ratios — the distribution
 * that breakup models are built around — which in practice means plates and
 * splinters rather than uniform lumps. So each instance gets a non-uniform
 * scale: some flattened, some elongated, none identical. That is a
 * representative shape, not a portrait, and it is as far as the evidence goes.
 *
 * Non-uniform scale rather than different geometries, because a second
 * geometry would mean a second draw call and a second instance-id space for
 * hover to disambiguate. One mesh keeps both.
 */
const SHARD_MIN = 0.45;
const SHARD_MAX = 1.55;

const FIELD_OPACITY = 0.9;

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
  const mesh = useRef<THREE.InstancedMesh | null>(null);
  const drawn = useRef(0);
  const lastTick = useRef(-1);
  const reportedCount = useRef(-1);

  // Parsed once per catalogue. twoline2satrec is the expensive part and the
  // elements do not change between frames.
  const parsed = useMemo(() => {
    const recs = [];
    const ids: string[] = [];
    const names: string[] = [];
    for (const tle of tles) {
      const rec = parseSatrec(tle);
      if (rec) {
        recs.push(rec);
        ids.push(tle.satnum);
        names.push(tle.name);
      }
    }
    return { recs, ids, names };
  }, [tles]);

  const observerGd = useMemo(() => observerToGeodetic(observer), [observer]);

  // One allocation per catalogue size, reused for the field's whole lifetime.
  const buffer = useMemo(() => new Float32Array(parsed.recs.length * 3), [parsed.recs.length]);
  const visibleIds = useRef<string[]>([]);
  /** Parallel to visibleIds: what the tooltip needs, without a second lookup. */
  const visibleInfo = useRef<Array<{ name: string; satnum: string; az: number; el: number; km: number }>>([]);

  /**
   * A fixed random orientation and shard proportions per fragment.
   *
   * Real debris is irregular, and a field of identically-oriented octahedra
   * reads as a repeated sprite rather than a population of objects. The
   * orientations are generated once and reused, not re-rolled per frame:
   * tumbling them would mean rebuilding and re-uploading every instance matrix
   * sixty times a second, which is exactly the per-object cost this component
   * exists to avoid. Deterministic from the index, so a fragment does not jump
   * to a new attitude on re-render.
   */
  const attitudes = useMemo(() => {
    const q: THREE.Quaternion[] = [];
    const scales: THREE.Vector3[] = [];
    const e = new THREE.Euler();
    const frac = (n: number) => n - Math.floor(n);
    const span = SHARD_MAX - SHARD_MIN;
    for (let i = 0; i < parsed.recs.length; i++) {
      const a = frac(Math.sin(i * 12.9898) * 43758.5453);
      const b = frac(Math.sin(i * 78.233) * 12345.6789);
      const c = frac(Math.sin(i * 39.425) * 24634.6345);
      const d = frac(Math.sin(i * 57.117) * 31415.9265);
      e.set(a * Math.PI * 2, b * Math.PI * 2, c * Math.PI * 2);
      q.push(new THREE.Quaternion().setFromEuler(e));
      // Three independent axes, so a fragment can come out as a plate, a
      // splinter or something between, rather than a scaled copy of its
      // neighbour.
      scales.push(
        new THREE.Vector3(
          SHARD_MIN + a * span,
          SHARD_MIN + d * span,
          SHARD_MIN + c * span
        )
      );
    }
    return { q, scales };
  }, [parsed.recs.length]);

  useEffect(() => {
    lastTick.current = -1;
  }, [parsed.recs.length]);

  // The scrubber's time, read through a ref so a moving clock does not re-render.
  const timeRef = useRef(displayTime);
  timeRef.current = displayTime;


  /**
   * What the pointer is over, if anything.
   *
   * three.js raycasts an InstancedMesh and reports which instance was hit, so
   * the whole field needs one hit target rather than one per fragment — the
   * same reason it needs one draw call. Without this the field was the only
   * thing in the dome you could not interrogate: it drew two thousand objects
   * and would not tell you what any of them were.
   *
   * Held as state because a tooltip is a DOM node and has to re-render, but it
   * changes only when the pointer moves onto a different fragment, not per
   * frame — the propagation loop above still touches no state at all.
   */
  const [hover, setHover] = useState<{
    name: string;
    satnum: string;
    az: number;
    el: number;
    km: number;
    at: [number, number, number];
  } | null>(null);

  const camera = useThree((s) => s.camera);
  const boresight = useRef(new THREE.Vector3());
  const promotedKey = useRef('');

  // Scratch objects, reused every tick so the loop allocates nothing.
  const scratchMatrix = useMemo(() => new THREE.Matrix4(), []);
  const scratchPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (parsed.recs.length === 0 || !mesh.current) return;
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
    const info: Array<{ name: string; satnum: string; az: number; el: number; km: number }> = [];
    let n = 0;
    for (let i = 0; i < parsed.recs.length; i++) {
      const sample = skySampleAt(parsed.recs[i], observerGd, when);
      if (!sample || sample.elevationDeg < 0) continue;
      const [x, y, z] = azElToVec3(sample.azimuthDeg, sample.elevationDeg);
      // Kept alongside the instance matrices: boresight promotion reads raw
      // positions, and a dot product over a flat array beats decomposing
      // matrices for every object in the cone.
      buffer[n * 3] = x;
      buffer[n * 3 + 1] = y;
      buffer[n * 3 + 2] = z;
      scratchPos.set(x, y, z);
      scratchMatrix.compose(scratchPos, attitudes.q[i], attitudes.scales[i]);
      mesh.current.setMatrixAt(n, scratchMatrix);
      ids.push(parsed.ids[i]);
      info.push({
        name: parsed.names[i],
        satnum: parsed.ids[i],
        az: sample.azimuthDeg,
        el: sample.elevationDeg,
        km: sample.rangeKm,
      });
      n++;
    }
    visibleIds.current = ids;
    visibleInfo.current = info;
    drawn.current = n;
    mesh.current.count = n;
    mesh.current.instanceMatrix.needsUpdate = true;

    // Only this crosses into React, and only when it moves.
    if (n !== reportedCount.current) {
      reportedCount.current = n;
      onCountChange(n, parsed.recs.length);
    }
  });

  if (parsed.recs.length === 0) return null;

  return (
    <>
      <instancedMesh
        // Capacity is fixed when the mesh is built, so a new catalogue needs a
        // new mesh rather than a resized one.
        key={parsed.recs.length}
        ref={mesh}
        args={[undefined, undefined, parsed.recs.length]}
        frustumCulled={false}
        onPointerMove={(e) => {
          const id = e.instanceId;
          if (id === undefined || id >= drawn.current) return;
          // Only the nearest hit matters, and only this object's.
          e.stopPropagation();
          const info = visibleInfo.current[id];
          if (!info) return;
          if (hover?.satnum === info.satnum) return;
          setHover({
            ...info,
            at: [buffer[id * 3], buffer[id * 3 + 1], buffer[id * 3 + 2]],
          });
        }}
        onPointerOut={() => setHover(null)}
      >
        <octahedronGeometry args={[FRAGMENT_RADIUS, 0]} />
        <meshLambertMaterial
          color={FIELD_COLOR}
          emissive={FIELD_COLOR}
          emissiveIntensity={0.45}
          transparent
          opacity={FIELD_OPACITY}
        />
      </instancedMesh>

      {hover && (
        <FrontFacingHtml position={hover.at} offsetYPx={-14} zIndexRange={[40, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-[#8b7fd4]/40 bg-space-900/95 px-2 py-1.5 text-[11px] leading-tight shadow-lg">
            <div className="font-semibold" style={{ color: FIELD_COLOR }}>
              {hover.name}
            </div>
            <div className="text-space-300 font-mono text-[10px] mt-0.5">
              #{hover.satnum} · el {hover.el.toFixed(1)}° · az {hover.az.toFixed(1)}°
            </div>
            <div className="text-space-300 font-mono text-[10px]">
              {Math.round(hover.km).toLocaleString()} km away
            </div>
            {/* The one thing a tooltip on a plotted object has to say, or it
                reads as an observing target. */}
            <div className="text-space-400 text-[10px] mt-1 max-w-[15rem] whitespace-normal">
              Catalogued debris — far too faint to see. Zoom in to pick it out with a full label.
            </div>
          </div>
        </FrontFacingHtml>
      )}
    </>
  );
}
