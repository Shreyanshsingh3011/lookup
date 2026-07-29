import { useMemo } from 'react';
import { splitByVisibility, type TrackPoint } from '../lib/passTrack';
import type { Pass } from '../types';

const SIZE = 340;
const CENTER = SIZE / 2;
/** Leaves room for the cardinal labels outside the horizon circle. */
const RADIUS = CENTER - 26;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Project horizontal coordinates onto the chart.
 *
 * Zenith at the centre, horizon at the rim, radius linear in elevation. North
 * is up and **east is to the left**: this is the looking-up convention, so the
 * chart matches the sky when you hold it overhead with the top pointing north.
 * (A map of the ground would mirror it; all four cardinals are labelled so
 * there is no ambiguity either way.)
 */
function project(azimuthDeg: number, elevationDeg: number): [number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const r = ((90 - Math.max(0, Math.min(90, elevationDeg))) / 90) * RADIUS;
  return [CENTER - r * Math.sin(az), CENTER - r * Math.cos(az)];
}

function toPath(points: TrackPoint[]): string {
  return points
    .map((p, i) => {
      const [x, y] = project(p.azimuthDeg, p.elevationDeg);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

const CARDINALS = [
  { az: 0, label: 'N' },
  { az: 45, label: 'NE' },
  { az: 90, label: 'E' },
  { az: 135, label: 'SE' },
  { az: 180, label: 'S' },
  { az: 225, label: 'SW' },
  { az: 270, label: 'W' },
  { az: 315, label: 'NW' },
];

interface Props {
  pass: Pass;
  track: TrackPoint[];
}

export function PolarSkyChart({ pass, track }: Props) {
  const runs = useMemo(() => splitByVisibility(track), [track]);

  const markers = useMemo(() => {
    if (track.length === 0) return [];

    const nearest = (iso: string) => {
      const target = new Date(iso).getTime();
      return track.reduce((best, p) =>
        Math.abs(p.time.getTime() - target) < Math.abs(best.time.getTime() - target) ? p : best
      );
    };

    const items = [
      { key: 'start', label: 'Start', point: nearest(pass.start.time), event: pass.start },
      { key: 'max', label: 'Max', point: nearest(pass.max.time), event: pass.max },
      { key: 'end', label: 'End', point: nearest(pass.end.time), event: pass.end },
    ];
    return items;
  }, [track, pass]);

  if (track.length < 2) {
    return (
      <div
        className="grid place-items-center text-sm text-space-300"
        style={{ width: SIZE, height: SIZE }}
      >
        Track unavailable for this pass.
      </div>
    );
  }

  return (
    // Capped to the chart's own width: the container is shrink-0, so an
    // unconstrained caption would set its max-content width and squeeze the
    // sibling column.
    <figure className="polar-chart m-0 w-full" style={{ maxWidth: SIZE }}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        style={{ maxWidth: SIZE }}
        role="img"
        aria-label={`Sky track for the ${pass.name} pass beginning ${pass.start.time}`}
      >
        {/* Elevation rings: horizon, 30, 60 degrees */}
        {[0, 30, 60].map((el) => (
          <circle
            key={el}
            cx={CENTER}
            cy={CENTER}
            r={((90 - el) / 90) * RADIUS}
            className={el === 0 ? 'chart-horizon' : 'chart-grid'}
            fill="none"
          />
        ))}
        {/* Zenith cross */}
        <line x1={CENTER - 4} y1={CENTER} x2={CENTER + 4} y2={CENTER} className="chart-grid" />
        <line x1={CENTER} y1={CENTER - 4} x2={CENTER} y2={CENTER + 4} className="chart-grid" />

        {/* Radial spokes toward each cardinal point */}
        {CARDINALS.map(({ az }) => {
          const [x, y] = project(az, 0);
          return <line key={az} x1={CENTER} y1={CENTER} x2={x} y2={y} className="chart-grid" />;
        })}

        {/* Elevation labels along the northern spoke */}
        {[30, 60].map((el) => {
          const [x, y] = project(0, el);
          return (
            <text key={el} x={x + 4} y={y + 3} className="chart-tick" textAnchor="start">
              {el}°
            </text>
          );
        })}

        {/* Cardinal labels just outside the horizon */}
        {CARDINALS.map(({ az, label }) => {
          const r = RADIUS + 14;
          const a = (az * Math.PI) / 180;
          const x = CENTER - r * Math.sin(a);
          const y = CENTER - r * Math.cos(a);
          return (
            <text
              key={label}
              x={x}
              y={y + 4}
              textAnchor="middle"
              className={label.length === 1 ? 'chart-cardinal-major' : 'chart-cardinal'}
            >
              {label}
            </text>
          );
        })}

        {/* The arc: dim where not visible, bright through the visible window */}
        {runs.map((run, i) => (
          <path
            key={i}
            d={toPath(run.points)}
            fill="none"
            className={run.visible ? 'chart-track-visible' : 'chart-track-dim'}
          />
        ))}

        {/* Event markers */}
        {markers.map(({ key, point, event }) => {
          const [x, y] = project(point.azimuthDeg, point.elevationDeg);
          if (key === 'max') {
            return (
              <g key={key}>
                <circle cx={x} cy={y} r={5.5} className="chart-marker-max" />
                <text x={x} y={y - 10} textAnchor="middle" className="chart-marker-label">
                  {timeFmt.format(new Date(event.time))}
                </text>
              </g>
            );
          }
          return (
            <g key={key}>
              <circle cx={x} cy={y} r={4} className="chart-marker" />
              <text x={x} y={y + 15} textAnchor="middle" className="chart-marker-label">
                {timeFmt.format(new Date(event.time))}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="text-[11px] text-space-300 mt-1.5 leading-relaxed">
        Zenith at centre, horizon at the rim. Oriented for looking up: north at the top, east to the
        left. The bright arc is when the satellite is sunlit and visible
        {pass.endReason === 'shadow' && '; it ends as the satellite enters Earth’s shadow'}.
      </figcaption>
    </figure>
  );
}
