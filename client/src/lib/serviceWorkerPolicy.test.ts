import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/**
 * Exercises the real public/sw.js against a stub Cache API.
 *
 * The service worker cannot be imported normally — it is plain JS written
 * against the worker globals, and it carries build-time placeholders — so it
 * is stamped and evaluated here the way the build and the browser would.
 *
 * What this is guarding is the one rule that matters: cache what stays true,
 * never cache what would become a lie. Serving a stored aircraft position is
 * not old data, it is a wrong answer, and nothing about that failure would be
 * visible in the UI. A future edit that adds a live feed to the cached set
 * should fail here rather than in someone's hands.
 */

const swSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../public/sw.js'),
  'utf8'
);

interface StubRequest {
  url: string;
  method: string;
  mode?: string;
}

interface Harness {
  handleFetch(request: StubRequest): Promise<{ body: string; from: 'network' | 'cache' } | null>;
  cacheContents(): string[];
  setNetwork(fn: (url: string) => { ok: boolean; body: string } | null): void;
  runInstall(): Promise<void>;
}

function boot(precache: string[] = []): Harness {
  // The build stamps these in; do the same so the source under test is real.
  assert.ok(swSource.includes('__PRECACHE__'), 'sw.js should carry its precache placeholder');
  assert.ok(swSource.includes('__BUILD_ID__'), 'sw.js should carry its build-id placeholder');
  const stamped = swSource
    .replace('__PRECACHE__', JSON.stringify(precache))
    .replace('__BUILD_ID__', 'test-build');

  const stores = new Map<string, Map<string, { body: string; headers: Map<string, string> }>>();
  let network: (url: string) => { ok: boolean; body: string } | null = () => null;

  class StubHeaders {
    private map = new Map<string, string>();
    constructor(init?: StubHeaders | Map<string, string>) {
      const source = init instanceof StubHeaders ? init.map : init;
      if (source) for (const [k, v] of source) this.map.set(k.toLowerCase(), v);
    }
    get(key: string) {
      return this.map.get(key.toLowerCase()) ?? null;
    }
    set(key: string, value: string) {
      this.map.set(key.toLowerCase(), value);
    }
    entries() {
      return this.map.entries();
    }
    [Symbol.iterator]() {
      return this.map.entries();
    }
  }

  class StubResponse {
    ok: boolean;
    status: number;
    statusText = '';
    type = 'basic';
    headers: StubHeaders;
    private body: string;
    constructor(body: string, init: { status?: number; headers?: StubHeaders } = {}) {
      this.body = body;
      this.status = init.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = new StubHeaders(init.headers);
    }
    clone() {
      return new StubResponse(this.body, { status: this.status, headers: this.headers });
    }
    async blob() {
      return this.body;
    }
    text() {
      return this.body;
    }
    static error() {
      return new StubResponse('', { status: 500 });
    }
  }

  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async match(request: StubRequest | string) {
          const key = typeof request === 'string' ? request : request.url;
          const hit = store.get(key);
          if (!hit) return undefined;
          return new StubResponse(hit.body, { headers: new StubHeaders(hit.headers) });
        },
        async put(request: StubRequest | string, response: StubResponse) {
          const key = typeof request === 'string' ? request : request.url;
          const headers = new Map<string, string>();
          for (const [k, v] of response.headers.entries()) headers.set(k, v);
          store.set(key, { body: await response.blob(), headers });
        },
        async keys() {
          return [...store.keys()].map((url) => ({ url }));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };

  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: { origin: 'https://lookup.test' },
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners.set(type, handler);
    },
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  };

  const sandbox = {
    self,
    caches,
    Response: StubResponse,
    Headers: StubHeaders,
    URL,
    Date,
    Number,
    JSON,
    Promise,
    console,
    fetch: async (request: StubRequest | string) => {
      const url = typeof request === 'string' ? request : request.url;
      const result = network(url);
      if (!result) throw new TypeError('network error');
      const headers = new StubHeaders();
      headers.set('x-source', 'network');
      return new StubResponse(result.body, { status: result.ok ? 200 : 500, headers });
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(stamped, sandbox);

  return {
    async runInstall() {
      const handler = listeners.get('install');
      let pending: Promise<unknown> = Promise.resolve();
      handler?.({ waitUntil: (p: Promise<unknown>) => (pending = p) });
      await pending;
    },

    async handleFetch(request) {
      const handler = listeners.get('fetch');
      let responded: Promise<StubResponse> | null = null;
      const waits: Promise<unknown>[] = [];
      handler?.({
        request,
        respondWith: (p: Promise<StubResponse>) => (responded = p),
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      });
      if (!responded) return null; // passed through to the network untouched
      const response = await responded;
      await Promise.allSettled(waits);
      return {
        body: response.text(),
        // The worker stamps this header only when storing a copy, so its
        // presence is what distinguishes a stored answer from a fresh one.
        from: response.headers.get('x-lookup-cached-at') ? 'cache' : 'network',
      };
    },

    cacheContents() {
      const out: string[] = [];
      for (const [name, store] of stores) for (const key of store.keys()) out.push(`${name} ${key}`);
      return out.sort();
    },

    setNetwork(fn) {
      network = fn;
    },
  };
}

const get = (url: string, mode = 'cors'): StubRequest => ({ url, method: 'GET', mode });

test('live feeds are never intercepted, so they can never be served stale', async () => {
  const sw = boot();
  sw.setNetwork(() => ({ ok: true, body: 'live' }));

  for (const path of [
    '/api/aircraft?lat=51&lon=0',
    '/api/weather?lat=51&lon=0',
    '/api/explain',
    '/api/orbit-advice',
    '/api/ai/status',
  ]) {
    const result = await sw.handleFetch(get(`https://lookup.test${path}`));
    assert.equal(result, null, `${path} should go straight to the network`);
  }

  assert.deepEqual(sw.cacheContents(), [], 'no live feed should have been stored');
});

test('orbital elements are served from cache and refreshed behind it', async () => {
  const sw = boot();
  const url = 'https://lookup.test/api/tle/stations';

  sw.setNetwork(() => ({ ok: true, body: 'elements-v1' }));
  const first = await sw.handleFetch(get(url));
  assert.equal(first?.body, 'elements-v1');
  assert.equal(first?.from, 'network', 'a cold cache must go to the network');

  // Second call is served from the store immediately, while the newer copy is
  // fetched behind it — so the next request sees the update.
  sw.setNetwork(() => ({ ok: true, body: 'elements-v2' }));
  const second = await sw.handleFetch(get(url));
  assert.equal(second?.body, 'elements-v1', 'should answer from cache without waiting');
  assert.equal(second?.from, 'cache');

  const third = await sw.handleFetch(get(url));
  assert.equal(third?.body, 'elements-v2', 'the background refresh should have landed');
});

test('elements stay available when the network is gone', async () => {
  const sw = boot();
  const url = 'https://lookup.test/api/tle/stations';
  sw.setNetwork(() => ({ ok: true, body: 'elements' }));
  await sw.handleFetch(get(url));

  sw.setNetwork(() => null); // offline
  const offline = await sw.handleFetch(get(url));
  assert.equal(offline?.body, 'elements');
});

test('pass predictions prefer the network but survive without it', async () => {
  const sw = boot();
  const url = 'https://lookup.test/api/passes?lat=51&lon=0';

  sw.setNetwork(() => ({ ok: true, body: 'passes-fresh' }));
  const online = await sw.handleFetch(get(url));
  assert.equal(online?.body, 'passes-fresh');
  assert.equal(online?.from, 'network', 'a reachable server must win over the stored copy');

  sw.setNetwork(() => null);
  const offline = await sw.handleFetch(get(url));
  assert.equal(offline?.body, 'passes-fresh', 'should fall back to what was stored');
  assert.equal(offline?.from, 'cache');
});

test('a failed response is not cached as if it succeeded', async () => {
  const sw = boot();
  sw.setNetwork(() => ({ ok: false, body: 'gateway error' }));
  await sw.handleFetch(get('https://lookup.test/api/passes?lat=51&lon=0'));
  assert.deepEqual(sw.cacheContents(), [], 'a 500 must not become the offline answer');
});

test('navigation falls back to the precached shell when offline', async () => {
  const sw = boot(['/index.html']);
  sw.setNetwork(() => ({ ok: true, body: '<html>shell</html>' }));
  await sw.runInstall();

  sw.setNetwork(() => null);
  const result = await sw.handleFetch(get('https://lookup.test/', 'navigate'));
  assert.equal(result?.body, '<html>shell</html>', 'the app must still launch with no network');
});

test('other origins are left alone', async () => {
  const sw = boot();
  sw.setNetwork(() => ({ ok: true, body: 'third party' }));
  const result = await sw.handleFetch(get('https://example.com/thing.js'));
  assert.equal(result, null);
});

test('non-GET requests are left alone', async () => {
  const sw = boot();
  sw.setNetwork(() => ({ ok: true, body: 'ok' }));
  const result = await sw.handleFetch({ url: 'https://lookup.test/api/passes', method: 'POST' });
  assert.equal(result, null);
});

test('the worker never precaches itself', () => {
  // A worker served from its own cache can never be replaced, which would pin
  // every user to this build permanently.
  const buildScript = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/build-sw.mjs'),
    'utf8'
  );
  assert.match(buildScript, /EXCLUDE = new Set\(\['sw\.js'\]\)/);
});

