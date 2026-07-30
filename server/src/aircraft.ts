import { readFileSync } from "node:fs";

/**
 * Live aircraft positions from the OpenSky Network's ADS-B feed.
 *
 * This answers the question people actually have when they see a moving light:
 * is that a plane or a satellite? Aircraft broadcast their own position, so
 * unlike satellites there is no orbit propagation here — the API reports real
 * measured latitude/longitude/altitude, and the client turns that into a sky
 * position directly.
 *
 * Two honest limitations worth surfacing in any UI built on this:
 *  - ADS-B coverage is crowdsourced from volunteer ground receivers, so it is
 *    dense over Europe and North America and sparse-to-absent over oceans and
 *    remote regions. An empty result means "nothing received here", not
 *    "nothing flying here".
 *  - Not every aircraft appears. Some military and state flights do not
 *    broadcast ADS-B, or are filtered upstream.
 *
 * Like weather, this is strictly advisory: every path degrades to
 * "unavailable" rather than throwing into a request.
 */

const OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all";
const OPENSKY_TOKEN_URL =
  "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

/**
 * How long a fetched snapshot stays fresh.
 *
 * OpenSky rate-limits anonymous callers hard (a daily credit budget, not a
 * per-second one), so polling aggressively would exhaust the quota within
 * hours. A minute of caching keeps usage sane; the client dead-reckons each
 * aircraft along its reported track in between, which stays accurate because
 * aircraft in cruise fly straight and level — turns are rare and slow.
 */
const CACHE_TTL_MS = Number(process.env.OPENSKY_CACHE_TTL_MS) || 60_000;

/** Bounding-box half-size around the observer. */
const DEFAULT_RADIUS_KM = 150;

/** Upper bound on the upstream call, since the result is only advisory. */
const REQUEST_TIMEOUT_MS = 8000;

/** Don't re-attempt a failing upstream on every single request. */
const FAILURE_TTL_MS = 2 * 60 * 1000;

export type AircraftStatus = "live" | "cache" | "unavailable";

export interface Aircraft {
  /** ICAO 24-bit transponder address — the stable per-airframe identifier. */
  icao24: string;
  /** Flight callsign, when broadcast. Not the same as a commercial flight number. */
  callsign: string | null;
  originCountry: string;
  latitudeDeg: number;
  longitudeDeg: number;
  /** Metres above mean sea level. Geometric altitude preferred, barometric as fallback. */
  altitudeM: number;
  /** Ground speed, metres per second. */
  velocityMS: number | null;
  /** Direction of travel over the ground, degrees clockwise from true north. */
  trueTrackDeg: number | null;
  /** Positive is climbing, metres per second. */
  verticalRateMS: number | null;
  onGround: boolean;
  /** Unix seconds when this position was last measured — used to age-out stale contacts. */
  lastContact: number;
}

export interface AircraftSnapshot {
  /** Unix seconds, from OpenSky, that the whole snapshot refers to. */
  time: number;
  fetchedAt: number;
  aircraft: Aircraft[];
}

export interface AircraftResult {
  snapshot: AircraftSnapshot | null;
  status: AircraftStatus;
  error?: string;
}

/**
 * OpenSky returns each aircraft as a positional array rather than an object.
 * These are the indices this module reads; see the "states" vector in
 * OpenSky's REST docs.
 */
const IDX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  lastContact: 4,
  longitude: 5,
  latitude: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  trueTrack: 10,
  verticalRate: 11,
  geoAltitude: 13,
} as const;

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Parse an OpenSky /states/all response.
 *
 * Deliberately strict about the envelope and lenient about individual
 * aircraft: a single malformed or position-less state (OpenSky sends nulls
 * for aircraft it has heard from but cannot locate) is skipped rather than
 * discarding the whole snapshot.
 */
export function parseStates(payload: unknown): AircraftSnapshot {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("OpenSky response was not an object");
  }
  const body = payload as Record<string, unknown>;

  const time = numberOrNull(body.time);
  if (time === null) {
    throw new Error("OpenSky response had no numeric 'time'");
  }

  // A quiet bounding box legitimately yields null rather than an empty array.
  const states = body.states;
  if (states === null || states === undefined) {
    return { time, fetchedAt: Date.now(), aircraft: [] };
  }
  if (!Array.isArray(states)) {
    throw new Error("OpenSky 'states' was neither an array nor null");
  }

  const aircraft: Aircraft[] = [];
  for (const state of states) {
    if (!Array.isArray(state)) continue;

    const icao24 = state[IDX.icao24];
    const latitude = numberOrNull(state[IDX.latitude]);
    const longitude = numberOrNull(state[IDX.longitude]);
    // Geometric altitude is what we want for a sky position; barometric is a
    // usable stand-in when the geometric figure is absent.
    const altitude = numberOrNull(state[IDX.geoAltitude]) ?? numberOrNull(state[IDX.baroAltitude]);

    if (typeof icao24 !== "string" || latitude === null || longitude === null || altitude === null) {
      continue;
    }

    const callsign = typeof state[IDX.callsign] === "string" ? (state[IDX.callsign] as string).trim() : "";

    aircraft.push({
      icao24,
      callsign: callsign.length > 0 ? callsign : null,
      originCountry: typeof state[IDX.originCountry] === "string" ? (state[IDX.originCountry] as string) : "",
      latitudeDeg: latitude,
      longitudeDeg: longitude,
      altitudeM: altitude,
      velocityMS: numberOrNull(state[IDX.velocity]),
      trueTrackDeg: numberOrNull(state[IDX.trueTrack]),
      verticalRateMS: numberOrNull(state[IDX.verticalRate]),
      onGround: state[IDX.onGround] === true,
      lastContact: numberOrNull(state[IDX.lastContact]) ?? time,
    });
  }

  return { time, fetchedAt: Date.now(), aircraft };
}

