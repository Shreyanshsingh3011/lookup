import express from "express";
import cors from "cors";
import * as satellite from "satellite.js";
import { fetchSatelliteByCatnr, getTleGroup, TLE_GROUPS, type TleRecord, type TleSource } from "./celestrak.js";
import { epochSpan, type EpochSpan } from "./elements.js";
import { cloudCoverAt, getCloudForecast, type WeatherStatus } from "./weather.js";
import { getAircraft } from "./aircraft.js";
import { computePassesForMany, DEFAULT_PASS_OPTIONS } from "./passes.js";
import type { Observer } from "./types.js";
import { explainObject, parseExplainSubject } from "./explain.js";
import { adviseOnOrbit, MISSION_TYPES, parseOrbitAdviceRequest } from "./orbitAdvice.js";
import { aiAvailable } from "./ai.js";
import { rateLimit } from "./rateLimit.js";
import { findTrains } from "./starlink.js";
import { getEarthImagery } from "./earthImagery.js";

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/tle/:group", async (req, res) => {
  const { group } = req.params;
  if (!TLE_GROUPS[group]) {
    res.status(404).json({ error: `Unknown group '${group}'. Valid groups: ${Object.keys(TLE_GROUPS).join(", ")}` });
    return;
  }
  try {
    const { tles, fetchedAt, source, epoch } = await getTleGroup(group);
    res.json({
      group,
      count: tles.length,
      fetchedAt: new Date(fetchedAt).toISOString(),
      source,
      epoch,
      tles,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch TLE data" });
  }
});

app.get("/api/tle/satellite/:catnr", async (req, res) => {
  const { catnr } = req.params;
  if (!/^\d{1,9}$/.test(catnr)) {
    res.status(400).json({ error: "NORAD catalog number must be numeric." });
    return;
  }
  try {
    const { tle, source, fetchedAt, epoch } = await fetchSatelliteByCatnr(catnr);
    res.json({ tle, source, fetchedAt: new Date(fetchedAt).toISOString(), epoch });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : `Failed to fetch NORAD ID ${catnr}` });
  }
});

function parseObserver(req: express.Request): Observer | null {
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lon);
  const elevation = req.query.alt !== undefined ? Number(req.query.alt) : 0;
  if (Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(elevation)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, elevation };
}

