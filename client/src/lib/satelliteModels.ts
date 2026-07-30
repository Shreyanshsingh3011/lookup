/**
 * Optional external 3D models for individual satellites.
 *
 * No assets are vendored in this repository. NASA publishes spacecraft models
 * at https://nasa3d.arc.nasa.gov/models, but mostly as `.3ds`, `.obj` and
 * `.stl` rather than glTF, and they are large — so converting and committing
 * them is a deliberate choice for whoever deploys this, not something baked in.
 *
 * To use one:
 *   1. Convert to `.glb` and drop it in `client/public/models/`.
 *   2. Either add an entry to MODEL_URLS below, or set
 *      `VITE_SATELLITE_MODELS='{"25544":"/models/iss.glb"}'` at build time.
 *
 * Anything without a model — or whose model fails to load — falls back to the
 * procedural geometry, so this is purely additive.
 */

/** NORAD catalog number -> model URL. */
const MODEL_URLS: Record<string, string> = {
  // '25544': '/models/iss.glb',   // ISS
  // '48274': '/models/css.glb',   // Tiangong core module
};

/**
 * Build-time overrides, so a deployment can supply models without a code
 * change. Malformed JSON is ignored rather than breaking the app.
 */
function envOverrides(): Record<string, string> {
  const raw = import.meta.env.VITE_SATELLITE_MODELS;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    console.warn('[models] VITE_SATELLITE_MODELS is not valid JSON; ignoring it.');
    return {};
  }
}

const resolved: Record<string, string> = { ...MODEL_URLS, ...envOverrides() };

export function modelUrlFor(satnum: string): string | undefined {
  return resolved[satnum];
}

/** True when any model is configured, so callers can skip the machinery entirely. */
export const hasConfiguredModels = Object.keys(resolved).length > 0;