/**
 * Bounding box covering `radiusKm` around a point.
 *
 * Longitude degrees shrink with latitude, so the east-west span is widened by
 * 1/cos(latitude) to keep the box genuinely square on the ground. Clamped near
 * the poles, where that factor runs away.
 */
export function boundingBox(latitudeDeg: number, longitudeDeg: number, radiusKm = DEFAULT_RADIUS_KM) {
  const latDelta = radiusKm / 111.32;
  const cosLat = Math.cos((latitudeDeg * Math.PI) / 180);
  const lonDelta = radiusKm / (111.32 * Math.max(cosLat, 0.01));

  return {
    lamin: Math.max(-90, latitudeDeg - latDelta),
    lamax: Math.min(90, latitudeDeg + latDelta),
    lomin: Math.max(-180, longitudeDeg - lonDelta),
    lomax: Math.min(180, longitudeDeg + lonDelta),
  };
}

/**
 * OpenSky credentials, if the operator supplied any.
 *
 * Anonymous access works but carries a small daily credit budget. OpenSky has
 * been migrating from HTTP basic auth to OAuth2 client credentials, so both
 * are supported here and whichever is configured is used — that way this keeps
 * working whichever scheme is current, rather than silently failing if one is
 * retired.
 */
function credentials() {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { kind: "oauth" as const, clientId, clientSecret };

  const username = process.env.OPENSKY_USERNAME?.trim();
  const password = process.env.OPENSKY_PASSWORD?.trim();
  if (username && password) return { kind: "basic" as const, username, password };

  return { kind: "anonymous" as const };
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function oauthToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const res = await fetch(OPENSKY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OpenSky token request failed: ${res.status}`);
  }
  const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof body.access_token !== "string") {
    throw new Error("OpenSky token response had no access_token");
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 1800;
  // Refresh a minute early so a token never expires mid-request.
  cachedToken = { value: body.access_token, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
  return cachedToken.value;
}

async function fetchStates(latitudeDeg: number, longitudeDeg: number, radiusKm: number): Promise<AircraftSnapshot> {
  const box = boundingBox(latitudeDeg, longitudeDeg, radiusKm);
  const params = new URLSearchParams({
    lamin: box.lamin.toFixed(4),
    lomin: box.lomin.toFixed(4),
    lamax: box.lamax.toFixed(4),
    lomax: box.lomax.toFixed(4),
  });

  const headers: Record<string, string> = { "User-Agent": "lookup-satellite-tracker/0.1" };
  const creds = credentials();
  if (creds.kind === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString("base64")}`;
  } else if (creds.kind === "oauth") {
    headers.Authorization = `Bearer ${await oauthToken(creds.clientId, creds.clientSecret)}`;
  }

  const res = await fetch(`${OPENSKY_STATES_URL}?${params.toString()}`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    // 429 is by far the most likely failure for an anonymous caller, so name it.
    const hint = res.status === 429 ? " (rate limit — set OPENSKY_CLIENT_ID/SECRET for a higher quota)" : "";
    throw new Error(`OpenSky request failed: ${res.status}${hint}`);
  }
  return parseStates(await res.json());
}

const cache = new Map<string, AircraftSnapshot>();
const inFlight = new Map<string, Promise<AircraftSnapshot>>();
const failures = new Map<string, { at: number; error: string }>();

/** Collapse nearby observers onto one upstream request. ~0.5 degrees. */
function cacheKey(latitudeDeg: number, longitudeDeg: number, radiusKm: number): string {
  const round = (n: number) => (Math.round(n * 2) / 2).toFixed(1);
  return `${round(latitudeDeg)},${round(longitudeDeg)},${radiusKm}`;
}

/**
 * Aircraft near an observer, or a reason none are available. Never throws.
 */
export async function getAircraft(
  latitudeDeg: number,
  longitudeDeg: number,
  radiusKm = DEFAULT_RADIUS_KM
): Promise<AircraftResult> {
  // Operator-supplied snapshot, mirroring TLE_FILE and WEATHER_FILE: lets the
  // whole feature run air-gapped, and makes a populated UI testable without
  // burning API quota.
  const overridePath = process.env.AIRCRAFT_FILE?.trim();
  if (overridePath) {
    try {
      return { snapshot: parseStates(JSON.parse(readFileSync(overridePath, "utf8"))), status: "live" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { snapshot: null, status: "unavailable", error: `AIRCRAFT_FILE at '${overridePath}': ${message}` };
    }
  }

  const key = cacheKey(latitudeDeg, longitudeDeg, radiusKm);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { snapshot: cached, status: "live" };
  }

  const failure = failures.get(key);
  if (failure && Date.now() - failure.at < FAILURE_TTL_MS) {
    return cached
      ? { snapshot: cached, status: "cache", error: failure.error }
      : { snapshot: null, status: "unavailable", error: failure.error };
  }

  let pending = inFlight.get(key);
  if (!pending) {
    pending = fetchStates(latitudeDeg, longitudeDeg, radiusKm)
      .then((snapshot) => {
        cache.set(key, snapshot);
        failures.delete(key);
        return snapshot;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, pending);
  }

  try {
    return { snapshot: await pending, status: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.set(key, { at: Date.now(), error: message });
    // A stale snapshot beats none: the client dead-reckons from it anyway.
    if (cached) return { snapshot: cached, status: "cache", error: message };
    return { snapshot: null, status: "unavailable", error: message };
  }
}
