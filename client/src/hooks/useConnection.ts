import { useEffect, useState } from 'react';
import { registerServiceWorker, type ServiceWorkerHandle } from '../lib/serviceWorker';

export interface Connection {
  online: boolean;
  /** A newer build has installed and is waiting for the page to hand over. */
  updateReady: boolean;
  applyUpdate: () => void;
}

/**
 * Whether the app currently has a network, and whether a newer build is
 * waiting to take over.
 *
 * `navigator.onLine` is a weak signal — it reports whether the device has a
 * network interface, not whether anything is reachable through it, so a
 * captive portal or a dead uplink still reads as online. It is used here only
 * to explain a failure the user is already seeing, never to decide whether to
 * attempt a request: the data hooks always try, and report what actually
 * happened. That keeps this from becoming a source of wrong answers.
 */
export function useConnection(): Connection {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [handle, setHandle] = useState<ServiceWorkerHandle | null>(null);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    registerServiceWorker(setHandle);
  }, []);

  return {
    online,
    updateReady: handle !== null,
    applyUpdate: () => handle?.applyUpdate(),
  };
}
