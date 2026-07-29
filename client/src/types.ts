export interface Observer {
  latitude: number;
  longitude: number;
  elevation: number;
}

export interface PassEvent {
  time: string;
  azimuthDeg: number;
  altitudeDeg: number;
  direction: string;
  magnitude: number | null;
}

export interface Pass {
  satnum: string;
  name: string;
  start: PassEvent;
  max: PassEvent;
  end: PassEvent;
  magnitude: number | null;
  durationSeconds: number;
  endReason: 'set' | 'shadow' | 'daylight';
}

export interface PassesResponse {
  observer: Observer;
  days: number;
  minElevationDeg: number;
  satelliteCount: number;
  passCount: number;
  passes: Pass[];
}
