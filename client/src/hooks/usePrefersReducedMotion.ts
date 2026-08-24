import { useEffect, useState } from 'react';

/**
 * Whether the viewer has asked the system for less motion.
 *
 * The CSS half of this lives in `index.css` and covers transitions and
 * animations. It cannot reach the 3D scene, which is where most of this app's
 * motion actually is — a dome that keeps damping after the drag has stopped,
 * satellites crossing it, meteors falling. For a viewer with a vestibular
 * disorder those are the parts that matter, so the scene has to read the
 * preference itself.
 *
 * The preference is watched rather than read once: it is a system setting a
 * viewer may change without reloading the page, and someone who turns it on
 * mid-session has almost certainly just been made uncomfortable by something.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  // Read synchronously on first render rather than in an effect, so a scene
  // never gets one frame of full motion before settling down.
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(QUERY);
    const update = () => setReduced(media.matches);
    update();

    // Safari below 14 exposes only the deprecated listener API, and this app
    // targets phones that may be several years old.
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  return reduced;
}