app.get("/api/passes", async (req, res) => {
  const observer = parseObserver(req);
  if (!observer) {
    res.status(400).json({ error: "Provide valid numeric 'lat' (-90..90), 'lon' (-180..180), and optional 'alt' (meters) query params" });
    return;
  }

  const groupsParam = typeof req.query.groups === "string" ? req.query.groups : "stations";
  const groupKeys = groupsParam.split(",").map((g) => g.trim()).filter(Boolean);
  const satnumFilter = typeof req.query.satnum === "string" ? new Set(req.query.satnum.split(",")) : null;

  const days = req.query.days !== undefined ? Number(req.query.days) : DEFAULT_PASS_OPTIONS.days;
  const minElevationDeg = req.query.minEl !== undefined ? Number(req.query.minEl) : DEFAULT_PASS_OPTIONS.minElevationDeg;

  for (const g of groupKeys) {
    if (!TLE_GROUPS[g]) {
      res.status(404).json({ error: `Unknown group '${g}'. Valid groups: ${Object.keys(TLE_GROUPS).join(", ")}` });
      return;
    }
  }

  try {
    const seen = new Set<string>();
    const tles: TleRecord[] = [];
    // Report the least-trustworthy source across the requested groups.
    let source: TleSource = "live";
    let epoch: EpochSpan | null = null;
    for (const g of groupKeys) {
      const { tles: groupTles, source: groupSource, epoch: groupEpoch } = await getTleGroup(g);
      if (groupSource === "fixture") source = "fixture";
      else if (groupSource === "file") source = "file";
      else if (groupSource === "cache" && source !== "fixture") source = "cache";
      // Report the oldest elements across the requested groups.
      if (groupEpoch && (!epoch || groupEpoch.newestAgeDays > epoch.newestAgeDays)) {
        epoch = groupEpoch;
      }
      for (const t of groupTles) {
        if (seen.has(t.satnum)) continue;
        if (satnumFilter && !satnumFilter.has(t.satnum)) continue;
        seen.add(t.satnum);
        tles.push(t);
      }
    }

    const maxMagnitude =
      req.query.maxMag !== undefined ? Number(req.query.maxMag) : DEFAULT_PASS_OPTIONS.maxMagnitude;

    // Shares one observer-context build (darkness windows, sun-altitude table)
    // across every satellite instead of recomputing it per object.
    const { passes, tooFaintCount, brightestRejectedMagnitude: brightestRejected } =
      computePassesForMany(tles, observer, { days, minElevationDeg, maxMagnitude });

    // Cloud cover is advisory: a forecast failure must not fail the prediction,
    // so this never rejects and passes simply carry a null when it is missing.
    let weatherStatus: WeatherStatus = "unavailable";
    let weatherError: string | undefined;
    if (req.query.weather !== "0") {
      const { forecast, status, error } = await getCloudForecast(observer.latitude, observer.longitude);
      weatherStatus = status;
      weatherError = error;
      for (const pass of passes) {
        pass.cloudCoverPercent = cloudCoverAt(forecast, new Date(pass.max.time));
      }
    }

    res.json({
      observer,
      days,
      minElevationDeg,
      maxMagnitude,
      source,
      epoch,
      satelliteCount: tles.length,
      passCount: passes.length,
      weather: { status: weatherStatus, error: weatherError },
      // Reported so an empty list can explain itself rather than looking broken.
      tooFaintCount,
      brightestRejectedMagnitude: brightestRejected,
      passes,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to compute passes" });
  }
});

/**
 * Starlink trains: the strings of lights that generate more "what was that?"
 * searches than anything else in the sky.
 *
 * Done server-side because it needs the whole Starlink catalogue — thousands
 * of objects — to find the handful still flying in formation. Shipping that to
 * the browser to filter it down to twenty satellites would be absurd, and the
 * group fetch is already cached here.
 */
app.get("/api/starlink/trains", async (req, res) => {
  const observer = parseObserver(req);
  if (!observer) {
    res.status(400).json({ error: "Provide valid numeric 'lat' (-90..90), 'lon' (-180..180), and optional 'alt' (meters) query params" });
    return;
  }
  const days = req.query.days !== undefined ? Number(req.query.days) : 5;

  try {
    const { tles, source, epoch } = await getTleGroup("starlink");
    const trains = findTrains(tles);

    const withPasses = trains.map((train) => {
      // Passes are computed for a few members rather than all of them: the
      // whole point of a train is that they follow the same path minutes
      // apart, so the leader's pass is the train's pass, and propagating
      // sixty near-identical orbits would cost a great deal for nothing.
      const sample = [train.members[0], train.members[Math.floor(train.members.length / 2)]];
      const { passes } = computePassesForMany(sample, observer, {
        days,
        // Trains are low and bright, but the magnitude model is calibrated for
        // single spacecraft and a train is not one — so brightness filtering
        // is left off and the geometry decides.
        maxMagnitude: Infinity,
      });

      return {
        count: train.count,
        leadName: train.members[0].name,
        meanAltitudeKm: Math.round(train.meanAltitudeKm),
        inclinationDeg: Number(train.inclinationDeg.toFixed(2)),
        spreadDeg: Number(train.spreadDeg.toFixed(1)),
        passDurationSeconds: Math.round(train.passDurationSeconds),
        satnums: train.members.map((m) => m.satnum),
        nextPasses: passes.slice(0, 3),
      };
    });

    res.json({
      observer,
      days,
      source,
      epoch,
      catalogueSize: tles.length,
      trainCount: withPasses.length,
      trains: withPasses,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to scan for trains" });
  }
});

/**
 * A recent full-disk view of Earth from whichever geostationary weather
 * satellite actually sees the observer.
 *
 * Server-side because the image hosts have to be probed before being offered —
 * see earthImagery.ts. Never fails the request: an unreachable host reports
 * "unavailable" the same way weather and aircraft do.
 */
app.get("/api/earth-imagery", async (req, res) => {
  const longitude = Number(req.query.lon);
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    res.status(400).json({ error: "Provide a valid numeric 'lon' (-180..180) query param" });
    return;
  }
  const result = await getEarthImagery(longitude);
  res.json(result);
});

app.get("/api/aircraft", async (req, res) => {
  const observer = parseObserver(req);
  if (!observer) {
    res.status(400).json({ error: "Provide valid numeric 'lat' (-90..90), 'lon' (-180..180) query params" });
    return;
  }
  const radiusKm = req.query.radiusKm !== undefined ? Number(req.query.radiusKm) : undefined;
  if (radiusKm !== undefined && (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500)) {
    res.status(400).json({ error: "'radiusKm' must be a number between 0 and 500." });
    return;
  }

  // Never fails the request: an unreachable or rate-limited upstream reports
  // status "unavailable" so the UI can say so, exactly like cloud cover.
  const { snapshot, status, error } = await getAircraft(observer.latitude, observer.longitude, radiusKm);
  res.json({
    observer: { latitude: observer.latitude, longitude: observer.longitude },
    status,
    error,
    time: snapshot?.time ?? null,
    fetchedAt: snapshot ? new Date(snapshot.fetchedAt).toISOString() : null,
    count: snapshot?.aircraft.length ?? 0,
    aircraft: snapshot?.aircraft ?? [],
  });
});

function parseObserverBody(body: unknown): Observer | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const latitude = Number(b.latitude);
  const longitude = Number(b.longitude);
  const elevation = b.elevation !== undefined ? Number(b.elevation) : 0;
  if (Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(elevation)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, elevation };
}

const MAX_CUSTOM_SATELLITES = 20;

/** Server-side re-validation of client-supplied TLEs: never trust that a pasted or fetched TLE actually parses. */
function parseCustomTles(value: unknown): TleRecord[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CUSTOM_SATELLITES) return null;

  const tles: TleRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.name !== "string" ||
      typeof e.satnum !== "string" ||
      typeof e.line1 !== "string" ||
      typeof e.line2 !== "string" ||
      !e.name.trim() ||
      !e.satnum.trim()
    ) {
      return null;
    }
    let rec: satellite.SatRec;
    try {
      rec = satellite.twoline2satrec(e.line1, e.line2);
    } catch {
      return null;
    }
    if (rec.error) return null;
    tles.push({ name: e.name, satnum: e.satnum, line1: e.line1, line2: e.line2 });
  }
  return tles;
}

