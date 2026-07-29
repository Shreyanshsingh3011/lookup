import type { TleRecord } from "./celestrak.js";

/**
 * A tiny bundled TLE snapshot used ONLY as a last-resort fallback for local
 * development in environments that cannot reach celestrak.org (sandboxes with
 * restricted egress, offline work, etc.).
 *
 * These elements have a fixed 2024 epoch. SGP4 accuracy degrades over days, so
 * positions and passes derived from them are WRONG for any current date — they
 * exist purely so the UI has plausibly-shaped data to render against. Any
 * response served from this source is tagged `source: "fixture"` so the client
 * can warn the user rather than silently presenting bad predictions.
 *
 * Disabled when NODE_ENV=production unless ALLOW_TLE_FIXTURE=1 is set.
 */
export const FIXTURE_TLES: TleRecord[] = [
  {
    name: "ISS (ZARYA)",
    satnum: "25544",
    line1: "1 25544U 98067A   24058.53472222  .00016717  00000+0  10270-3 0  9994",
    line2: "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49309239440272",
  },
];

export function fixtureEnabled(): boolean {
  if (process.env.ALLOW_TLE_FIXTURE === "1") return true;
  if (process.env.ALLOW_TLE_FIXTURE === "0") return false;
  return process.env.NODE_ENV !== "production";
}
