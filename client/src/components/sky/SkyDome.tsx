import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import catalog from '../../data/skyCatalog.json';
import { fetchExplanation } from '../../api/client';
import { localSiderealTime, raDecToAzEl } from '../../lib/celestial';
import { DOME_RADIUS } from '../../lib/sky';
import type { BoresightCandidate } from '../../lib/boresight';
import { findBoresightMatch } from '../../lib/boresight';
import type { ExplainResult, ExplainSubject } from '../../lib/explain';
import type { IdentifyCandidate } from '../../lib/identify';
import { toExplainSubject } from '../../lib/identify';
import { useAircraft } from '../../hooks/useAircraft';
import { useCameraStream } from '../../hooks/useCameraStream';
import { useDeviceOrientation } from '../../hooks/useDeviceOrientation';
import { useSkyObjects } from '../../hooks/useSkyObjects';
import { usePlanetPositions } from '../../hooks/usePlanetPositions';
import type { LiveAircraft } from '../../hooks/useAircraft';
import type { LookDirection } from '../../lib/deviceOrientation';
import { AircraftLayer } from './AircraftLayer';
import { CameraAim, type AimTarget } from './CameraAim';
import { OrientationCamera } from './OrientationCamera';
import { DomeShell } from './DomeShell';
import { PlanetLayer } from './PlanetLayer';
import { SatelliteMarker } from './SatelliteMarker';
import { MeteorLayer } from './MeteorLayer';
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
function DevProbe({
  satellites,
  aircraft,
}: {
  satellites: ReturnType<typeof useSkyObjects>;
  aircraft: LiveAircraft[];
}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__sky = { camera, scene, satellites, controls, aircraft };
  }, [camera, scene, satellites, controls, aircraft]);

  return null;
}

