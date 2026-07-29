import * as AstronomyModule from 'astronomy-engine';

/**
 * astronomy-engine's ESM build exposes real named exports, while a loader that
 * resolves its CJS build instead hands back a namespace whose whole API sits
 * under `default`. Both shapes occur in practice — bundlers take the ESM path,
 * some Node/tsx resolutions take the CJS one — so normalise them here.
 *
 * The `default` lookup is deliberately computed rather than written as
 * `AstronomyModule.default`: against the ESM build that named export genuinely
 * does not exist, and a static reference makes bundlers warn about an import
 * that "will always be undefined".
 */
const DEFAULT_EXPORT = 'default';
const namespace = AstronomyModule as unknown as Record<string, unknown>;

export const Astronomy: typeof AstronomyModule =
  (namespace[DEFAULT_EXPORT] as typeof AstronomyModule | undefined) ?? AstronomyModule;

export type AstroObserver = AstronomyModule.Observer;
