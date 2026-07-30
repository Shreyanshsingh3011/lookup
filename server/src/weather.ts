import { readFileSync } from "node:fs";

/**
 * Hourly cloud-cover forecasts from Open-Meteo, used to flag passes that are
 * likely to be clouded out.
 *
 * Open-Meteo is free and needs no key. It asks for reasonable use, so forecasts
 * are cached per rounded location.
 *
 * Weather is strictly advisory here: a forecast failure must never fail a pass
 * prediction. Every path in this module degrades to "unavailable" rather than
 * throwing into the request.
 */

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

/** Forecasts change slowly; an hour of caching is plenty. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Coordinate rounding for the cache key. Open-Meteo resolution is coarser than
 * this, so 0.1 degrees (~11 km) costs no accuracy and collapses nearby
 * observers onto one upstream request.
 */
const CACHE_PRECISION = 1;

/** Open-Meteo's hourly forecast horizon, in days. */
const FORECAST_DAYS = 10;

/** Upper bound on the upstream call, since the result is only advisory. */
const REQUEST_TIMEOUT_MS = 5000;

export type WeatherStatus = "live" | "cache" | "unavailable";

export interface CloudForecast {
  latitude: number;
  longitude: number;
  fetchedAt: number;
  /** Cloud cover percent, keyed by UTC hour as "YYYY-MM-DDTHH". */
  hourly: Map<string, number>;
}

export interface WeatherResult {
  forecast: CloudForecast | null;
  status: WeatherStatus;
  /** Why the forecast is unavailable, when it is. */
  error?: string;
}

/** UTC hour key matching Open-Meteo's hourly timestamps. */
export function hourKey(date: Date): string {
  return date.toISOString().slice(0, 13);
}

/**
 * Parse an Open-Meteo forecast response.
 *
 * Deliberately strict about shape and lenient about content: the upstream
 * contract is verified here rather than assumed, so a change in their response
 * surfaces as a clear error instead of silently producing empty forecasts.
 */
export function parseCloudForecast(payload: unknown, latitude: number, longitude: number): CloudForecast {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Open-Meteo response was not an object");
  }

  const hourly = (payload as { hourly?: unknown }).hourly;
  if (typeof hourly !== "object" || hourly === null) {
    throw new Error("Open-Meteo response had no 'hourly' block");
  }

  const times = (hourly as { time?: unknown }).time;
  const cover = (hourly as { cloud_cover?: unknown }).cloud_cover;

  if (!Array.isArray(times) || !Array.isArray(cover)) {
    throw new Error("Open-Meteo 'hourly' block lacked time/cloud_cover arrays");
  }
  if (times.length !== cover.length) {
    throw new Error(
      `Open-Meteo returned ${times.length} timestamps but ${cover.length} cloud-cover values`
    );
  }
  if (times.length === 0) {
    throw new Error("Open-Meteo returned an empty forecast");
  }

  const map = new Map<string, number>();
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const value = cover[i];
    // Skip individual gaps — Open-Meteo uses null for missing values — rather
    // than discarding the whole forecast.
    if (typeof time !== "string" || typeof value !== "number" || !Number.isFinite(value)) continue;
    // Times arrive as "2026-07-29T00:00" (UTC, since timezone=UTC is requested).
    map.set(time.slice(0, 13), Math.max(0, Math.min(100, value)));
  }

  if (map.size === 0) {
    throw new Error("Open-Meteo forecast contained no usable cloud-cover values");
  }

  return { latitude, longitude, fetchedAt: Date.now(), hourly: map };
}

const cache = new Map<string, CloudForecast>();
const inFlight = new Map<string, Promise<CloudForecast>>();

/**
 * Remember recent failures so a persistently unreachable forecast service is
 * not re-attempted on every single pass request. Short enough that a transient
 * outage recovers quickly.
 */
const FAILURE_TTL_MS = 5 * 60 * 1000;
const failures = new Map<string, { at: number; error: string }>();

function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(CACHE_PRECISION)},${longitude.toFixed(CACHE_PRECISION)}`;
}

async function fetchForecast(latitude: number, longitude: number): Promise<CloudForecast> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: "cloud_cover",
    forecast_days: String(FORECAST_DAYS),
    timezone: "UTC",
  });

  // Bounded: cloud cover is advisory, so a slow or hanging forecast must not
  // hold up the pass prediction it is annotating.
  const res = await fetch(`${OPEN_METEO_URL}?${params.toString()}`, {
    headers: { "User-Agent": "lookup-satellite-tracker/0.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Open-Meteo request failed: ${res.status}`);
  }
  return parseCloudForecast(await res.json(), latitude, longitude);
}

/**
 * Cloud forecast for an observer, or a reason it is unavailable. Never throws.
 */
export async function getCloudForecast(latitude: number, longitude: number): Promise<WeatherResult> {
  // Operator-supplied forecast, mirroring TLE_FILE: lets the whole feature run
  // air-gapped, and makes the populated UI testable without network access.
  const overridePath = process.env.WEATHER_FILE?.trim();
  if (overridePath) {
    try {
      const raw = readFileSync(overridePath, "utf8");
      return { forecast: parseCloudForecast(JSON.parse(raw), latitude, longitude), status: "live" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { forecast: null, status: "unavailable", error: `WEATHER_FILE at '${overridePath}': ${message}` };
    }
  }

  const key = cacheKey(latitude, longitude);
  const cached = cache.get(key);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { forecast: cached, status: "live" };
  }

  // Don't hammer a service that just failed.
  const failure = failures.get(key);
  if (failure && Date.now() - failure.at < FAILURE_TTL_MS) {
    return cached
      ? { forecast: cached, status: "cache", error: failure.error }
      : { forecast: null, status: "unavailable", error: failure.error };
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchForecast(latitude, longitude)
      .then((forecast) => {
        cache.set(key, forecast);
        failures.delete(key);
        return forecast;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
  }

  try {
    return { forecast: await pending, status: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.set(key, { at: Date.now(), error: message });
    // Serving a stale forecast beats serving none.
    if (cached) {
      return { forecast: cached, status: "cache", error: message };
    }
    return { forecast: null, status: "unavailable", error: message };
  }
}

/**
 * Cloud cover at a moment, from the nearest forecast hour. Returns null when
 * the time falls outside the forecast window — passes are predicted 10 days
 * out and can run past it.
 */
export function cloudCoverAt(forecast: CloudForecast | null, date: Date): number | null {
  if (!forecast) return null;
  // Round to the nearest hour rather than truncating, so a pass at 20:55 uses
  // the 21:00 forecast.
  const rounded = new Date(Math.round(date.getTime() / 3_600_000) * 3_600_000);
  return forecast.hourly.get(hourKey(rounded)) ?? null;
}

/** Coarse label for a cloud-cover percentage. */
export function cloudLabel(percent: number): "clear" | "partly cloudy" | "mostly cloudy" | "overcast" {
  if (percent <= 15) return "clear";
  if (percent <= 50) return "partly cloudy";
  if (percent <= 85) return "mostly cloudy";
  return "overcast";
}
