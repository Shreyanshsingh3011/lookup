import type { Observer } from '../types';

/**
 * The view, as a URL.
 *
 * Nothing about this app was linkable before: every visit started at your own
 * location, at now, with the default groups. "Look at this pass" was not a
 * thing you could say to somebody, which for an app about a shared sky is a
 * strange omission.
 *
 * Two rules shape what goes in. Only state a recipient could not reconstruct
 * is encoded — the sky follows from where and when, so the where and when are
 * the link. And anything absent falls back to the local default rather than
 * failing, so a hand-edited or truncated URL degrades to "my location, now"
 * instead of an error page.
 */

export interface ShareState {
  observer: Observer | null;
  /** Absolute instant the view was pinned to, or null for live. */
  time: Date | null;
  groups: string[] | null;
  /** NORAD id of the selected object. */
  satnum: string | null;
}

export const EMPTY_SHARE_STATE: ShareState = {
  observer: null,
  time: null,
  groups: null,
  satnum: null,
};

/**
 * Coordinates are rounded to four decimals — about eleven metres, far finer
 * than any of this needs and coarse enough not to publish somebody's exact
 * doorstep in a link they are about to paste into a group chat.
 */
const COORD_DECIMALS = 4;

function roundCoord(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS));
}

export function encodeShareState(state: ShareState): string {
  const params = new URLSearchParams();

  if (state.observer) {
    params.set('lat', String(roundCoord(state.observer.latitude)));
    params.set('lon', String(roundCoord(state.observer.longitude)));
    if (state.observer.elevation) params.set('alt', String(Math.round(state.observer.elevation)));
  }
  // A live view deliberately carries no time: pinning "now" into a link would
  // make it a link to the moment it was copied, which is not what someone
  // sharing their current sky means.
  if (state.time) params.set('t', state.time.toISOString());
  if (state.groups && state.groups.length > 0) params.set('groups', state.groups.join(','));
  if (state.satnum) params.set('sat', state.satnum);

  return params.toString();
}

export function decodeShareState(search: string): ShareState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  return {
    observer: parseObserver(params),
    time: parseTime(params.get('t')),
    groups: parseGroups(params.get('groups')),
    satnum: parseSatnum(params.get('sat')),
  };
}

function parseObserver(params: URLSearchParams): Observer | null {
  const latitude = Number(params.get('lat'));
  const longitude = Number(params.get('lon'));
  // A partial or nonsensical coordinate is dropped whole rather than half
  // applied: a view at latitude 51 and longitude NaN is not a place.
  if (!params.has('lat') || !params.has('lon')) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const rawElevation = Number(params.get('alt'));
  const elevation = Number.isFinite(rawElevation) ? rawElevation : 0;
  // Below the Dead Sea or above the Kármán line is not somewhere you are
  // standing, and a bad value here silently skews every elevation angle.
  const safeElevation = elevation >= -500 && elevation <= 9000 ? elevation : 0;

  return { latitude, longitude, elevation: safeElevation };
}

function parseTime(raw: string | null): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseGroups(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(',')
    .map((g) => g.trim())
    .filter((g) => /^[a-z0-9-]+$/.test(g));
  // Validating the ids themselves is the caller's job — it is the side that
  // knows the catalogue — but anything that could not be a group id is
  // dropped here so a malformed link cannot reach the API at all.
  return ids.length > 0 ? ids : null;
}

function parseSatnum(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d{1,9}$/.test(trimmed) ? trimmed : null;
}

/** The full shareable URL for a state, against the current page. */
export function shareUrl(state: ShareState, base: string): string {
  const query = encodeShareState(state);
  const url = new URL(base);
  url.search = query;
  url.hash = '';
  return url.toString();
}
