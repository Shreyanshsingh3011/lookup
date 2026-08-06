/**
 * Service worker registration.
 *
 * Registration is deliberately production-only: in dev, Vite serves modules
 * that change on every save, and a worker caching them turns every edit into a
 * hard-refresh hunt.
 *
 * A cached single-page app can pin someone to an old build indefinitely. The
 * original rule here was that an update is never applied without asking, which
 * protects someone mid-task but has a failure mode that turned out to matter
 * more: the notice sits below the dome, and anyone who does not scroll to it
 * keeps running the old build forever. A deploy that users never receive is
 * indistinguishable from a deploy that never happened.
 *
 * So the rule is now about timing rather than consent. An update that is ready
 * while the page is still settling — either left waiting from a previous visit,
 * or installed within a few seconds of load — is applied at once, because there
 * is nothing to interrupt yet. An update that arrives later, once someone is
 * actually using the app, still asks first: reloading the page out from under a
 * pass search or a half-written logbook entry is the thing worth avoiding.
 */

/**
 * How long after load an update may apply itself without asking.
 *
 * Long enough to cover the service worker's own update check, which is what
 * finds a fresh deploy, and short enough that it cannot fire once someone has
 * settled into the page.
 */
const SILENT_UPDATE_WINDOW_MS = 10_000;

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
  const startedAt = Date.now();

  const start = () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        const announce = (worker: ServiceWorker) => {
          const apply = () => worker.postMessage('skip-waiting');

          // Still settling: take the new build now rather than asking someone
          // to notice a banner. controllerchange reloads the page below, and
          // once the new worker is in control there is nothing left waiting,
          // so this cannot loop.
          if (Date.now() - startedAt < SILENT_UPDATE_WINDOW_MS) {
            apply();
            return;
          }

          onUpdateReady({ applyUpdate: apply });
        };

        // A worker already waiting from a previous visit.
        if (registration.waiting && navigator.serviceWorker.controller) {
          announce(registration.waiting);
        }

        // Ask outright rather than relying on the browser's own schedule for
        // re-fetching sw.js. This is what turns a fresh deploy into an
        // `updatefound` while the silent window above is still open; without
        // it the check can land minutes later, by which point applying it
        // would interrupt someone.
        void registration.update().catch(() => {
          // Offline, or the worker file is briefly unavailable mid-deploy.
          // The next load tries again.
        });

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
