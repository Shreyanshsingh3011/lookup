/**
 * Renders the app icons.
 *
 * PWA install prompts and the iOS home screen both want raster icons, and SVG
 * support for `purpose: maskable` is still uneven — so rather than shipping
 * vectors and hoping, the icons are rasterised here and committed.
 *
 * Everything is drawn and encoded by hand against node's built-in zlib. The
 * artwork is a handful of ellipses, which is far less code than it would take
 * to justify pulling a renderer or an image library into the build for
 * something that regenerates roughly never.
 *
 * Run with `npm run icons` after changing the artwork.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const BACKGROUND = [8, 13, 26];
const RING = [45, 212, 191]; // teal-400, matching the app's accent
const CORE = [94, 234, 212];
const SPARK = [251, 191, 36]; // the amber used for aircraft

/** Samples per axis for anti-aliasing. Cheap here, and these are small images. */
const SUPERSAMPLE = 4;

/**
 * Signed "insideness" of a rotated elliptical ring at a point: positive within
 * the stroke, negative outside it. Working in the ellipse's own frame keeps
 * the rotation to a single coordinate transform.
 */
function ringCoverage(x, y, cx, cy, rx, ry, halfWidth, rotationRad) {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(rotationRad);
  const sin = Math.sin(rotationRad);
  const u = dx * cos + dy * sin;
  const v = -dx * sin + dy * cos;

  // Distance from the ellipse boundary, approximated by scaling the implicit
  // function by the local gradient. Exact enough for a stroke a few px wide.
  const f = (u / rx) ** 2 + (v / ry) ** 2 - 1;
  const gradient = Math.hypot((2 * u) / (rx * rx), (2 * v) / (ry * ry)) || 1e-6;
  return halfWidth - Math.abs(f / gradient);
}

function discCoverage(x, y, cx, cy, r) {
  return r - Math.hypot(x - cx, y - cy);
}

function blend(dst, offset, colour, alpha) {
  if (alpha <= 0) return;
  for (let c = 0; c < 3; c++) {
    dst[offset + c] = Math.round(dst[offset + c] * (1 - alpha) + colour[c] * alpha);
  }
}

function render(size, inset) {
  const c = size / 2;
  const r = c * (1 - inset);
  const pixels = new Uint8Array(size * size * 4);

  // Opaque background: maskable icons must be full-bleed, and a transparent
  // one would show whatever the launcher puts behind it.
  for (let i = 0; i < size * size; i++) {
    pixels[i * 4] = BACKGROUND[0];
    pixels[i * 4 + 1] = BACKGROUND[1];
    pixels[i * 4 + 2] = BACKGROUND[2];
    pixels[i * 4 + 3] = 255;
  }

  const shapes = [
    // Orbit, seen at a shallow angle.
    {
      colour: RING,
      opacity: 0.9,
      coverage: (x, y) =>
        ringCoverage(x, y, c, c, r, r * 0.42, size * 0.0225, (-28 * Math.PI) / 180),
    },
    // Faint horizon circle behind it.
    {
      colour: RING,
      opacity: 0.3,
      coverage: (x, y) => ringCoverage(x, y, c, c, r * 0.7, r * 0.7, size * 0.014, 0),
    },
    { colour: CORE, opacity: 1, coverage: (x, y) => discCoverage(x, y, c, c, size * 0.085) },
    // A single aircraft-amber spark riding the orbit.
    {
      colour: SPARK,
      opacity: 1,
      coverage: (x, y) =>
        discCoverage(x, y, c + r * 0.78 * Math.cos(-0.49), c + r * 0.78 * Math.sin(-0.49), size * 0.038),
    },
  ];

  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const offset = (py * size + px) * 4;
      for (const shape of shapes) {
        let hits = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const x = px + (sx + 0.5) * step;
            const y = py + (sy + 0.5) * step;
            if (shape.coverage(x, y) > 0) hits++;
          }
        }
        blend(pixels, offset, shape.colour, (hits / samples) * shape.opacity);
      }
    }
  }
  return pixels;
}

/* ---- Minimal PNG encoder (RGBA, 8-bit, no filtering) ---- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  // Each scanline is prefixed with its filter type; 0 means "none".
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const start = y * (size * 4 + 1);
    raw[start] = 0;
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, start + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  { file: 'icon-192.png', size: 192, inset: 0.14 },
  { file: 'icon-512.png', size: 512, inset: 0.14 },
  // Launchers crop maskable icons to roughly the inner 80%, so inset further.
  { file: 'icon-maskable-512.png', size: 512, inset: 0.26 },
  { file: 'apple-touch-icon.png', size: 180, inset: 0.16 },
];

mkdirSync(outDir, { recursive: true });
for (const { file, size, inset } of TARGETS) {
  const png = encodePng(render(size, inset), size);
  writeFileSync(resolve(outDir, file), png);
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`);
}
