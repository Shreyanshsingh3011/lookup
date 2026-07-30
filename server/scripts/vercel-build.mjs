/**
 * Produces the Vercel serverless function entry (server/api/[...path].js).
 *
 * Vercel's own dependency bundler hits a real ESM/CJS dual-package hazard on
 * astronomy-engine (it resolves the package's ESM build but loads it through
 * a CommonJS loader, which throws on the bare `export` syntax). Pre-bundling
 * everything ourselves with esbuild sidesteps that entirely: esbuild resolves
 * and inlines each dependency's actual source once, at build time, so
 * Vercel's runtime never has to re-resolve astronomy-engine's package.json
 * exports itself.
 *
 * satellite.js is the one dependency left external rather than bundled: its
 * entry point re-exports an optional WASM/pthreads backend that uses
 * top-level await in a way esbuild can't statically bundle, and it isn't
 * needed — the pure-JS SGP4 API this app uses already resolves correctly at
 * runtime without bundling it (the client's Vite config stubs the same
 * barrel out for the same reason; see client/vite.config.ts).
 *
 * The catch-all filename ([...path].js) is what makes every /api/* request
 * reach this one function with no vercel.json rewrite needed — Express does
 * its own routing from the real request path from there.
 *
 * Local dev/build/start (tsx, tsc, dist/) are untouched; this only produces
 * an additional, gitignored deployment artifact under server/api/.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(serverDir, 'api', '[...path].js');

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [join(serverDir, 'src', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['satellite.js'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

console.log(`wrote ${outfile}`);