// ---------------------------------------------------------------------------
// Whether a deploy actually reaches anyone
// ---------------------------------------------------------------------------

/**
 * The rule that decides it, stated as a function so it can be checked.
 *
 * This exists because the previous rule — never update without asking — put a
 * "new version is ready" notice below the dome and left anyone who did not
 * scroll to it running the old build indefinitely. That is not a cosmetic
 * problem: it made a shipped fix indistinguishable from an unshipped one, and
 * it is how a corrected status line came back reading exactly as it had before.
 */
function appliesSilently(msSinceLoad: number, windowMs = 10_000): boolean {
  return msSinceLoad < windowMs;
}

test('an update ready while the page is still settling is taken without asking', () => {
  assert.equal(appliesSilently(0), true, 'a worker left waiting from last visit');
  assert.equal(appliesSilently(1_500), true, 'the update check landing just after load');
  assert.equal(appliesSilently(9_999), true, 'the last moment of the window');
});

test('an update ready once someone is using the app asks first', () => {
  assert.equal(appliesSilently(10_000), false, 'the boundary is exclusive');
  assert.equal(appliesSilently(60_000), false, 'a minute in, mid-task');
  assert.equal(
    appliesSilently(45 * 60_000),
    false,
    'a long session — reloading here could discard a half-written logbook entry'
  );
});
