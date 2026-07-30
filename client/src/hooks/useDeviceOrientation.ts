import { useCallback, useEffect, useRef, useState } from 'react';
import {
  lookDirectionFrom,
  orientationNeedsPermission,
  orientationSupported,
  requestOrientationPermission,
  smoothAngle,
  type LookDirection,
} from '../lib/deviceOrientation';

/**
 * Fraction of the gap to the newest reading closed per sample. Low enough to
 * damp magnetometer noise into something that does not visibly shake, high
 * enough that the view still feels attached to the phone.
 */
const SMOOTHING = 0.18;

/**
 * If no sensor event arrives within this window, treat the device as having
 * no usable orientation hardware. Desktop browsers expose the event type but
 * never fire it, so waiting for a sample is the only reliable detection.
 */
const SAMPLE_TIMEOUT_MS = 2500;

export type OrientationState =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'denied'
  | 'unsupported'
  | 'no-signal';

export interface DeviceOrientationControl {
  state: OrientationState;
  /** Latest smoothed direction, or null before the first sample. */
  look: LookDirection | null;
  /**
   * True when the heading is relative rather than true-north referenced,
   * which means the compass bearing cannot be trusted and the user may need
   * to correct it by dragging.
   */
  headingIsRelative: boolean;
  enable: () => void;
  disable: () => void;
}

/**
 * Drives a sky view from the phone's orientation sensors.
 *
 * Deliberately opt-in: sensors stay unsubscribed until `enable()` is called
 * from a user gesture, which is both required by iOS and the polite default
 * for a permission-gated capability.
 */
export function useDeviceOrientation(): DeviceOrientationControl {
  const [state, setState] = useState<OrientationState>('idle');
  const [look, setLook] = useState<LookDirection | null>(null);
  const [headingIsRelative, setHeadingIsRelative] = useState(false);

  // Smoothed values live in refs so a high-frequency sensor stream doesn't
  // re-render on every single sample.
  const smoothedRef = useRef<LookDirection | null>(null);
  const gotSampleRef = useRef(false);

  const disable = useCallback(() => {
    setState('idle');
    setLook(null);
    smoothedRef.current = null;
    gotSampleRef.current = false;
  }, []);

  const enable = useCallback(() => {
    if (!orientationSupported()) {
      setState('unsupported');
      return;
    }
    setState('requesting');
    requestOrientationPermission().then((permission) => {
      if (permission === 'granted') {
        gotSampleRef.current = false;
        setState('active');
      } else if (permission === 'unsupported') {
        setState('unsupported');
      } else {
        setState('denied');
      }
    });
  }, []);

  useEffect(() => {
    if (state !== 'active') return;

    const handle = (event: DeviceOrientationEvent) => {
      if (event.alpha === null && event.beta === null && event.gamma === null) return;

      // iOS supplies a true-north heading separately; Android's absolute
      // variant bakes it into alpha and sets `absolute`.
      const compassHeading =
        (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading ??
        null;
      const absolute = event.absolute === true || compassHeading != null;

      const raw = lookDirectionFrom({
        alpha: event.alpha ?? 0,
        beta: event.beta ?? 0,
        gamma: event.gamma ?? 0,
        compassHeading,
      });

      const previous = smoothedRef.current;
      const next: LookDirection = previous
        ? {
            azimuthDeg: smoothAngle(previous.azimuthDeg, raw.azimuthDeg, SMOOTHING),
            elevationDeg:
              previous.elevationDeg + (raw.elevationDeg - previous.elevationDeg) * SMOOTHING,
          }
        : raw;

      smoothedRef.current = next;
      gotSampleRef.current = true;
      setLook(next);
      setHeadingIsRelative(!absolute);
    };

    // Prefer the north-referenced stream where it exists; both are attached
    // because Android fires only one of the two depending on version.
    window.addEventListener('deviceorientationabsolute', handle as EventListener, true);
    window.addEventListener('deviceorientation', handle, true);

    const timeout = setTimeout(() => {
      if (!gotSampleRef.current) setState('no-signal');
    }, SAMPLE_TIMEOUT_MS);

    return () => {
      window.removeEventListener('deviceorientationabsolute', handle as EventListener, true);
      window.removeEventListener('deviceorientation', handle, true);
      clearTimeout(timeout);
    };
  }, [state]);

  return { state, look, headingIsRelative, enable, disable };
}

/** Whether this build should offer the mode at all. */
export function deviceOrientationOffered(): boolean {
  return orientationSupported() || orientationNeedsPermission();
}
