import type { Observer } from '../types';

/**
 * What you actually saw.
 *
 * Every other panel in this app is a prediction. This is the only one that
 * records something that happened, which makes it the only part whose value
 * grows by being used — a pass table is as good on your first visit as your
 * hundredth, and a logbook is not.
 *
 * Deliberately local. There are no accounts, so there is nowhere to sync to,
 * and inventing a server to hold people's observing history would be a much
 * larger promise than this can currently keep. Entries live in this browser
 * and can be exported, so the data is the user's rather than the app's.
 */

export const STORAGE_KEY = 'lookup.logbook';
/**
 * Enough for years of regular observing, and small enough that the whole
 * thing stays comfortably inside localStorage's few megabytes even if every
 * entry carries a long note.
 */
export const MAX_ENTRIES = 1000;
export const MAX_NOTE_LENGTH = 2000;

export type SeeingQuality = 'excellent' | 'good' | 'fair' | 'poor';

export interface LogEntry {
  /** Stable id, so an entry can be edited or removed without ambiguity. */
  id: string;
  /** When it was seen, not when it was written down. */
  observedAt: string;
  /** What it was. Free text, since it may be something the app cannot name. */
  subject: string;
  /** NORAD id where the sighting was of a tracked object. */
  satnum: string | null;
  observer: Observer;
  /** Peak elevation in degrees, where the observer recorded one. */
  maxElevationDeg: number | null;
  magnitude: number | null;
  seeing: SeeingQuality | null;
  note: string;
  /** When the entry was written, which is not when the thing was seen. */
  recordedAt: string;
}

export interface NewLogEntry {
  observedAt: Date;
  subject: string;
  satnum?: string | null;
  observer: Observer;
  maxElevationDeg?: number | null;
  magnitude?: number | null;
  seeing?: SeeingQuality | null;
  note?: string;
}

function newId(): string {
  // crypto.randomUUID is not available on every browser this might run in, and
  // a collision here would silently merge two nights' observations.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build an entry from a sighting.
 *
 * Rejects rather than repairs: an observation with no subject or an
 * unparseable time is not a record of anything, and storing it would put a
 * blank row in somebody's history that they cannot interpret later.
 */
export function createEntry(input: NewLogEntry): LogEntry | null {
  const subject = input.subject.trim();
  if (subject.length === 0) return null;
  if (!(input.observedAt instanceof Date) || Number.isNaN(input.observedAt.getTime())) return null;

  return {
    id: newId(),
    observedAt: input.observedAt.toISOString(),
    subject: subject.slice(0, 200),
    satnum: input.satnum ?? null,
    observer: input.observer,
    maxElevationDeg: Number.isFinite(input.maxElevationDeg) ? Number(input.maxElevationDeg) : null,
    magnitude: Number.isFinite(input.magnitude) ? Number(input.magnitude) : null,
    seeing: input.seeing ?? null,
    note: (input.note ?? '').slice(0, MAX_NOTE_LENGTH),
    recordedAt: new Date().toISOString(),
  };
}

/**
 * Validate one stored record.
 *
 * Storage is not trustworthy: it survives upgrades, and a user can edit it. A
 * single malformed entry must not take the whole logbook down with it, so
 * these are checked one at a time and the bad ones dropped.
 */
export function isValidEntry(value: unknown): value is LogEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<LogEntry>;
  if (typeof entry.id !== 'string' || entry.id.length === 0) return false;
  if (typeof entry.subject !== 'string' || entry.subject.length === 0) return false;
  if (typeof entry.observedAt !== 'string' || Number.isNaN(Date.parse(entry.observedAt))) return false;
  if (!entry.observer || typeof entry.observer !== 'object') return false;
  const { latitude, longitude } = entry.observer as Observer;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return true;
}

export function loadEntries(storage: Pick<Storage, 'getItem'> = localStorage): LogEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry).sort(byObservedDescending);
  } catch {
    // Corrupt storage loses the logbook, which is bad, but throwing here would
    // lose the whole app, which is worse.
    return [];
  }
}

export function saveEntries(
  entries: LogEntry[],
  storage: Pick<Storage, 'setItem'> = localStorage
): boolean {
  try {
    const trimmed = [...entries].sort(byObservedDescending).slice(0, MAX_ENTRIES);
    storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    // Quota exceeded, or storage disabled entirely in a private window.
    return false;
  }
}

function byObservedDescending(a: LogEntry, b: LogEntry): number {
  return Date.parse(b.observedAt) - Date.parse(a.observedAt);
}

export function addEntry(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  return [entry, ...entries].sort(byObservedDescending).slice(0, MAX_ENTRIES);
}

export function removeEntry(entries: LogEntry[], id: string): LogEntry[] {
  return entries.filter((e) => e.id !== id);
}

export interface LogbookSummary {
  total: number;
  distinctSubjects: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  /** Subjects seen most often, commonest first. */
  mostSeen: Array<{ subject: string; count: number }>;
  /** Nights with at least one entry. */
  nights: number;
}

/**
 * What the logbook adds up to.
 *
 * Nights are counted by local date rather than by UTC day: an observing
 * session that runs past midnight is one night to the person who sat through
 * it, and counting it as two would make every serious session look like two
 * casual ones.
 */
export function summarise(entries: LogEntry[]): LogbookSummary {
  if (entries.length === 0) {
    return { total: 0, distinctSubjects: 0, firstObservedAt: null, lastObservedAt: null, mostSeen: [], nights: 0 };
  }

  const counts = new Map<string, number>();
  const nights = new Set<string>();
  let earliest = entries[0].observedAt;
  let latest = entries[0].observedAt;

  for (const entry of entries) {
    counts.set(entry.subject, (counts.get(entry.subject) ?? 0) + 1);
    nights.add(observingNight(new Date(entry.observedAt)));
    if (Date.parse(entry.observedAt) < Date.parse(earliest)) earliest = entry.observedAt;
    if (Date.parse(entry.observedAt) > Date.parse(latest)) latest = entry.observedAt;
  }

  const mostSeen = [...counts.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject))
    .slice(0, 5);

  return {
    total: entries.length,
    distinctSubjects: counts.size,
    firstObservedAt: earliest,
    lastObservedAt: latest,
    mostSeen,
    nights: nights.size,
  };
}

/**
 * The local date an observation belongs to.
 *
 * Anything before midday counts as the previous night, so a 1 a.m. sighting
 * files with the evening it belongs to rather than starting a new one.
 */
export function observingNight(date: Date): string {
  const shifted = new Date(date.getTime());
  if (shifted.getHours() < 12) shifted.setDate(shifted.getDate() - 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(
    shifted.getDate()
  ).padStart(2, '0')}`;
}

/** The logbook as CSV, so the record belongs to the observer rather than the app. */
export function entriesToCsv(entries: LogEntry[]): string {
  const header = [
    'observed_at',
    'subject',
    'norad_id',
    'latitude',
    'longitude',
    'max_elevation_deg',
    'magnitude',
    'seeing',
    'note',
    'recorded_at',
  ];
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = [...entries].sort(byObservedDescending).map((e) =>
    [
      e.observedAt,
      e.subject,
      e.satnum,
      e.observer.latitude,
      e.observer.longitude,
      e.maxElevationDeg,
      e.magnitude,
      e.seeing,
      e.note,
      e.recordedAt,
    ]
      .map(escape)
      .join(',')
  );

  return [header.join(','), ...rows].join('\n');
}
