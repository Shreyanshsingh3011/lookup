import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRouteIndex, CANONICAL_HOST, collectRoutes, ROUTE_DESCRIPTIONS } from "./routes.js";

// Imported dynamically, after the flag is set, so importing the app for its
// router table does not leave a listening socket holding the test open. A
// static import is hoisted above the assignment and would hang the run.
process.env.LOOKUP_NO_LISTEN = "1";
const { default: app } = await import("./index.js");

test("the index is read from the router, not from a list", () => {
  // If this ever comes back empty the index is broken, and it would report a
  // server with no routes — which is exactly the false "it's down" reading the
  // whole endpoint exists to prevent.
  const routes = collectRoutes(app);
  assert.ok(routes.length > 10, `only ${routes.length} routes found — the router walk has broken`);

  // Spot-check across every feature area, so a regression in the walk cannot
  // pass by finding some routes but not others.
  const keys = new Set(routes.map((r) => `${r.method} ${r.path}`));
  for (const expected of [
    "GET /api/health",
    "GET /api",
    "GET /api/routes",
    "GET /api/groups",
    "GET /api/passes",
    "POST /api/passes/custom",
    "GET /api/tle/:group",
    "GET /api/tle/satellite/:catnr",
    "GET /api/debris/catalogue",
    "GET /api/debris/cloud/:id",
    "GET /api/small-bodies",
    "GET /api/radio/:catnr",
    "GET /api/starlink/trains",
    "GET /api/earth-imagery",
    "GET /api/aircraft",
    "GET /api/satellites/search",
    "GET /api/ai/status",
    "POST /api/explain",
    "POST /api/orbit-advice",
  ]) {
    assert.ok(keys.has(expected), `${expected} is mounted but missing from the index`);
  }
});

test("every mounted route has a description", () => {
  // The list generates itself; the prose does not. This is what stops the
  // hand-maintained half drifting: a new route without a sentence fails here
  // rather than shipping as an undocumented row nobody notices.
  const undocumented = collectRoutes(app)
    .filter((r) => !r.documented)
    .map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(
    undocumented,
    [],
    `add these to ROUTE_DESCRIPTIONS in server/src/routes.ts: ${undocumented.join(", ")}`
  );
});

test("no description describes a route that no longer exists", () => {
  // Drift runs both ways. A description left behind after a route is deleted
  // is a promise the server no longer keeps.
  const mounted = new Set(collectRoutes(app).map((r) => `${r.method} ${r.path}`));
  const orphans = Object.keys(ROUTE_DESCRIPTIONS).filter((key) => !mounted.has(key));
  assert.deepEqual(orphans, [], `these describe routes that are not mounted: ${orphans.join(", ")}`);
});

test("HEAD is not listed separately from GET", () => {
  // Express registers a HEAD for every GET. Listing both would double the
  // index without telling anybody anything.
  assert.ok(!collectRoutes(app).some((r) => r.method === "HEAD"));
});

test("the index reports the canonical host, so you know which server answered", () => {
  // The confusion this exists to end is partly about hosts: the un-suffixed
  // lookup-server.vercel.app belongs to somebody else on Vercel's shared
  // namespace. Seeing this field is how a caller knows they reached ours.
  const index = buildRouteIndex(app);
  assert.equal(index.canonicalHost, "lookup-server-sand.vercel.app");
  assert.equal(index.canonicalHost, CANONICAL_HOST);
  assert.equal(index.service, "lookup-server");
  assert.equal(index.count, index.routes.length);
  assert.equal(index.undocumentedCount, 0);
  assert.equal(index.note, undefined, "a healthy build has nothing to apologise for");
});

test("routes come out in a stable order", () => {
  // So a diff of two responses shows what changed rather than a reshuffle.
  const once = collectRoutes(app).map((r) => `${r.method} ${r.path}`);
  const twice = collectRoutes(app).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(once, twice);
  assert.deepEqual([...once].sort(), once, "the index must be sorted");
});

test("an app whose router cannot be read says so instead of looking empty", () => {
  // If a future Express moves the route table, the endpoint must report that
  // it could not read it — not return zero routes, which reads as a server
  // with nothing mounted.
  const opaque = {} as unknown as typeof app;
  assert.deepEqual(collectRoutes(opaque), []);
  const index = buildRouteIndex(opaque);
  assert.equal(index.count, 0);
  assert.match(index.note ?? "", /could not be read/i);
});
