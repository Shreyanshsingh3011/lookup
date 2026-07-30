/**
 * Service worker registration.
 *
 * Registration is deliberately production-only: in dev, Vite serves modules
 * that change on every save, and a worker caching them turns every edit into a
 * hard-refresh hunt.
 *
 * A cached single-page app can pin someone to an old build indefinitely, so an
 * update is never applied silently mid-session — `onUpdateReady` fires and the
 * page decides when to hand over.
 */

export interface ServiceWorkerHandle {
  /** Activate the waiting worker and reload onto the new build. */
  applyUpdate(): void;
}

export function registerServiceWorker(onUpdateReady: (handle: ServiceWorkerHandle) => void): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  // Registering is conventionally deferred to `load` so it does not compete
  // with the initial download. But this runs from an effect, and an effect can
  // land either side of that event — attaching a listener after `load` has
  // already fired means it never runs and the app silently never installs.
  const start = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const announce = (worker: ServiceWorker) => {
          onUpdateReady({
            applyUpdate() {
              worker.postMessage('skip-waiting');
            },
          });
        };

        // A worker already waiting from a previous visit.
        if (registration.waiting && navigator.serviceWorker.controller) {
          announce(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // `controller` is null on the very first install, when there is no
            // previous version to update from — that is not an update, it is
            // the app simply becoming available offline.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              announce(installing);
            }
          });
        });
      })
      .catch(() => {
        // Registration can fail on an unsupported or restricted origin. The
        // app works exactly as before without it, so there is nothing to say.
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Fires once the new worker takes over, which only happens after the
      // page asked it to. Guarded because Chrome can fire it more than once.
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  };

  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
