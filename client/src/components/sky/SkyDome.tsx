import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import catalog from '../../data/skyCatalog.json';
import { fetchExplanation } from '../../api/client';
import { localSiderealTime, precessRaDec, raDecToAzEl } from '../../lib/celestial';
import { DOME_RADIUS } from '../../lib/sky';
import {
  excludeDrawnAsMarkers,
  isDerelictByName,
  nextDerelictRise,
  preFilter,
} from '../../lib/debris';
import type { CloudSkyDensity, DensityBin } from '../../lib/debrisCloudSky';
import { FRAGMENT_TYPICAL_MAGNITUDE, timesFainterThanEye } from '../../lib/debrisCloudSky';
import type { BoresightCandidate } from '../../lib/boresight';
import { findBoresightMatch } from '../../lib/boresight';
import type { ExplainResult, ExplainSubject } from '../../lib/explain';
import type { IdentifyCandidate } from '../../lib/identify';
import { toExplainSubject } from '../../lib/identify';
import { useAircraft } from '../../hooks/useAircraft';
import { useCameraStream } from '../../hooks/useCameraStream';
import { useDeviceOrientation } from '../../hooks/useDeviceOrientation';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
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
import { DebrisCloudRegion } from './DebrisCloudRegion';
import { DebrisField } from './DebrisField';
import { MeteorLayer } from './MeteorLayer';
import { StarLayer } from './StarLayer';
import type { Observer, Pass, SatcatEntry, TleRecord } from '../../types';
import type { FieldSource } from '../../hooks/useCatalogueField';

/** Stable empty array, so toggling the layer off doesn't churn memoisation. */
const EMPTY_SATELLITES: ReturnType<typeof useSkyObjects> = [];
/** Derelicts have no upcoming-pass list to match against. */
const EMPTY_PASSES: Pass[] = [];
const EMPTY_TLES: TleRecord[] = [];
const EMPTY_NOTES: Map<string, string> = new Map();
const EMPTY_SATCAT: Map<string, SatcatEntry> = new Map();
const EMPTY_BINS: DensityBin[] = [];

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
 * Zoom sets level of detail, and never hides anything.
 *
 * Wide open is the overview: everything the enabled layers hold is drawn, so one
 * glance shows the whole population — actives, derelicts and the shaded breakup
 * regions together. Nothing is withheld at any zoom, because a view that
 * quietly omits objects is the one thing this dome must not be.
 *
 * Zoomed in is for picking out a particular object. Names appear on whatever is
 * in frame without having to hover each one, which is only affordable because a
 * narrow field holds few objects and the label overlay mounts nothing for
 * anchors outside the viewport. At wide field the same labels would be hundreds
 * of DOM nodes under an unreadable pile of text.
 *
 * The threshold sits nearer the wide end than the middle, so labels arrive on a
 * deliberate zoom rather than an accidental scroll.
 */
const LABEL_FOV_DEG = 50;

/**
 * Publishes whether the view is magnified, and nothing else.
 *
 * Deliberately a boolean rather than the field of view itself. Fov changes on
 * every wheel event and every frame of damping; lifting that into React state
 * would re-render the whole scene continuously. A boolean changes twice per
 * gesture at most.
 */
function ZoomWatch({ onChange }: { onChange: (labelled: boolean) => void }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const last = useRef<boolean | null>(null);

  useFrame(() => {
    const labelled = camera.fov <= LABEL_FOV_DEG;
    if (last.current !== labelled) {
      last.current = labelled;
      onChange(labelled);
    }
  });

  return null;
}

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
  debris,
  aircraft,
}: {
  satellites: ReturnType<typeof useSkyObjects>;
  /** Exposed too, or a derelict's position cannot be checked from outside. */
  debris: ReturnType<typeof useSkyObjects>;
  aircraft: LiveAircraft[];
}) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__sky = { camera, scene, satellites, debris, controls, aircraft };
  }, [camera, scene, satellites, debris, controls, aircraft]);

  return null;
}

