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
  endReason: "set" | "shadow" | "daylight";
}
