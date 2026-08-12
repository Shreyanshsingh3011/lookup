export interface Observer {
  latitude: number; // degrees
  longitude: number; // degrees
  elevation: number; // meters above sea level
}

export interface PassEvent {
  time: string; // ISO 8601 UTC
  azimuthDeg: number;
  altitudeDeg: number;
  direction: string; // 16-point compass
  magnitude: number | null;
}

export interface Pass {
  satnum: string;
  name: string;
  start: PassEvent;
  max: PassEvent;
  end: PassEvent;
  magnitude: number | null; // brightest (lowest) magnitude reached during the pass
  durationSeconds: number;
  /**
   * Why the pass stopped being visible. "window" means it had not: the
   * satellite was still up and lit when the search ran out of window, so this
   * pass is reported truncated rather than finished.
   */
  endReason: "set" | "shadow" | "daylight" | "window";
  /**
   * Forecast cloud cover percent at the pass maximum, or null when no forecast
   * covers that time. Advisory only — it never affects whether a pass is listed.
   */
  cloudCoverPercent?: number | null;
}