export interface SkyLayers {
  satellites: boolean;
  debris: boolean;
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
  /** Derelict element sets, already pre-filtered for this observer. */
  debrisTles: TleRecord[];
  /** Catalogue notes, keyed by NORAD id, for the tapped detail panel. */
  debrisNotes: Map<string, string>;
  onLogSighting?: (subject: string, satnum: string | null) => void;
  /** How many derelicts are actually above the horizon, which is often none. */
  onDebrisCountChange: (count: number) => void;
  /** Catalogue metadata, empty when SATCAT could not be reached. */
  satcat: Map<string, SatcatEntry>;
  /** Binned fragment density for a loaded breakup cloud, drawn as a region. */
  cloudBins: DensityBin[];
  /** True once the field of view is narrow enough to label what is in frame. */
  labelled: boolean;
  onLabelledChange: (labelled: boolean) => void;
  /**
   * Every catalogued debris fragment still in orbit, drawn as a point field.
   *
   * Kept separate from `debrisTles` because they are drawn by different
   * machinery for a reason: a handful of objects deserve models, trails and hit
   * targets, and twelve thousand cannot have them. Disjoint from it too —
   * fragments here, spent stages and dead payloads there.
   */
  fieldTles: TleRecord[];
  fieldRcs?: Map<string, string>;
  onFieldChange: (info: { tracked: number; visible: number }) => void;
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
  debrisTles,
  debrisNotes,
  onLogSighting,
  onDebrisCountChange,
  satcat,
  cloudBins,
  labelled,
  onLabelledChange,
  fieldTles,
  fieldRcs,
  onFieldChange,
}: SceneProps) {
  // Damping is the part of this scene that reads as motion sickness rather than
  // as polish: the sky keeps turning after the hand has stopped. Off when the
  // viewer has asked the system for less motion, so a drag ends where it is
  // released. The CSS half of the preference cannot reach inside the canvas.
  const reducedMotion = usePrefersReducedMotion();
  const allSatellites = useSkyObjects(tles, observer, displayTime, passes, 'active', satcat);
  const satellites = layers.satellites ? allSatellites : EMPTY_SATELLITES;

  // Propagated by the same hook, tagged so the marker can draw them apart. The
  // list arrives already cut down by the coarse reach filter, which matters
  // here far more than in the static pass table: this runs on every tick.
  // Deduplicated against the satellite groups first. Six of the eight curated
  // derelicts are also in CelesTrak's "visual" group, which is a default here
  // — so without this they are propagated and drawn twice, one marker exactly
  // on top of the other. They are already correctly drawn as derelicts over
  // there, since kind is decided per object rather than per layer.
  const extraDebrisTles = useMemo(() => {
    if (!layers.satellites) return debrisTles;
    const already = new Set(tles.map((t) => t.satnum));
    return debrisTles.filter((t) => !already.has(t.satnum));
  }, [debrisTles, tles, layers.satellites]);

  const allDebris = useSkyObjects(extraDebrisTles, observer, displayTime, EMPTY_PASSES, 'derelict', satcat);
  const debris = layers.debris ? allDebris : EMPTY_SATELLITES;

  // The bulk catalogue. Propagation and boresight selection both happen inside
  // DebrisField's own frame loop — see the note there on why none of it travels
  // through React state.
  const [promoted, setPromoted] = useState<string[]>([]);
  const onPromoted = useCallback((ids: string[]) => setPromoted(ids), []);
  const onFieldCount = useCallback(
    (visible: number, tracked: number) => onFieldChange({ tracked, visible }),
    [onFieldChange]
  );

  // Nothing in the field that is already drawn as a marker. See the note on
  // excludeDrawnAsMarkers for why this is not left to the upstream query.
  const fieldOnlyTles = useMemo(
    () =>
      fieldTles.length === 0
        ? EMPTY_TLES
        : excludeDrawnAsMarkers(fieldTles, layers.satellites ? [debrisTles, tles] : [debrisTles]),
    [fieldTles, debrisTles, tles, layers.satellites]
  );

  const promotedTles = useMemo(() => {
    if (promoted.length === 0) return EMPTY_TLES;
    const wanted = new Set(promoted);
    return fieldOnlyTles.filter((t) => wanted.has(t.satnum));
  }, [promoted, fieldOnlyTles]);

  const promotedObjects = useSkyObjects(
    promotedTles,
    observer,
    displayTime,
    EMPTY_PASSES,
    'derelict',
    satcat
  );
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
    // Derelicts are candidates on the same footing. Pointing the phone at
    // something and being told "nothing there" because the thing overhead
    // happens to be dead would be the wrong answer to the question asked.
    for (const sat of debris) {
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
        // Precessed to match where the star field actually draws it. Without
        // this, "what am I looking at" would answer from J2000 positions while
        // the dome drew the epoch-of-date ones.
        const p = precessRaDec(star.ra, star.dec, displayTime);
        const { azimuthDeg, elevationDeg } = raDecToAzEl(p.raDeg, p.decDeg, lstRad, observer.latitude);
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
    // Stars are precessed to this instant, so a stale value would identify
    // against positions the dome is no longer drawing.
    displayTime,
    satellites,
    debris,
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

  // Derelicts anywhere in the sky, not just the ones the debris layer added.
  // Most of them arrive through the satellite groups — the brightest-objects
  // group is 60% spent rocket bodies — so counting only the extra layer would
  // report "none" while a dozen were on screen.
  const derelictsUp = useMemo(
    () => satellites.filter((s) => s.kind === 'derelict').length + debris.length,
    [satellites, debris.length]
  );

  useEffect(() => {
    onDebrisCountChange(derelictsUp);
  }, [derelictsUp, onDebrisCountChange]);

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
          labelled={labelled}
          selected={selected === sat.satnum}
          onSelect={handleSelect}
        />
      ))}

      {/* Drawn before the markers so it can never sit in front of one. */}
      {layers.debris && cloudBins.length > 0 && <DebrisCloudRegion bins={cloudBins} />}

      {/* Everything, as data. Drawn before the markers so it never sits in
          front of one. */}
      {layers.debris && (
        <DebrisField
          tles={fieldOnlyTles}
          rcsBySatnum={fieldRcs}
          observer={observer}
          displayTime={displayTime}
          labelled={labelled}
          onCountChange={onFieldCount}
          onPromotedChange={onPromoted}
        />
      )}

      {/* And the few you are actually pointing at, as objects. */}
      {promotedObjects.map((sat) => (
        <SatelliteMarker
          key={`promoted-${sat.satnum}`}
          sat={sat}
          tle={promotedTles.find((t) => t.satnum === sat.satnum)}
          labelled={labelled}
          selected={selected === sat.satnum}
          onSelect={handleSelect}
          note={debrisNotes.get(sat.satnum)}
          onLogSighting={onLogSighting}
        />
      ))}

      {debris.map((sat) => (
        <SatelliteMarker
          key={`debris-${sat.satnum}`}
          sat={sat}
          tle={extraDebrisTles.find((t) => t.satnum === sat.satnum)}
          labelled={labelled}
          selected={selected === sat.satnum}
          onSelect={handleSelect}
          note={debrisNotes.get(sat.satnum)}
          onLogSighting={onLogSighting}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enablePan={false}
        enableZoom={false}
        enableDamping={!reducedMotion}
        dampingFactor={0.08}
        rotateSpeed={0.4}
        minDistance={CAMERA_DISTANCE}
        maxDistance={CAMERA_DISTANCE}
        minPolarAngle={Math.PI / 2 - 0.35}
        maxPolarAngle={Math.PI - 0.02}
      />
      <FovZoom />
      <ZoomWatch onChange={onLabelledChange} />
      {orientationLook ? <OrientationCamera look={orientationLook} /> : <CameraAim target={aimTarget} />}
      {import.meta.env.DEV && <DevProbe satellites={satellites} debris={debris} aircraft={aircraft} />}
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
  /**
   * Derelict element sets for the debris layer, already pre-filtered for this
   * observer by `useDebrisSky`. Empty until the layer is switched on.
   */
  debrisTles?: TleRecord[];
  /** Catalogue notes keyed by NORAD id, shown when a derelict is tapped. */
  debrisNotes?: Map<string, string>;
  /**
   * The debris layer is the one controlled layer: the Debris tab can send you
   * here with it already on, so the page owns the flag and the dome asks for
   * changes rather than keeping its own copy.
   */
  debrisEnabled?: boolean;
  onDebrisLayerChange?: (enabled: boolean) => void;
  debrisLoading?: boolean;
  debrisError?: string | null;
  /** Rejected by the coarse reach filter — they can never rise here. */
  debrisUnreachable?: number;
  onLogSighting?: (subject: string, satnum: string | null) => void;
  /** Move the time scrubber, so "nothing up now" can offer a way to see it. */
  onGoToTime?: (time: Date) => void;
  /** Catalogue metadata for the drawn groups. Empty means fall back to names. */
  satcat?: Map<string, SatcatEntry>;
  /** A loaded breakup cloud's density field, with the label to describe it. */
  cloudRegion?: { label: string; density: CloudSkyDensity } | null;
  /**
   * The whole tracked non-active catalogue, for the bulk point field.
   *
   * Everything here is drawn when the debris layer is on. Zooming in promotes
   * whatever you point at into a full marker.
   */
  fieldTles?: TleRecord[];
  /** Declared RCS size class per catalogue number, when Space-Track supplied it. */
  fieldRcs?: Map<string, string>;
  fieldLoading?: boolean;
  /** Why the bulk field is empty, when it is. Stated, never swallowed. */
  fieldError?: string | null;
  /** The server has no Space-Track credentials, so the full catalogue is out of reach. */
  fieldUnconfigured?: boolean;
  /** Which source the field came from. Changes what the status line may claim. */
  fieldSource?: FieldSource;
  /** Only some of the CelesTrak clouds answered. */
  fieldPartial?: boolean;
}

const LAYER_LABELS: Array<{ key: keyof SkyLayers; label: string }> = [
  { key: 'satellites', label: 'Satellites' },
  { key: 'debris', label: 'Debris' },
  { key: 'stars', label: 'Stars' },
  { key: 'constellations', label: 'Constellations' },
  { key: 'milkyWay', label: 'Milky Way' },
  { key: 'planets', label: 'Planets' },
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'meteors', label: 'Meteors' },
  { key: 'trueScale', label: 'True scale' },
];

type IdentifyStatus = 'idle' | 'searching' | 'no-match' | 'loading' | 'result' | 'error';

function describeWait(minutes: number): string {
  if (minutes < 1) return 'about to rise';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = minutes / 60;
  return `in ${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
}

export function SkyDome({
  tles,
  observer,
  displayTime,
  passes,
  loading,
  onSatelliteSelected,
  debrisTles = EMPTY_TLES,
  debrisNotes = EMPTY_NOTES,
  debrisEnabled = false,
  onDebrisLayerChange,
  onLogSighting,
  onGoToTime,
  satcat = EMPTY_SATCAT,
  cloudRegion = null,
  fieldTles = EMPTY_TLES,
  fieldRcs,
  fieldLoading = false,
  fieldError = null,
  fieldUnconfigured = false,
  fieldSource = 'none',
  fieldPartial = false,
  debrisLoading = false,
  debrisError = null,
  debrisUnreachable = 0,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  const selectSatellite = useCallback(
    (satnum: string | null) => {
      setSelected(satnum);
      // Derelicts are searched too: a tap in the dome should name the object
      // whichever layer it came from.
      const found =
        tles.find((t) => t.satnum === satnum) ?? debrisTles.find((t) => t.satnum === satnum);
      onSatelliteSelected?.(satnum === null ? null : found?.name ?? null);
    },
    [onSatelliteSelected, tles, debrisTles]
  );
  const [visibleCount, setVisibleCount] = useState(0);
  const [debrisCount, setDebrisCount] = useState(0);
  // Zoom level, as a single boolean. See LABEL_FOV_DEG.
  const [labelled, setLabelled] = useState(false);
  const [fieldInfo, setFieldInfo] = useState({ tracked: 0, visible: 0 });
  const onFieldChange = useCallback(
    (info: { tracked: number; visible: number }) => setFieldInfo(info),
    []
  );
  const [aimRequest, setAimRequest] = useState(0);
  const [layerState, setLayerState] = useState<SkyLayers>({
    satellites: true,
    // Placeholder only — the live value comes from the `debrisEnabled` prop
    // just below. Off by default there: not because it is expensive, the
    // shortlist is a couple of dozen objects, but because it costs a catalogue
    // fetch the first paint does not otherwise need.
    debris: false,
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

  const layers = useMemo<SkyLayers>(
    () => ({ ...layerState, debris: debrisEnabled }),
    [layerState, debrisEnabled]
  );

  // Only searched when there is nothing to see, and bucketed to the minute so
  // it does not re-run on every tick of the clock. A few thousand SGP4 steps
  // is milliseconds, but it is pointless work while something is already up.
  const riseSearchFrom = useMemo(
    () => new Date(Math.floor(displayTime.getTime() / 60_000) * 60_000),
    [displayTime]
  );
  // Every derelict the dome could draw, from either source and deduplicated —
  // the curated shortlist plus every spent stage in the chosen groups, which
  // is where the great majority of them actually come from.
  const allDerelictTles = useMemo(() => {
    const seen = new Set<string>();
    const out: TleRecord[] = [];
    for (const t of tles) {
      if (isDerelictByName(t.name) && !seen.has(t.satnum)) {
        seen.add(t.satnum);
        out.push(t);
      }
    }
    for (const t of debrisTles) {
      if (!seen.has(t.satnum)) {
        seen.add(t.satnum);
        out.push(t);
      }
    }
    // Coarse reach filter before anything is propagated. The curated shortlist
    // arrives filtered already, but the spent stages pulled out of the
    // satellite groups do not, and they are the bulk of this list.
    //
    // This is not a micro-optimisation. The next-rise search below steps every
    // object forward a minute at a time for a day, and an object that can
    // never rise here is the expensive case: it never matches, so it never
    // exits early, and it costs the full day's scan every time. Measured with
    // 93 stages: 47 ms typical and 381 ms when nothing can rise, against a
    // search that reruns every minute the sky is empty. The filter settles it
    // from two numbers in the element set, with no propagation at all.
    return preFilter(out, observer).candidates;
  }, [tles, debrisTles, observer]);

  /**
   * How many derelicts the selected satellite groups contributed.
   *
   * The layer's coverage silently depends on a setting that has nothing to do
   * with it. With CelesTrak's "visual" group selected the groups supply about
   * ninety spent stages; deselect it and the count falls to the eight curated
   * ones, with the status line still explaining where group-derived stages come
   * from as though they were there. Knowing the split lets it say which case the
   * reader is actually looking at, and what to do about it.
   */
  const derelictsFromGroups = useMemo(
    () => tles.filter((t) => isDerelictByName(t.name)).length,
    [tles]
  );

  const nextRise = useMemo(() => {
    if (!debrisEnabled || debrisCount > 0 || allDerelictTles.length === 0) return null;
    return nextDerelictRise(allDerelictTles, observer, riseSearchFrom);
  }, [debrisEnabled, debrisCount, allDerelictTles, observer, riseSearchFrom]);

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

  const toggleLayer = (key: keyof SkyLayers) => {
    // Debris is owned by the page: the catalogue is fetched there, and the
    // Debris tab can arrive with the layer already on.
    if (key === 'debris') {
      onDebrisLayerChange?.(!debrisEnabled);
      return;
    }
    setLayerState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
    <>
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
              debrisTles={debrisTles}
              debrisNotes={debrisNotes}
              onLogSighting={onLogSighting}
              onDebrisCountChange={setDebrisCount}
              satcat={satcat}
              cloudBins={cloudRegion?.density.bins ?? EMPTY_BINS}
              labelled={labelled}
              onLabelledChange={setLabelled}
              fieldTles={fieldTles}
              fieldRcs={fieldRcs}
              onFieldChange={onFieldChange}
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
              {/* Says which half of the zoom range you are in, so the labels
                  appearing reads as a feature rather than a glitch. */}
              {labelled ? (
                <span className="text-glow-400">zoomed in · everything in frame is named</span>
              ) : (
                <span>zoom in to name what you see</span>
              )}
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

      {/* Below the dome, not over it.

          These lines are prose and they grow: the cloud sentence alone runs to
          four lines. Inside the overlay they covered the bottom third of the
          sky and pushed the layer buttons into the middle of it, where they
          also swallowed drags meant for the view — a sweep written to find a
          shaded patch never moved the camera once, because every drag started
          on a button. None of this is a heads-up display; it is explanation,
          and explanation belongs beside the picture rather than on top of it. */}
      <div className="mt-2 flex flex-col gap-1.5">
      {/* The bulk field, stated because it is the claim most in need of
          qualifying. Twelve thousand points on a sky dome look like a sky full
          of things to see, and not one of them is: at roughly magnitude 12 a
          fragment is some 250 times fainter than the naked eye reaches. These
          are catalogued positions plotted as data, and saying so is what makes
          drawing them defensible. */}
      {/* An empty field states why it is empty.

          This line used to render only when it had objects, which meant the one
          case that most needed explaining — no data at all — showed nothing,
          indistinguishable from a sky that genuinely has no debris in it. In
          production it is currently the *only* case: the server has no
          Space-Track credentials, so the field is empty every time and said so
          nowhere. The rest of this app reports "unavailable" with a reason, and
          the largest layer in it was the one place that did not. */}
      {layers.debris && fieldInfo.tracked === 0 && (
        <p className="text-[11px] leading-snug max-w-md text-space-400">
          {fieldLoading ? (
            'Loading the debris catalogue…'
          ) : fieldError ? (
            <>
              <span className="text-amber-glow">Debris catalogue unavailable</span> — {fieldError}{' '}
              {fieldUnconfigured &&
                'Space-Track needs SPACETRACK_USER and SPACETRACK_PASS on the server; CelesTrak needs nothing but did not answer either. '}
              The amber derelicts below are unaffected.
            </>
          ) : null}
        </p>
      )}

      {layers.debris && fieldInfo.tracked > 0 && (
        <p className="text-[11px] leading-snug max-w-md">
          <span style={{ color: '#8b7fd4' }}>
            {fieldInfo.visible.toLocaleString()} of {fieldInfo.tracked.toLocaleString()} tracked
            debris fragments above your horizon
          </span>
          <span className="text-space-400">
            {' '}
            {fieldSource === 'celestrak' ? (
              <>
                — fragments from the four tracked breakup events, via CelesTrak
                {fieldPartial && ' (some clouds did not answer)'}. Not the whole catalogue: the
                ~17,000 non-active objects in orbit are only available from Space-Track, which
                needs an account, and this server has no credentials set. Adding SPACETRACK_USER
                and SPACETRACK_PASS plots all of them.
              </>
            ) : (
              <>
                — every catalogued fragment still in orbit, plotted as points. Fragments only:
                spent stages and dead payloads are the amber count below, and no object is in both.
              </>
            )}{' '}
            None of this is visible to the eye; at magnitude {FRAGMENT_TYPICAL_MAGNITUDE} a fragment
            is about {Math.round(timesFainterThanEye())} times fainter than the naked-eye limit.
            Positions are real and propagated exactly the way everything else here is. Zoom in to
            name whatever you point at.
          </span>
        </p>
      )}

      {/* A loaded breakup cloud, stated separately from the derelicts because
          it is a different kind of claim: those are objects you could go and
          look at, this is a shaded region marking where fragments are that
          nobody can see. Conflating the two would undo the distinction the
          whole layer exists to draw. */}
      {layers.debris && cloudRegion && (
        <p className="text-[11px] leading-snug max-w-md">
          <span style={{ color: '#a78bfa' }}>
            {cloudRegion.label}: {cloudRegion.density.aboveHorizon.toLocaleString()} of{' '}
            {cloudRegion.density.total.toLocaleString()} fragments above your horizon
          </span>
          <span className="text-space-400">
            {' '}
            — shaded where they are, not drawn as objects. At roughly magnitude{' '}
            {FRAGMENT_TYPICAL_MAGNITUDE} a fragment is about{' '}
            {Math.round(timesFainterThanEye())} times fainter than the naked eye can reach, so
            none of this is visible. Positions are real; only the presentation is aggregate.
            {cloudRegion.density.unreadable > 0 &&
              ` ${cloudRegion.density.unreadable} element set${
                cloudRegion.density.unreadable === 1 ? '' : 's'
              } would not propagate.`}
          </span>
        </p>
      )}

      {/* What the debris layer is actually showing, and what it is not. The
          layer is a curated shortlist rather than the whole catalogue, and
          silently drawing a dozen points would misrepresent that. */}
      {layers.debris && (
        <p className="text-[11px] text-space-400 leading-snug max-w-md">
          {debrisError ? (
            <span className="text-amber-glow">Debris catalogue unavailable — {debrisError}</span>
          ) : debrisLoading ? (
            'Loading derelicts…'
          ) : debrisCount > 0 ? (
            <>
              <span className="text-amber-glow">
                {debrisCount} of {allDerelictTles.length} tracked derelicts above the horizon
              </span>{' '}
              — drawn in amber.{' '}
              {derelictsFromGroups > 0 ? (
                <>
                  Spent rocket bodies count as derelict whichever group they arrived in;{' '}
                  {derelictsFromGroups} of these came from the satellite groups you have selected,
                  the rest from a curated shortlist.
                </>
              ) : (
                <>
                  These are the curated shortlist only — no derelicts came from the satellite
                  groups currently loaded. Selecting the brightest-objects group brings in about
                  ninety more, since most of that group is spent stages.
                </>
              )}
            </>
          ) : (
            <>
              <span className="text-space-300">
                None of the {allDerelictTles.length} tracked derelicts
              </span>{' '}
              are above the horizon right now.{' '}
              {nextRise ? (
                <>
                  Next is {nextRise.name} at{' '}
                  {nextRise.time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })},{' '}
                  {describeWait(nextRise.minutesAway)}.
                  {onGoToTime && (
                    <button
                      type="button"
                      onClick={() => onGoToTime(nextRise.time)}
                      className="pointer-events-auto ml-1.5 underline underline-offset-2 text-glow-400 hover:text-glow-300"
                    >
                      Jump to it
                    </button>
                  )}
                </>
              ) : (
                'None rises in the next 24 hours from here.'
              )}
              {debrisUnreachable > 0 &&
                ` ${debrisUnreachable} more can never rise at this latitude at all.`}
            </>
          )}
        </p>
      )}
      </div>
    </>
  );
}
