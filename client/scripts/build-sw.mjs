/**
 * Stamps the built asset list into the service worker.
 *
 * public/sw.js ships two placeholders — the precache list and a build id —
 * because the real filenames are content-hashed and only exist after Vite has
 * run. Vite copies public/ verbatim, so this rewrites the copy in dist/ once
 * the hashes are known.
 *
 * The build id is derived from the asset names themselves rather than from a
 * timestamp: a rebuild that produces identical output keeps the same cache
 * name, so users are not asked to update for a build that changed nothing.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(clientRoot, 'dist');

/** Files worth having before the network disappears. */
const PRECACHE_EXTENSIONS = new Set(['.js', '.css', '.html', '.json', '.webmanifest', '.png', '.svg', '.woff2']);

/**
 * The service worker itself must never be precached — a worker that serves
 * itself from cache can never be replaced.
 */
const EXCLUDE = new Set(['sw.js']);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist)
  .map((file) => relative(dist, file).split('\\').join('/'))
  .filter((file) => !EXCLUDE.has(file))
  .filter((file) => PRECACHE_EXTENSIONS.has(file.slice(file.lastIndexOf('.'))))
  .sort();

const urls = files.map((file) => `/${file}`);

const buildId = createHash('sha256').update(urls.join('\n')).digest('hex').slice(0, 12);

const swPath = resolve(dist, 'sw.js');
const source = readFileSync(swPath, 'utf8');

if (!source.includes('__PRECACHE__') || !source.includes('__BUILD_ID__')) {
  // Failing loudly beats shipping a worker that precaches the literal string
  // "__PRECACHE__" and silently caches nothing.
  throw new Error('sw.js is missing its build-time placeholders');
}

writeFileSync(
  swPath,
  source
    .replace('__PRECACHE__', JSON.stringify(urls, null, 2))
    .replace('__BUILD_ID__', buildId)
);

console.log(`service worker: build ${buildId}, ${urls.length} precached files`);
