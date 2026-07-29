import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { localSiderealTime } from '../../lib/celestial';
import { DOME_RADIUS } from '../../lib/sky';
import { useSkyObjects } from '../../hooks/useSkyObjects';
import { CameraAim, type AimTarget } from './CameraAim';
import { DomeShell } from './DomeShell';
import { PlanetLayer } from './PlanetLayer';
import { SatelliteMarker } from './SatelliteMarker';
import { StarLayer } from './StarLayer';
import type { Observer, Pass, TleRecord } from '../../types';

/** Stable empty array, so toggling the layer off doesn't churn memoisation. */
const EMPTY_SATELLITES: ReturnType<typeof useSkyObjects> = [];

/**
 * The camera orbits at a tiny fixed radius around the dome's centre, so the
 * viewer is effectively standing at the observer's own position looking out.
 * Keeping this distance negligible against DOME_RADIUS means objects placed by
 * azimuth/elevation render at the correct angles with no parallax error.
 */
const CAMERA_DISTANCE = 0.02;

/** Start looking north, about 35 degrees above the horizon. */
const CAMERA_START: [number, number, number] = [0, -0.011472, 0.016384];

const MIN_FOV = 25;
const MAX_FOV = 95;

/**
 * Zoom by changing field of view rather than dollying, since the camera's
 * distance from the dome centre is pinned. Handles wheel and pinch.
 */
function FovZoom() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;

    const applyFov = (fov: number) => {
      camera.fov = THREE.MathUtils.clamp(fov, MIN_FOV, MAX_FOV);
      camera.updateProjectionMatrix();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyFov(camera.fov + e.deltaY * 0.05);
    };

    let pinchStartDist: number | null = null;
    let pinchStartFov = camera.fov;
    const touchDistance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDist = touchDistance(e.touches);
        pinchStartFov = camera.fov;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist) {
        e.preventDefault();
        applyFov(pinchStartFov / (touchDistance(e.touches) / pinchStartDist));
      }
    };
    const onTouchEnd = () => {
      pinchStartDist = null;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [camera, gl]);

  return null;
}

/**
 * Exposes the live scene for debugging and browser-driven checks. Guarded by
 * `import.meta.env.DEV`, so it is dead code in production bundles.
 */
function DevProbe({ satellites }: { satellites: ReturnType<typeof useSkyObjects> }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__sky = { camera, scene, satellites };
  }, [camera, scene, satellites]);

  return null;
}

export interface SkyLayers {
  satellites: boolean;
  stars: boolean;
  constellations: boolean;
  planets: boolean;
}

interface SceneProps {
  tles: TleRecord[];
  observer: Observer;
  displayTime: Date;
  passes: Pass[];
  selected: string | null;
  onSelect: (satnum: string | null) => void;
  onCountChange: (count: number) => void;
  aimRequest: number;
  layers: SkyLayers;
}

