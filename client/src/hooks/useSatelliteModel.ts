import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { modelUrlFor } from '../lib/satelliteModels';

/** Longest dimension a loaded model is scaled to, in dome units. */
const TARGET_SIZE = 7;

/**
 * Loaded scenes, keyed by URL. Cached because several markers can reference the
 * same model, and because satellites drop in and out of view constantly as they
 * cross the horizon.
 */
const cache = new Map<string, Promise<THREE.Object3D>>();

/**
 * Normalise arbitrary model units to the dome's scale.
 *
 * Published spacecraft models come in whatever units their author used — metres,
 * centimetres, inches — so a raw model is as likely to be invisible as it is to
 * swallow the whole sky. Fit the longest axis to a known size and recentre.
 */
function normalise(object: THREE.Object3D): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);

  const wrapper = new THREE.Group();
  if (longest > 0 && Number.isFinite(longest)) {
    const centre = box.getCenter(new THREE.Vector3());
    object.position.sub(centre);
    wrapper.scale.setScalar(TARGET_SIZE / longest);
  }
  wrapper.add(object);
  return wrapper;
}

function load(url: string): Promise<THREE.Object3D> {
  let pending = cache.get(url);
  if (!pending) {
    pending = new Promise<THREE.Object3D>((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        (err) => reject(err)
      );
    });
    cache.set(url, pending);
  }
  return pending;
}

/**
 * An external model for a satellite, or null to use the procedural geometry.
 *
 * Never throws and never suspends: a missing or broken model is a cosmetic
 * downgrade, not an error worth taking the sky view down for.
 */
export function useSatelliteModel(satnum: string): THREE.Object3D | null {
  const url = modelUrlFor(satnum);
  const [scene, setScene] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!url) {
      setScene(null);
      return;
    }
    let cancelled = false;
    load(url)
      .then((loaded) => {
        if (!cancelled) setScene(loaded);
      })
      .catch((err) => {
        // Drop the failed entry so a transient error can be retried later.
        cache.delete(url);
        console.warn(`[models] failed to load ${url}; using procedural geometry instead.`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Each marker needs its own copy: an Object3D can only have one parent, so
  // sharing the cached scene would make satellites steal it from each other.
  return useMemo(() => (scene ? normalise(scene.clone(true)) : null), [scene]);
}
