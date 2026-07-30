import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraState = 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported';

export interface CameraStreamControl {
  state: CameraState;
  /** Attach to a <video> element to show the passthrough. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  enable: () => void;
  disable: () => void;
}

/**
 * Live rear-camera passthrough, to sit behind the transparent sky.
 *
 * Opt-in and fully released on disable: a camera left running is both a
 * battery drain and a privacy smell, so the tracks are stopped rather than
 * merely detached. Nothing is ever recorded, uploaded or read back — the
 * stream goes straight to a <video> element for display.
 */
export function useCameraStream(): CameraStreamControl {
  const [state, setState] = useState<CameraState>('idle');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const disable = useCallback(() => {
    stop();
    setState('idle');
    setError(null);
  }, [stop]);

  const enable = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    setState('requesting');
    setError(null);

    navigator.mediaDevices
      // "environment" asks for the rear camera; a device with only one camera
      // simply returns that, which is still the right thing to show.
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        // The <video> is only rendered once state flips to "active", so it
        // does not exist yet at this point. Attaching the stream is left to
        // the effect below, which runs after that element has mounted.
        streamRef.current = stream;
        setState('active');
      })
      .catch((err: unknown) => {
        setState('denied');
        setError(err instanceof Error ? err.message : 'Camera unavailable');
      });
  }, []);

  // Attach the stream once the <video> exists. This has to be an effect
  // rather than part of the getUserMedia callback, because the element is
  // only rendered after state becomes "active".
  useEffect(() => {
    if (state !== 'active') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.srcObject === stream) return;

    video.srcObject = stream;
    // A muted, inline video is allowed to autoplay; play() can still reject
    // if the element goes away between mount and this call.
    void video.play().catch(() => {});
  }, [state]);

  // Release the camera if the component unmounts while it is still running.
  useEffect(() => stop, [stop]);

  return { state, videoRef, error, enable, disable };
}
