/**
 * Earth as the weather satellites currently see it.
 *
 * Imagery, not video, and the wording throughout says so. A geostationary
 * full-disk scan takes about ten minutes, so the freshest frame available is
 * typically ten to twenty minutes old — close enough to watch a storm system
 * move day to day, nowhere near a live camera.
 */

export interface EarthImage {
  satelliteId: string;
  name: string;
  operator: string;
  product: string;
  longitudeDeg: number;
  url: string;
  checkedAt: string;
  /** When the host says the frame was published, if it says at all. */
  frameTime: string | null;
}

export interface EarthImageryResponse {
  image: EarthImage | null;
  status: 'live' | 'cache' | 'unavailable';
  error?: string;
  unreachable: string[];
}

/**
 * How old the frame is, in words.
 *
 * Only stated when the host actually told us — inventing a freshness figure
 * for an image of unknown age would be exactly the kind of small fabrication
 * that makes a whole app untrustworthy.
 */
export function describeFrameAge(frameTime: string | null, now: Date): string | null {
  if (!frameTime) return null;
  const published = Date.parse(frameTime);
  if (!Number.isFinite(published)) return null;

  // Tested on the raw difference, not the rounded minutes: rounding a small
  // negative gives -0, which is not less than zero, so clock skew between the
  // image host and the browser would slip through as "less than a minute old".
  const deltaMs = now.getTime() - published;
  if (deltaMs < 0) return 'just published';

  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return 'less than a minute old';
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min old`;
  return `over ${Math.floor(hours / 24)} days old`;
}

/**
 * Whether a frame is old enough to be worth flagging.
 *
 * Full-disk scans arrive every ten minutes, so anything beyond about an hour
 * means the feed has stalled rather than that it is simply between frames.
 */
export function frameIsStale(frameTime: string | null, now: Date): boolean {
  if (!frameTime) return false;
  const published = Date.parse(frameTime);
  if (!Number.isFinite(published)) return false;
  return now.getTime() - published > 60 * 60 * 1000;
}