export interface SkyLayers {
  satellites: boolean;
  stars: boolean;
  constellations: boolean;
  milkyWay: boolean;
  planets: boolean;
  aircraft: boolean;
  meteors: boolean;
  /** Draw the planets at their real angular size rather than enlarged. */
  trueScale: boolean;
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
  identifyRequest: number;
  onIdentifyMatch: (subject: ExplainSubject | null, requestId: number) => void;
  aircraft: LiveAircraft[];
  orientationLook: LookDirection | null;
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
  identifyRequest,
  onIdentifyMatch,
  aircraft,
  orientationLook,
}: SceneProps) {
  const allSatellites = useSkyObjects(tles, observer, displayTime, passes);
  const satellites = layers.satellites ? allSatellites : EMPTY_SATELLITES;
  const planetPositions = usePlanetPositions(
    displayTime,
    observer.latitude,
    observer.longitude,
    observer.elevation
  );

  const lstRad = useMemo(
    () => localSiderealTime(displayTime, observer.longitude),
    [displayTime, observer.longitude]
  );
  const [aimTarget, setAimTarget] = useState<AimTarget | null>(null);
  const autoAimedRef = useRef(false);
  const camera = useThree((s) => s.camera);
  const prevIdentifyRequestRef = useRef(0);

  // "What am I looking at": search once per button click, matching whatever
  // is centred against every candidate the currently-toggled layers show.
  useEffect(() => {
    if (identifyRequest === 0 || identifyRequest === prevIdentifyRequestRef.current) return;
    prevIdentifyRequestRef.current = identifyRequest;

    const candidates: Array<BoresightCandidate<IdentifyCandidate>> = [];
    for (const sat of satellites) {
      candidates.push({
        azimuthDeg: sat.sample.azimuthDeg,
        elevationDeg: sat.sample.elevationDeg,
        data: { kind: 'satellite', sat },
      });
    }
    if (layers.planets) {
      for (const planet of planetPositions) {
        candidates.push({
          azimuthDeg: planet.azimuthDeg,
          elevationDeg: planet.elevationDeg,
          data: { kind: 'planet', planet },
        });
      }
    }
    if (layers.stars) {
      for (const star of catalog.namedStars) {
        const { azimuthDeg, elevationDeg } = raDecToAzEl(star.ra, star.dec, lstRad, observer.latitude);
        if (elevationDeg < 0) continue;
        candidates.push({ azimuthDeg, elevationDeg, data: { kind: 'star', star, azimuthDeg, elevationDeg } });
      }
    }

    if (layers.aircraft) {
      for (const entry of aircraft) {
        candidates.push({
          azimuthDeg: entry.sky.azimuthDeg,
          elevationDeg: entry.sky.elevationDeg,
          data: { kind: 'aircraft', aircraft: entry.state, sky: entry.sky },
        });
      }
    }

    const match = findBoresightMatch(camera, candidates);
    onIdentifyMatch(match ? toExplainSubject(match.data) : null, identifyRequest);
  }, [
    identifyRequest,
    satellites,
    planetPositions,
    layers.planets,
    layers.stars,
    layers.aircraft,
    aircraft,
    lstRad,
    observer.latitude,
    camera,
    onIdentifyMatch,
  ]);

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

      {(layers.stars || layers.constellations || layers.milkyWay) && (
        <StarLayer
          displayTime={displayTime}
          latitude={observer.latitude}
          lstRad={lstRad}
          showStars={layers.stars}
          showConstellations={layers.constellations}
          showMilkyWay={layers.milkyWay}
        />
      )}

      {layers.meteors && (
        <MeteorLayer displayTime={displayTime} latitude={observer.latitude} lstRad={lstRad} />
      )}

      {layers.planets && (
        <PlanetLayer
          displayTime={displayTime}
          observerLatitude={observer.latitude}
          observerLongitude={observer.longitude}
          observerElevation={observer.elevation}
          scaleMode={layers.trueScale ? 'true' : 'enhanced'}
        />
      )}

      {layers.aircraft && aircraft.length > 0 && <AircraftLayer aircraft={aircraft} />}

      {satellites.map((sat) => (
        <SatelliteMarker
          key={sat.satnum}
          sat={sat}
          tle={tles.find((t) => t.satnum === sat.satnum)}
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
      {orientationLook ? <OrientationCamera look={orientationLook} /> : <CameraAim target={aimTarget} />}
      {import.meta.env.DEV && <DevProbe satellites={satellites} aircraft={aircraft} />}
    </>
  );
}

interface Props {
  tles: TleRecord[];
  observer: Observer;
  displayTime: Date;
  passes: Pass[];
  loading: boolean;
  /**
   * Called with the name of the satellite the user clicked, or null when the
   * selection is cleared. Lets the page react to a click on a specific object
   * — the ISS in particular, which has a live feed to offer.
   */
  onSatelliteSelected?: (name: string | null) => void;
}

const LAYER_LABELS: Array<{ key: keyof SkyLayers; label: string }> = [
  { key: 'satellites', label: 'Satellites' },
  { key: 'stars', label: 'Stars' },
  { key: 'constellations', label: 'Constellations' },
  { key: 'milkyWay', label: 'Milky Way' },
  { key: 'planets', label: 'Planets' },
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'meteors', label: 'Meteors' },
  { key: 'trueScale', label: 'True scale' },
];

type IdentifyStatus = 'idle' | 'searching' | 'no-match' | 'loading' | 'result' | 'error';

export function SkyDome({ tles, observer, displayTime, passes, loading, onSatelliteSelected }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const selectSatellite = useCallback(
    (satnum: string | null) => {
      setSelected(satnum);
      onSatelliteSelected?.(satnum === null ? null : tles.find((t) => t.satnum === satnum)?.name ?? null);
    },
    [onSatelliteSelected, tles]
  );
  const [visibleCount, setVisibleCount] = useState(0);
  const [aimRequest, setAimRequest] = useState(0);
  const [layers, setLayers] = useState<SkyLayers>({
    satellites: true,
    stars: true,
    constellations: true,
    milkyWay: true,
    planets: true,
    aircraft: true,
    meteors: true,
    // Off by default: at true scale a planet is a point of light, which is
    // correct but leaves nothing to look at until you zoom in.
    trueScale: false,
  });

  // Aircraft are live-only: they are where they are now, so they are not tied
  // to the time scrubber the way propagated satellite positions are.
  const aircraftFeed = useAircraft(observer, layers.aircraft);

  // "Point at the sky" mode. Sensors and camera are separate opt-ins: motion
  // control is useful on its own, and the camera passthrough is the heavier
  // ask (a second permission, plus real battery cost).
  const orientation = useDeviceOrientation();
  const camera = useCameraStream();
  const orientationActive = orientation.state === 'active' && orientation.look !== null;

  const toggleSkyMode = () => {
    if (orientation.state === 'idle' || orientation.state === 'denied' || orientation.state === 'no-signal') {
      orientation.enable();
    } else {
      orientation.disable();
      camera.disable();
    }
  };

  const toggleLayer = (key: keyof SkyLayers) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const [identifyRequest, setIdentifyRequest] = useState(0);
  const [identifyStatus, setIdentifyStatus] = useState<IdentifyStatus>('idle');
  const [identifySubject, setIdentifySubject] = useState<ExplainSubject | null>(null);
  const [identifyResult, setIdentifyResult] = useState<ExplainResult | null>(null);
  const [identifyError, setIdentifyError] = useState<string | null>(null);
  const latestIdentifyRequestRef = useRef(0);

  const handleIdentify = () => {
    const id = identifyRequest + 1;
    latestIdentifyRequestRef.current = id;
    setIdentifyStatus('searching');
    setIdentifySubject(null);
    setIdentifyResult(null);
    setIdentifyError(null);
    setIdentifyRequest(id);
  };

  const closeIdentify = () => {
    latestIdentifyRequestRef.current = identifyRequest;
    setIdentifyStatus('idle');
    setIdentifySubject(null);
    setIdentifyResult(null);
    setIdentifyError(null);
  };

  const handleIdentifyMatch = useCallback((subject: ExplainSubject | null, requestId: number) => {
    if (requestId !== latestIdentifyRequestRef.current) return;

    if (!subject) {
      setIdentifyStatus('no-match');
      return;
    }

    setIdentifySubject(subject);
    setIdentifyStatus('loading');
    fetchExplanation(subject)
      .then((result) => {
        if (requestId !== latestIdentifyRequestRef.current) return;
        setIdentifyResult(result);
        setIdentifyStatus('result');
      })
      .catch((err) => {
        if (requestId !== latestIdentifyRequestRef.current) return;
        setIdentifyError(err instanceof Error ? err.message : 'Failed to identify object');
        setIdentifyStatus('error');
      });
  }, []);

  return (
    <div className="relative w-full h-[clamp(360px,58vh,620px)] rounded-xl overflow-hidden glass-panel">
      {/* Live camera passthrough, behind everything. Muted + playsInline so
          mobile browsers will autoplay it without a further gesture. */}
      {camera.state === 'active' && (
        <video
          ref={camera.videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          autoPlay
        />
      )}

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
          onPointerMissed={() => selectSatellite(null)}
          dpr={[1, 2]}
          gl={{ alpha: true }}
          style={camera.state === 'active' ? { background: 'transparent' } : undefined}
        >
          <Suspense fallback={null}>
            <SkyScene
              tles={tles}
              observer={observer}
              displayTime={displayTime}
              passes={passes}
              selected={selected}
              onSelect={selectSatellite}
              onCountChange={setVisibleCount}
              aimRequest={aimRequest}
              layers={layers}
              identifyRequest={identifyRequest}
              onIdentifyMatch={handleIdentifyMatch}
              aircraft={aircraftFeed.aircraft}
              orientationLook={orientationActive ? orientation.look : null}
            />
          </Suspense>
        </Canvas>
      )}

      {!loading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="w-4 h-4 relative opacity-40">
            <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-space-100" />
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-space-100" />
          </div>
        </div>
      )}

      {/* Overlays */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="glass-panel rounded-lg px-3 py-1.5">
            <div className="text-[10px] uppercase tracking-wider text-space-300">Above horizon</div>
            <div className="text-glow-400 font-mono text-sm font-semibold">{visibleCount}</div>
          </div>
          <div className="flex items-center gap-2">
            {!loading && (
              <button
                type="button"
                onClick={toggleSkyMode}
                aria-pressed={orientationActive}
                className={`pointer-events-auto text-xs px-2.5 py-1.5 rounded-lg border transition ${
                  orientationActive
                    ? 'bg-glow-600/25 text-glow-400 border-glow-600/50'
                    : 'bg-glow-600/15 text-glow-400 border-glow-600/30 hover:bg-glow-600/25'
                }`}
              >
                {orientation.state === 'requesting'
                  ? 'Starting…'
                  : orientationActive
                    ? 'Stop pointing'
                    : 'Point at sky'}
              </button>
            )}
            {orientationActive && (
              <button
                type="button"
                onClick={() => (camera.state === 'active' ? camera.disable() : camera.enable())}
                aria-pressed={camera.state === 'active'}
                className={`pointer-events-auto text-xs px-2.5 py-1.5 rounded-lg border transition ${
                  camera.state === 'active'
                    ? 'bg-glow-600/25 text-glow-400 border-glow-600/50'
                    : 'bg-space-900/60 text-space-300 border-space-700 hover:text-space-200'
                }`}
              >
                {camera.state === 'requesting' ? 'Starting…' : 'Camera'}
              </button>
            )}
            {!loading && (
              <button
                type="button"
                onClick={handleIdentify}
                disabled={identifyStatus === 'searching' || identifyStatus === 'loading'}
                className="pointer-events-auto text-xs px-2.5 py-1.5 rounded-lg bg-glow-600/15 text-glow-400 border border-glow-600/30 hover:bg-glow-600/25 hover:shadow-[var(--shadow-glow-sm)] transition disabled:opacity-60"
              >
                {identifyStatus === 'searching' || identifyStatus === 'loading' ? 'Identifying…' : "What am I looking at?"}
              </button>
            )}
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

        {orientationActive && (
          <div className="self-center glass-panel rounded-lg px-3 py-2 text-center max-w-sm">
            <p className="text-xs text-space-200">
              Pointing mode — move your phone to look around.
            </p>
            <p className="text-[11px] text-space-300 mt-0.5">
              {orientation.headingIsRelative
                ? 'No true-north compass on this device, so the bearing is relative — the sky may be rotated.'
                : 'Phone compasses are typically accurate to only about 10-15°, so expect some offset.'}
            </p>
          </div>
        )}

        {(orientation.state === 'denied' ||
          orientation.state === 'unsupported' ||
          orientation.state === 'no-signal') && (
          <div className="self-center glass-panel rounded-lg px-3 py-2 text-center max-w-sm">
            <p className="text-xs text-amber-glow">
              {orientation.state === 'denied'
                ? 'Motion access was declined, so pointing mode is off. You can still drag to look around.'
                : orientation.state === 'unsupported'
                  ? "This browser doesn't expose motion sensors. Drag to look around instead."
                  : 'No motion sensors responded — this is usually a desktop or a device without a compass. Drag to look around instead.'}
            </p>
          </div>
        )}

        {camera.state === 'denied' && camera.error && (
          <div className="self-center glass-panel rounded-lg px-3 py-2 text-center max-w-sm">
            <p className="text-xs text-amber-glow">Camera unavailable: {camera.error}</p>
          </div>
        )}

        {!loading && layers.aircraft && aircraftFeed.status === 'unavailable' && (
          <div
            className="self-center glass-panel rounded-lg px-3 py-2 text-center max-w-sm"
            // The underlying reason is a transport-level error string that
            // means nothing to a stargazer, so it stays in the tooltip for
            // whoever is actually debugging the deployment.
            title={aircraftFeed.error ?? undefined}
          >
            <p className="text-xs text-amber-glow">Live aircraft data isn't available right now.</p>
          </div>
        )}

        {!loading && layers.satellites && visibleCount === 0 && identifyStatus === 'idle' && (
          <div className="self-center glass-panel rounded-lg px-4 py-2.5 text-center max-w-xs">
            <p className="text-sm text-space-200 font-medium">No satellites overhead right now</p>
            <p className="text-xs text-space-300 mt-0.5">
              Scrub or play the timeline below to find the next pass.
            </p>
          </div>
        )}

        {identifyStatus !== 'idle' && (
          <div className="pointer-events-auto self-center glass-panel rounded-lg px-4 py-3 max-w-sm shadow-[var(--shadow-glow-sm)]">
            <div className="flex items-start justify-between gap-3">
              <div className="text-left min-w-0">
                {identifyStatus === 'searching' && (
                  <p className="text-sm text-space-200">Looking for what&apos;s centred…</p>
                )}
                {identifyStatus === 'no-match' && (
                  <>
                    <p className="text-sm text-space-200 font-medium">Nothing identifiable there</p>
                    <p className="text-xs text-space-300 mt-0.5">
                      Centre a satellite, planet, or named star in the view and try again.
                    </p>
                  </>
                )}
                {(identifyStatus === 'loading' || identifyStatus === 'result') && identifySubject && (
                  <>
                    <div className="text-[10px] uppercase tracking-wider text-space-300">
                      {identifySubject.kind}
                    </div>
                    <div className="text-glow-400 font-semibold text-sm">{identifySubject.name}</div>
                    {identifyStatus === 'loading' ? (
                      <p className="text-xs text-space-300 mt-1.5">Thinking…</p>
                    ) : (
                      identifyResult && (
                        <p className="text-xs text-space-200 mt-1.5 leading-relaxed">
                          {identifyResult.explanation}
                        </p>
                      )
                    )}
                  </>
                )}
                {identifyStatus === 'error' && (
                  <>
                    <p className="text-sm text-space-200 font-medium">Couldn&apos;t identify that</p>
                    <p className="text-xs text-space-300 mt-0.5">{identifyError}</p>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={closeIdentify}
                aria-label="Close"
                className="text-space-400 hover:text-space-200 text-xs shrink-0 leading-none"
              >
                ✕
              </button>
            </div>
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
