import { useMemo } from 'react';
import * as THREE from 'three';
import { DOME_RADIUS } from '../../lib/sky';
import { AZIMUTH_BIN_DEG, ELEVATION_BIN_DEG, type DensityBin } from '../../lib/debrisCloudSky';

/**
 * A breakup cloud drawn as a region rather than as objects.
 *
 * The rule this obeys: nothing here may read as something you could see. Each
 * fragment is around magnitude 12, two hundred and fifty times fainter than
 * the naked eye can reach, so a point of light would be a lie however small it
 * was drawn. Patches of shaded sky are not — they say "this much of it is over
 * there", which is exactly what the data supports and no more.
 *
 * The visual grammar is chosen to be unmistakably diagrammatic and to avoid
 * every cue the dome uses for real objects:
 *
 *   - flat translucent patches, never points, and never a glow
 *   - no billboarding, so they sit on the sky rather than facing you
 *   - a violet that appears nowhere else here; teal is a working satellite,
 *     amber is a derelict, and this is neither
 *   - depth writing off and back faces culled, so patches never occlude a
 *     satellite marker or read as solid geometry
 *
 * Positions are real. Every fragment behind these patches was propagated with
 * the same SGP4 as everything else in the view; only the presentation is
 * aggregate.
 */

const REGION_COLOR = '#a78bfa';

/** Patches thin out below this, since a single fragment is not a region. */
const MIN_WEIGHT = 0.12;

/**
 * Opacity is capped low deliberately.
 *
 * The densest patch of the largest cloud should still be a hint over the stars,
 * not a curtain. If this reads as a solid object the whole point is lost.
 */
const MAX_OPACITY = 0.3;

function patchGeometry(bin: DensityBin): THREE.SphereGeometry {
  // Dome convention: azimuth from north through east, elevation from horizon.
  // three.js sphere phi runs from +Z, theta from +Y, so the patch is placed by
  // converting both and taking a segment of exactly one bin's extent.
  const azStart = bin.azimuthDeg - AZIMUTH_BIN_DEG / 2;
  const elStart = bin.elevationDeg - ELEVATION_BIN_DEG / 2;

  const phiStart = THREE.MathUtils.degToRad(90 - azStart - AZIMUTH_BIN_DEG);
  const phiLength = THREE.MathUtils.degToRad(AZIMUTH_BIN_DEG);
  const thetaStart = THREE.MathUtils.degToRad(90 - elStart - ELEVATION_BIN_DEG);
  const thetaLength = THREE.MathUtils.degToRad(ELEVATION_BIN_DEG);

  return new THREE.SphereGeometry(
    DOME_RADIUS * 0.985,
    8,
    4,
    phiStart,
    phiLength,
    thetaStart,
    thetaLength
  );
}

export function DebrisCloudRegion({ bins }: { bins: DensityBin[] }) {
  const patches = useMemo(() => {
    const visible = bins.filter((b) => b.weight >= MIN_WEIGHT);
    return visible.map((bin) => ({
      key: `${bin.azimuthDeg}:${bin.elevationDeg}`,
      geometry: patchGeometry(bin),
      // Square-rooted so a cloud with one very dense bin does not render every
      // other bin invisible. Ordering is preserved; only the contrast changes.
      opacity: Math.sqrt(bin.weight) * MAX_OPACITY,
    }));
  }, [bins]);

  // Geometries are created in the memo above and replaced wholesale whenever
  // the bins change, so three.js disposes the previous set with the removed
  // meshes rather than leaking one per tick.
  if (patches.length === 0) return null;

  return (
    <group>
      {patches.map(({ key, geometry, opacity }) => (
        <mesh key={key} geometry={geometry}>
          <meshBasicMaterial
            color={REGION_COLOR}
            transparent
            opacity={opacity}
            side={THREE.BackSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