function SkyScene({
  tles,
  observer,
  displayTime,
  passes,
  selected,
  onSelect,
  onCountChange,
  aimRequest,
  layers,
}: SceneProps) {
  const allSatellites = useSkyObjects(tles, observer, displayTime, passes);
  const satellites = layers.satellites ? allSatellites : EMPTY_SATELLITES;

  const lstRad = useMemo(
    () => localSiderealTime(displayTime, observer.longitude),
    [displayTime, observer.longitude]
  );
  const [aimTarget, setAimTarget] = useState<AimTarget | null>(null);
  const autoAimedRef = useRef(false);

  useEffect(() => {
    onCountChange(satellites.length);
  }, [satellites.length, onCountChange]);

  // The highest satellite is the best thing to point a newcomer at.
  const highest = satellites.reduce<(typeof satellites)[number] | null>(
    (best, s) => (!best || s.sample.elevationDeg > best.sample.elevationDeg ? s : best),
    null
  );

  // Aim once when the sky goes from empty to occupied, rather than every tick.
  useEffect(() => {
    if (!highest) {
      autoAimedRef.current = false;
      return;
    }
    if (autoAimedRef.current) return;
    autoAimedRef.current = true;
    setAimTarget({ azimuthDeg: highest.sample.azimuthDeg, elevationDeg: highest.sample.elevationDeg });
  }, [highest]);

  // Explicit "centre the view" requests from the overlay button.
  useEffect(() => {
    if (aimRequest === 0 || !highest) return;
    setAimTarget({ azimuthDeg: highest.sample.azimuthDeg, elevationDeg: highest.sample.elevationDeg });
  }, [aimRequest, highest]);

  const handleSelect = (satnum: string | null) => {
    onSelect(satnum);
    const target = satellites.find((s) => s.satnum === satnum);
    if (target) {
      setAimTarget({ azimuthDeg: target.sample.azimuthDeg, elevationDeg: target.sample.elevationDeg });
    }
  };

  return (
    <>
      <ambientLight intensity={1.1} />
      <directionalLight position={[30, 60, 20]} intensity={2.2} />
      <directionalLight position={[-40, 10, -30]} intensity={0.6} color="#7dd3fc" />

      <DomeShell />

      {(layers.stars || layers.constellations) && (
        <StarLayer
          displayTime={displayTime}
          latitude={observer.latitude}
          lstRad={lstRad}
          showStars={layers.stars}
          showConstellations={layers.constellations}
        />
      )}

      {layers.planets && (
        <PlanetLayer
          displayTime={displayTime}
          observerLatitude={observer.latitude}
          observerLongitude={observer.longitude}
          observerElevation={observer.elevation}
        />
      )}

      {satellites.map((sat) => (
        <SatelliteMarker
          key={sat.satnum}
          sat={sat}
          selected={selected === sat.satnum}
          onSelect={handleSelect}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.4}
        minDistance={CAMERA_DISTANCE}
        maxDistance={CAMERA_DISTANCE}
        minPolarAngle={Math.PI / 2 - 0.35}
        maxPolarAngle={Math.PI - 0.02}
      />
      <FovZoom />
      <CameraAim target={aimTarget} />
      {import.meta.env.DEV && <DevProbe satellites={satellites} />}
    </>
  );
}

interface Props {
  tles: TleRecord[];
  observer: Observer;
  displayTime: Date;
  passes: Pass[];
  loading: boolean;
}

const LAYER_LABELS: Array<{ key: keyof SkyLayers; label: string }> = [
  { key: 'satellites', label: 'Satellites' },
  { key: 'stars', label: 'Stars' },
  { key: 'constellations', label: 'Constellations' },
  { key: 'planets', label: 'Planets' },
];

export function SkyDome({ tles, observer, displayTime, passes, loading }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [aimRequest, setAimRequest] = useState(0);
  const [layers, setLayers] = useState<SkyLayers>({
    satellites: true,
    stars: true,
    constellations: true,
    planets: true,
  });

  const toggleLayer = (key: keyof SkyLayers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="relative w-full h-[clamp(360px,58vh,620px)] rounded-xl overflow-hidden glass-panel">
      {loading ? (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full border-2 border-space-600 border-t-glow-500 animate-spin" />
            <p className="text-sm text-space-300">Loading orbital elements…</p>
          </div>
        </div>
      ) : (
        <Canvas
          camera={{ fov: 60, near: 0.005, far: DOME_RADIUS * 3, position: CAMERA_START }}
          onPointerMissed={() => setSelected(null)}
          dpr={[1, 2]}
        >
          <Suspense fallback={null}>
            <SkyScene
              tles={tles}
              observer={observer}
              displayTime={displayTime}
              passes={passes}
              selected={selected}
              onSelect={setSelected}
              onCountChange={setVisibleCount}
              aimRequest={aimRequest}
              layers={layers}
            />
          </Suspense>
        </Canvas>
      )}

      {/* Overlays */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="glass-panel rounded-lg px-3 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-space-300">Above horizon</div>
            <div className="text-glow-400 font-mono text-sm font-semibold">{visibleCount}</div>
          </div>
          <div className="flex items-center gap-2">
            {visibleCount > 0 && (
              <button
                type="button"
                onClick={() => setAimRequest((n) => n + 1)}
                className="pointer-events-auto text-xs px-2.5 py-1.5 rounded-lg bg-glow-600/15 text-glow-400 border border-glow-600/30 hover:bg-glow-600/25 hover:shadow-[var(--shadow-glow-sm)] transition"
              >
                Centre view
              </button>
            )}
            <div className="glass-panel rounded-lg px-3 py-1.5 text-[10px] text-space-300 text-right leading-relaxed hidden sm:block">
              drag to look around · scroll to zoom
              <br />
              click a satellite for details
            </div>
          </div>
        </div>

        {!loading && layers.satellites && visibleCount === 0 && (
          <div className="self-center glass-panel rounded-lg px-4 py-2.5 text-center max-w-xs">
            <p className="text-sm text-space-200 font-medium">No satellites overhead right now</p>
            <p className="text-xs text-space-300 mt-0.5">
              Scrub or play the timeline below to find the next pass.
            </p>
          </div>
        )}

        {/* Layer toggles */}
        <div className="flex flex-wrap gap-1.5">
          {LAYER_LABELS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleLayer(key)}
              aria-pressed={layers[key]}
              className={`pointer-events-auto text-[11px] px-2.5 py-1 rounded-lg border transition backdrop-blur-md ${
                layers[key]
                  ? 'bg-glow-600/20 text-glow-400 border-glow-600/40'
                  : 'bg-space-900/60 text-space-300 border-space-700 hover:text-space-200 hover:border-space-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
