import { useMemo } from 'react';
import worldMap from '../data/worldMap.json';
import {
  circleAround,
  footprintRadiusDeg,
  groundTrack,
  orbitalPeriodMinutes,
  splitAtAntimeridian,
  subsolarPoint,
  subSatellitePoint,
  type GroundPoint,
} from '../lib/groundTrack';
import { parseSatrec } from '../lib/sky';
import type { Observer, Pass, TleRecord } from '../types';

const WIDTH = 640;
const HEIGHT = 320;

function project(p: GroundPoint): [number, number] {
  const x = ((p.longitudeDeg + 180) / 360) * WIDTH;
  const y = ((90 - p.latitudeDeg) / 180) * HEIGHT;
  return [x, y];
}

function toPath(points: GroundPoint[], close = false): string {
  if (points.length === 0) return '';
  const body = points
    .map((p, i) => {
      const [x, y] = project(p);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return close ? `${body} Z` : body;
}

/** Static for a given projection, so this is built once rather than per render. */
const LAND_PATH = worldMap.polygons
  .map((ring) => toPath(ring.map(([lon, lat]) => ({ longitudeDeg: lon, latitudeDeg: lat })), true))
  .join(' ');

const GRATICULE_LATS = [-60, -30, 0, 30, 60];
const GRATICULE_LONS = [-180, -120, -60, 0, 60, 120, 180];

interface Props {
  pass: Pass;
  tle: TleRecord;
  observer: Observer;
}

export function GroundTrackMap({ pass, tle, observer }: Props) {
  const satrec = useMemo(() => parseSatrec(tle), [tle]);
  const referenceTime = useMemo(() => new Date(pass.max.time), [pass.max.time]);

  const trackSegments = useMemo(() => {
    if (!satrec) return [];
    const periodMinutes = orbitalPeriodMinutes(tle);
    return splitAtAntimeridian(groundTrack(satrec, referenceTime, periodMinutes, 120));
  }, [satrec, tle, referenceTime]);

  const subPoint = useMemo(() => (satrec ? subSatellitePoint(satrec, referenceTime) : null), [satrec, referenceTime]);

  const footprintSegments = useMemo(() => {
    if (!subPoint) return [];
    return splitAtAntimeridian(circleAround(subPoint, footprintRadiusDeg(subPoint.altitudeKm), 90));
  }, [subPoint]);

  const terminatorSegments = useMemo(
    () => splitAtAntimeridian(circleAround(subsolarPoint(referenceTime), 90, 180)),
    [referenceTime]
  );

  if (!satrec || !subPoint) {
    return (
      <div className="grid place-items-center text-sm text-space-300" style={{ width: WIDTH, height: HEIGHT }}>
        Ground track unavailable for this satellite.
      </div>
    );
  }

  const [obsX, obsY] = project({ latitudeDeg: observer.latitude, longitudeDeg: observer.longitude });
  const [subX, subY] = project(subPoint);

  return (
    <figure className="ground-track-map m-0 w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Ground track for ${pass.name} around its ${pass.max.time} peak, one orbit shown`}
      >
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} className="chart-horizon" fill="none" />

        {/* Graticule */}
        {GRATICULE_LATS.map((lat) => {
          const [, y] = project({ latitudeDeg: lat, longitudeDeg: 0 });
          return (
            <line key={`lat-${lat}`} x1={0} y1={y} x2={WIDTH} y2={y} className={lat === 0 ? 'chart-horizon' : 'chart-grid'} />
          );
        })}
        {GRATICULE_LONS.map((lon) => {
          const [x] = project({ latitudeDeg: 0, longitudeDeg: lon });
          return <line key={`lon-${lon}`} x1={x} y1={0} x2={x} y2={HEIGHT} className="chart-grid" />;
        })}

        {/* Land outlines */}
        <path d={LAND_PATH} className="map-land" fillRule="evenodd" />

        {/* Day/night terminator */}
        {terminatorSegments.map((seg, i) => (
          <path key={`term-${i}`} d={toPath(seg)} fill="none" className="map-terminator" />
        ))}

        {/* Ground track for one orbit around the pass */}
        {trackSegments.map((seg, i) => (
          <path key={`track-${i}`} d={toPath(seg)} fill="none" className="chart-track-visible" />
        ))}

        {/* Instantaneous footprint at the pass's peak */}
        {footprintSegments.map((seg, i) => (
          <path key={`fp-${i}`} d={toPath(seg)} fill="none" className="map-footprint" />
        ))}

        {/* Observer location */}
        <circle cx={obsX} cy={obsY} r={3.5} className="map-observer" />
        <text x={obsX + 6} y={obsY + 3} className="chart-marker-label">
          you
        </text>

        {/* Sub-satellite point at the pass's peak */}
        <circle cx={subX} cy={subY} r={4} className="chart-marker-max" />
      </svg>

      <figcaption className="text-[11px] text-space-300 mt-1.5 leading-relaxed">
        One orbit of ground track centred on this pass's peak (bright line), with the satellite's
        instantaneous horizon-visibility footprint (dashed circle) and the day/night terminator (dotted
        curve) at that moment.
      </figcaption>
    </figure>
  );
}
