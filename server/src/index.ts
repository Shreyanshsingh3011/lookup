import express from "express";
import cors from "cors";
import { getTleGroup, TLE_GROUPS, type TleRecord, type TleSource } from "./celestrak.js";
import type { EpochSpan } from "./elements.js";
import { cloudCoverAt, getCloudForecast, type WeatherStatus } from "./weather.js";
import { computeVisiblePasses, DEFAULT_PASS_OPTIONS } from "./passes.js";
import type { Observer, Pass } from "./types.js";

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

    const passes: Pass[] = [];
    let tooFaintCount = 0;
    let brightestRejected: number | null = null;
    for (const tle of tles) {
      const result = computeVisiblePasses(tle, observer, { days, minElevationDeg, maxMagnitude });
      passes.push(...result.passes);
      tooFaintCount += result.tooFaintCount;
      if (
        result.brightestRejectedMagnitude !== null &&
        (brightestRejected === null || result.brightestRejectedMagnitude < brightestRejected)
      ) {
        brightestRejected = result.brightestRejectedMagnitude;
      }
    }
    passes.sort((a, b) => new Date(a.start.time).getTime() - new Date(b.start.time).getTime());

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

app.listen(PORT, () => {
  console.log(`lookup server listening on http://localhost:${PORT}`);
});
