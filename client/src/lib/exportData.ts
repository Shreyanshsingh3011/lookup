import type { Pass, TleRecord } from '../types';

/** Quote a CSV field per RFC 4180: wrap in quotes, doubling any internal quote. */
function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const PASS_COLUMNS = [
  'satellite',
  'norad_id',
  'date',
  'start_time_utc',
  'start_azimuth_deg',
  'start_direction',
  'max_time_utc',
  'max_altitude_deg',
  'max_azimuth_deg',
  'max_direction',
  'end_time_utc',
  'end_azimuth_deg',
  'end_direction',
  'magnitude',
  'duration_seconds',
  'end_reason',
  'cloud_cover_percent',
];

/**
 * Pass predictions as CSV, one row per pass. Times are ISO 8601 UTC so the
 * file is unambiguous regardless of which timezone it's opened in — the app
 * itself displays local time, but a spreadsheet is more useful with a fixed
 * reference.
 */
export function passesToCsv(passes: Pass[]): string {
  const rows = passes.map((p) =>
    [
      p.name,
      p.satnum,
      p.start.time.slice(0, 10),
      p.start.time,
      p.start.azimuthDeg,
      p.start.direction,
      p.max.time,
      p.max.altitudeDeg,
      p.max.azimuthDeg,
      p.max.direction,
      p.end.time,
      p.end.azimuthDeg,
      p.end.direction,
      p.magnitude,
      p.durationSeconds,
      p.endReason,
      p.cloudCoverPercent ?? '',
    ]
      .map(csvField)
      .join(',')
  );
  return [PASS_COLUMNS.map(csvField).join(','), ...rows].join('\r\n');
}

/**
 * TLEs in Celestrak's own text format (name / line 1 / line 2 triples), so
 * a tracked set can be reused directly in other tools that read that format.
 */
export function tlesToText(tles: TleRecord[]): string {
  return tles.map((t) => `${t.name}\n${t.line1}\n${t.line2}`).join('\n');
}

/** Triggers a browser download of in-memory text content — no server round-trip. */
export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
