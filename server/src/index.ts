import express from "express";
import cors from "cors";
import { getTleGroup, TLE_GROUPS, type TleRecord } from "./celestrak.js";
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
    const { tles, fetchedAt, stale } = await getTleGroup(group);
    res.json({ group, count: tles.length, fetchedAt: new Date(fetchedAt).toISOString(), stale, tles });
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
    for (const g of groupKeys) {
      const { tles: groupTles } = await getTleGroup(g);
      for (const t of groupTles) {
        if (seen.has(t.satnum)) continue;
        if (satnumFilter && !satnumFilter.has(t.satnum)) continue;
        seen.add(t.satnum);
        tles.push(t);
      }
    }

    const passes: Pass[] = [];
    for (const tle of tles) {
      passes.push(...computeVisiblePasses(tle, observer, { days, minElevationDeg }));
    }
    passes.sort((a, b) => new Date(a.start.time).getTime() - new Date(b.start.time).getTime());

    res.json({ observer, days, minElevationDeg, satelliteCount: tles.length, passCount: passes.length, passes });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to compute passes" });
  }
});

app.listen(PORT, () => {
  console.log(`lookup server listening on http://localhost:${PORT}`);
});
