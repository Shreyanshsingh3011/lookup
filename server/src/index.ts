import express from "express";
import cors from "cors";
import { getTleGroup, TLE_GROUPS, type TleRecord, type TleSource } from "./celestrak.js";
import type { EpochSpan } from "./elements.js";
import { cloudCoverAt, getCloudForecast, type WeatherStatus } from "./weather.js";
import { computePassesForMany, DEFAULT_PASS_OPTIONS } from "./passes.js";
import type { Observer } from "./types.js";
import { explainObject, parseExplainSubject } from "./explain.js";
import { aiAvailable } from "./ai.js";
import { rateLimit } from "./rateLimit.js";

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

app.listen(PORT, () => {
  console.log(`lookup server listening on http://localhost:${PORT}`);
});
