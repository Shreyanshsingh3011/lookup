import { useMemo, useState } from 'react';
import { Billboard } from '@react-three/drei';
import { DOME_RADIUS, azElToVec3, azToCompass } from '../../lib/sky';
import { aircraftLabel, type AircraftState } from '../../lib/aircraft';
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

/** Only label the more prominent ones, so a busy approach path stays readable. */
const LABEL_ELEVATION_MIN = 12;

/** A small delta-wing glyph, canted to hint at the aircraft's ground track. */
function AircraftGlyph({ trueTrackDeg }: { trueTrackDeg: number | null }) {
  // The glyph is billboarded, so this rotation is in screen space, not world
  // space — it conveys roughly which way the aircraft is heading rather than
  // a survey-accurate bearing. Without a reported track we leave it nose-up
  // instead of inventing a heading.
  const rotation = trueTrackDeg === null ? 0 : -(trueTrackDeg * Math.PI) / 180;

  return (
    <Billboard>
      <group rotation={[0, 0, rotation]}>
        <mesh>
          <coneGeometry args={[1.15, 3.0, 3]} />
          <meshBasicMaterial color={AIRCRAFT_COLOR} toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  );
}

function AircraftMarker({ entry }: { entry: LiveAircraft }) {
  const [hovered, setHovered] = useState(false);
  const { state, sky } = entry;

  const position = useMemo(
    () => azElToVec3(sky.azimuthDeg, sky.elevationDeg, AIRCRAFT_RADIUS),
    [sky.azimuthDeg, sky.elevationDeg]
  );

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

      <AircraftGlyph trueTrackDeg={state.trueTrackDeg} />

      {showLabel && (
        <FrontFacingHtml position={[0, 0, 0]} offsetYPx={hovered ? -60 : -14}>
          {hovered ? <AircraftDetail state={state} entry={entry} /> : (
            <div
              className="text-[10px] font-semibold tracking-wide whitespace-nowrap"
              style={{ color: AIRCRAFT_COLOR }}
            >
              {aircraftLabel(state)}
            </div>
          )}
        </FrontFacingHtml>
      )}
    </group>
  );
}

function AircraftDetail({ state, entry }: { state: AircraftState; entry: LiveAircraft }) {
  return (
    <div className="glass-panel rounded-lg px-3 py-2 min-w-[180px] shadow-[var(--shadow-glow-sm)]">
      <div className="font-semibold text-xs tracking-wide" style={{ color: AIRCRAFT_COLOR }}>
        {aircraftLabel(state)}
      </div>
      {state.originCountry && (
        <div className="text-[10px] text-space-300">{state.originCountry}</div>
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
