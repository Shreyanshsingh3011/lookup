import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { DOME_RADIUS, azElToVec3, azToCompass } from '../../lib/sky';
import { aircraftLabel, type AircraftState } from '../../lib/aircraft';
import { aircraftAttitude, aircraftGeometry, climbAngle, fastJetGeometry } from '../../lib/aircraftModel';
import {
  airframeFor,
  classifyMilitary,
  describeMilitary,
  type MilitaryClassification,
} from '../../lib/militaryAircraft';
import type { LiveAircraft } from '../../hooks/useAircraft';
import { FrontFacingHtml } from './FrontFacingHtml';

/**
 * Inside the satellite shell — aircraft really are far closer than anything
 * else drawn here, so putting them nearest the viewer keeps the depth order
 * physically honest when a plane crosses in front of a satellite or a star.
 */
const AIRCRAFT_RADIUS = DOME_RADIUS * 0.96;

/**
 * Warm amber, deliberately unlike the teal used for satellites: telling those
 * two apart at a glance is the whole point of this layer.
 */
const AIRCRAFT_COLOR = '#fbbf24';

/**
 * Military traffic gets its own colour, cool against the airliners' amber, so
 * the distinction reads instantly rather than needing a label.
 */
const MILITARY_COLOR = '#7dd3fc';

/** Only label the more prominent ones, so a busy approach path stays readable. */
const LABEL_ELEVATION_MIN = 12;

/**
 * One material for every airframe on screen, and one more for the hovered one.
 * A busy area can put a hundred-plus contacts in the sky; giving each its own
 * material would mean a hundred shader programs for a single appearance.
 */
type MaterialSet = { base: THREE.Material; hovered: THREE.Material };

let sharedMaterials: { civil: MaterialSet; military: MaterialSet } | null = null;

function makeSet(color: string, hoverColor: string, emissive: string, hoverEmissive: string): MaterialSet {
  return {
    base: new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.55,
      emissive: new THREE.Color(emissive),
      emissiveIntensity: 0.8,
    }),
    hovered: new THREE.MeshStandardMaterial({
      color: hoverColor,
      metalness: 0.3,
      roughness: 0.45,
      emissive: new THREE.Color(hoverEmissive),
      emissiveIntensity: 1.1,
    }),
  };
}

function aircraftMaterials() {
  if (!sharedMaterials) {
    sharedMaterials = {
      civil: makeSet(AIRCRAFT_COLOR, '#fde68a', '#3a2500', '#7a5200'),
      military: makeSet(MILITARY_COLOR, '#bae6fd', '#0b2b3d', '#155e75'),
    };
  }
  return sharedMaterials;
}

function AircraftMarker({ entry }: { entry: LiveAircraft }) {
  const [hovered, setHovered] = useState(false);
  const { state, sky } = entry;

  const position = useMemo(
    () => azElToVec3(sky.azimuthDeg, sky.elevationDeg, AIRCRAFT_RADIUS),
    [sky.azimuthDeg, sky.elevationDeg]
  );

  // Without a reported track there is no attitude to draw, so the model is
  // replaced by a neutral marker rather than pointing the nose somewhere
  // invented.
  const quaternion = useMemo(
    () =>
      state.trueTrackDeg === null
        ? null
        : aircraftAttitude(state.trueTrackDeg, climbAngle(state.verticalRateMS, state.velocityMS)),
    [state.trueTrackDeg, state.verticalRateMS, state.velocityMS]
  );

  const military = useMemo(() => classifyMilitary(state), [state]);
  const materials = military.military ? aircraftMaterials().military : aircraftMaterials().civil;
  const color = military.military ? MILITARY_COLOR : AIRCRAFT_COLOR;
  // Shape comes from the aircraft's own emitter category, never from the
  // military classification: a tanker and a fighter share an address block.
  const geometry = airframeFor(state) === 'fast-jet' ? fastJetGeometry() : aircraftGeometry();

  const showLabel = hovered || sky.elevationDeg >= LABEL_ELEVATION_MIN;

  return (
    <group position={position}>
      {/* Generous invisible hit target — the glyph is only a few pixels across. */}
      <mesh
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <sphereGeometry args={[5, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* dispose={null}: the geometry and materials are shared by every
          aircraft, and contacts unmount constantly as they leave the sky or
          drop out of the feed. Letting R3F free them with the first departure
          would take every other aircraft down with it. */}
      {quaternion ? (
        <mesh
          geometry={geometry}
          material={hovered ? materials.hovered : materials.base}
          quaternion={quaternion}
          scale={hovered ? 1.3 : 1}
          dispose={null}
        />
      ) : (
        <mesh material={hovered ? materials.hovered : materials.base} dispose={null}>
          <octahedronGeometry args={[1.1]} />
        </mesh>
      )}

      {showLabel && (
        <FrontFacingHtml position={[0, 0, 0]} offsetYPx={hovered ? -60 : -14}>
          {hovered ? <AircraftDetail state={state} entry={entry} military={military} /> : (
            <div
              className="text-[10px] font-semibold tracking-wide whitespace-nowrap"
              style={{ color }}
            >
              {aircraftLabel(state)}
            </div>
          )}
        </FrontFacingHtml>
      )}
    </group>
  );
}

function AircraftDetail({
  state,
  entry,
  military,
}: {
  state: AircraftState;
  entry: LiveAircraft;
  military: MilitaryClassification;
}) {
  const basis = describeMilitary(military);
  return (
    <div className="glass-panel rounded-lg px-3 py-2 min-w-[180px] shadow-[var(--shadow-glow-sm)]">
      <div
        className="font-semibold text-xs tracking-wide"
        style={{ color: military.military ? MILITARY_COLOR : AIRCRAFT_COLOR }}
      >
        {aircraftLabel(state)}
      </div>
      {state.originCountry && (
        <div className="text-[10px] text-space-300">{state.originCountry}</div>
      )}
      {basis && (
        // Said as evidence rather than as a verdict: the allocation tables are
        // a strong hint, not a registry.
        <div className="text-[10px] mt-0.5" style={{ color: MILITARY_COLOR }}>
          Likely military · {basis}
        </div>
      )}
      {airframeFor(state) === 'fast-jet' && (
        <div className="text-[10px] text-space-300">Broadcasts as a high-performance airframe</div>
      )}
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <dt className="text-space-300">Altitude</dt>
        <dd className="font-mono text-space-100">{Math.round(state.altitudeM).toLocaleString()} m</dd>
        <dt className="text-space-300">Position</dt>
        <dd className="font-mono text-space-100">
          {entry.sky.elevationDeg.toFixed(0)}° {azToCompass(entry.sky.azimuthDeg)}
        </dd>
        <dt className="text-space-300">Distance</dt>
        <dd className="font-mono text-space-100">{entry.sky.rangeKm.toFixed(0)} km</dd>
        {state.velocityMS !== null && (
          <>
            <dt className="text-space-300">Speed</dt>
            <dd className="font-mono text-space-100">{Math.round(state.velocityMS * 3.6)} km/h</dd>
          </>
        )}
        {state.verticalRateMS !== null && Math.abs(state.verticalRateMS) > 0.5 && (
          <>
            <dt className="text-space-300">Climb</dt>
            <dd className="font-mono text-space-100">
              {state.verticalRateMS > 0 ? '+' : ''}
              {Math.round(state.verticalRateMS * 60)} m/min
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function AircraftLayer({ aircraft }: { aircraft: LiveAircraft[] }) {
  return (
    <>
      {aircraft.map((entry) => (
        <AircraftMarker key={entry.state.icao24} entry={entry} />
      ))}
    </>
  );
}