// Passes for satellites the client supplies directly (a pasted TLE, or one
// looked up by NORAD ID) rather than one of the bundled Celestrak groups.
// Kept as its own route so the well-exercised /api/passes handler above is
// untouched — this one always takes its elements from the request body.
app.post("/api/passes/custom", async (req, res) => {
  const observer = parseObserverBody(req.body?.observer);
  if (!observer) {
    res.status(400).json({ error: "Body must include an 'observer' with numeric latitude (-90..90), longitude (-180..180), and optional elevation." });
    return;
  }

  const tles = parseCustomTles(req.body?.tles);
  if (!tles) {
    res.status(400).json({
      error: `Body must include a 'tles' array of 1-${MAX_CUSTOM_SATELLITES} valid TLE records ({name, satnum, line1, line2}).`,
    });
    return;
  }

  const days = req.body?.days !== undefined ? Number(req.body.days) : DEFAULT_PASS_OPTIONS.days;
  const minElevationDeg =
    req.body?.minElevationDeg !== undefined ? Number(req.body.minElevationDeg) : DEFAULT_PASS_OPTIONS.minElevationDeg;

  try {
    const { passes, tooFaintCount, brightestRejectedMagnitude } = computePassesForMany(tles, observer, {
      days,
      minElevationDeg,
    });

    let weatherStatus: WeatherStatus = "unavailable";
    let weatherError: string | undefined;
    if (req.body?.weather !== false) {
      const { forecast, status, error } = await getCloudForecast(observer.latitude, observer.longitude);
      weatherStatus = status;
      weatherError = error;
      for (const pass of passes) {
        pass.cloudCoverPercent = cloudCoverAt(forecast, new Date(pass.max.time));
      }
    }

    res.json({
      observer,
      days,
      minElevationDeg,
      satelliteCount: tles.length,
      passCount: passes.length,
      weather: { status: weatherStatus, error: weatherError },
      tooFaintCount,
      brightestRejectedMagnitude,
      epoch: epochSpan(tles.map((t) => t.line1)),
      passes,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to compute passes" });
  }
});

// AI calls cost real money per request, so these get their own tighter limit
// than the rest of the API — 20 requests per 5 minutes per IP.
const aiRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 20 });

app.get("/api/ai/status", (_req, res) => {
  res.json({ available: aiAvailable() });
});

app.post("/api/explain", aiRateLimit, async (req, res) => {
  const subject = parseExplainSubject(req.body);
  if (!subject) {
    res.status(400).json({
      error: "Body must have kind ('satellite'|'planet'|'star'), name, elevationDeg, azimuthDeg, direction, plus the fields specific to that kind.",
    });
    return;
  }

  try {
    const result = await explainObject(subject);
    res.json(result);
  } catch (err) {
    // explainObject itself never throws (askGrounded swallows AI failures and
    // falls back to a template) — this only catches something going wrong in
    // the template path itself, which would be a real bug worth seeing.
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build an explanation" });
  }
});

app.post("/api/orbit-advice", aiRateLimit, async (req, res) => {
  const request = parseOrbitAdviceRequest(req.body);
  if (!request) {
    res.status(400).json({
      error:
        `Body must have missionType (one of ${MISSION_TYPES.join(", ")}), missionGoal (non-empty string, max 500 chars), ` +
        "launchSiteLatitudeDeg (-90..90), and timingNotes (string, max 200 chars, or null).",
    });
    return;
  }

  try {
    const result = await adviseOnOrbit(request);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build orbit advice" });
  }
});

// Vercel invokes the exported app directly per-request rather than through a
// bound port, so a real listener is only useful (and only started) locally.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`lookup server listening on http://localhost:${PORT}`);
  });
}

export default app;
