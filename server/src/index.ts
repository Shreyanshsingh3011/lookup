import express from "express";
import cors from "cors";
import * as satellite from "satellite.js";
import {
  fetchSatelliteByCatnr,
  getTleGroup,
  MIN_SEARCH_LENGTH,
  parseTle,
  SATELLITE_GROUPS,
  SEARCH_RESULT_LIMIT,
  searchSatellitesByName,
  TLE_GROUPS,
  type TleRecord,
  type TleSource,
} from "./celestrak.js";
import { epochSpan, type EpochSpan } from "./elements.js";
import { cloudCoverAt, getCloudForecast, type WeatherStatus } from "./weather.js";
import { getAircraft } from "./aircraft.js";
import {
  computePassesForMany,
  DEFAULT_PASS_OPTIONS,
  MAX_SCANNED_SATELLITES,
  rankForVisibility,
} from "./passes.js";
import type { Observer } from "./types.js";
import { explainObject, parseExplainSubject } from "./explain.js";
import { adviseOnOrbit, MISSION_TYPES, parseOrbitAdviceRequest } from "./orbitAdvice.js";
import { aiAvailable } from "./ai.js";
import { rateLimit } from "./rateLimit.js";
import { findTrains } from "./starlink.js";
import { getEarthImagery, probeCandidates } from "./earthImagery.js";
import { getTransmitters } from "./radio.js";
import { getSmallBodies } from "./smallBodies.js";
import { getSatcatForGroup, isDerelictByStatus, toAlpha5 } from "./satcat.js";
import {
  catalogueFacets,
  credentialsConfigured,
  getFullCatalogue,
  getSpaceTrackDebris,
  searchCatalogue,
  SEARCH_LIMIT,
} from "./spacetrack.js";
import { buildRouteIndex } from "./routes.js";
import {
  classify,
  DEBRIS_CLOUDS,
  filterByReach,
  findCloudParent,
  NOTABLE_DERELICTS,
  statusFromError,
  type ResolvedDerelict,
} from "./debris.js";

const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

/**
 * What this server actually serves.
 *
 * Additive: /api/health is unchanged and stays the liveness check. This exists
 * so that finding out whether an endpoint is live does not require guessing
 * its path, where a wrong guess reads as a broken service.
 *
 * Registered last, after every other route, so the index it walks is complete.
 * Both spellings answer because both are the obvious thing to try.
 */
const routeIndex = (_req: express.Request, res: express.Response) => {
  res.json(buildRouteIndex(app));
};

/**
 * The catalogue the picker is built from.
 *
 * Served rather than duplicated in the client so adding a group is a one-file
 * change, and so the two can never disagree about what a group id means — an
 * id that appears in a shared permalink has to keep meaning the same thing.
 */
app.get("/api/groups", (_req, res) => {
  res.json({ groups: SATELLITE_GROUPS, maxScannedSatellites: MAX_SCANNED_SATELLITES });
});

app.get("/api/satellites/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < MIN_SEARCH_LENGTH) {
    res.status(400).json({
      error: `Search needs at least ${MIN_SEARCH_LENGTH} characters — shorter queries match most of the catalogue.`,
    });
    return;
  }
  try {
    const { tles, truncated, source, epoch } = await searchSatellitesByName(query);
    res.json({ query, count: tles.length, truncated, limit: SEARCH_RESULT_LIMIT, source, epoch, tles });
  } catch (err) {
    // The upstream status code means nothing to someone typing a satellite
    // name, so say what happened and point at the route that does not depend
    // on search being up.
    const detail = err instanceof Error ? err.message : String(err);
    res.status(502).json({
      error:
        `Could not reach the catalogue to search for '${query}'. ` +
        `If you know the NORAD catalog number you can still add it directly. (${detail})`,
    });
  }
});

app.get("/api/tle/:group", async (req, res) => {
  const { group } = req.params;
  if (!TLE_GROUPS[group]) {
    res.status(404).json({ error: `Unknown group '${group}'. Valid groups: ${Object.keys(TLE_GROUPS).join(", ")}` });
    return;
  }
  // A group like Starlink is eight thousand objects — over a megabyte of JSON,
  // and every one of them propagated in the browser on each frame of the sky
  // dome. Callers that only intend to draw them say how many they can take, and
  // the brightest are the ones kept, since the rest would be invisible anyway.
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : null;

  try {
    const { tles: all, fetchedAt, source, epoch } = await getTleGroup(group);
    const { scanned: tles, skipped } = limit ? rankForVisibility(all, limit) : { scanned: all, skipped: 0 };
    res.json({
      group,
      count: tles.length,
      catalogueCount: all.length,
      omittedCount: skipped,
      fetchedAt: new Date(fetchedAt).toISOString(),
      source,
      epoch,
      tles,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to fetch TLE data" });
  }
});

/**
 * The two debris collections, which are deliberately separate.
 *
 * Clouds are named breakup events fetched wholesale as groups; derelicts are
 * individually notable objects fetched one at a time. Only the catalogue of
 * clouds is returned here — their several thousand fragments each are fetched
 * on demand, since loading them by default is exactly what this screen is
 * built to avoid.
 */
app.get("/api/debris/catalogue", async (_req, res) => {
  const results = await Promise.all(
    NOTABLE_DERELICTS.map(async (entry): Promise<ResolvedDerelict> => {
      try {
        const { tle } = await fetchSatelliteByCatnr(entry.satnum);
        return { entry, status: "resolved", tle };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A catalogue number that no longer resolves is a normal outcome for
        // this screen, not an error: things reenter.
        return { entry, status: statusFromError(message), tle: null, error: message };
      }
    })
  );

  res.json({
    clouds: DEBRIS_CLOUDS,
    derelicts: results,
    resolvedCount: results.filter((r) => r.status === "resolved").length,
  });
});

/**
 * One breakup cloud's fragments.
 *
 * Explicitly requested rather than loaded with the screen: the largest of
 * these is still close to two thousand objects. The clouds have shrunk a lot
 * since their peaks — see peakCatalogued — so no fixed figure is quoted here
 * that would drift out of date on its own.
 */
app.get("/api/debris/cloud/:id", async (req, res) => {
  const cloud = DEBRIS_CLOUDS.find((c) => c.id === req.params.id);
  if (!cloud) {
    res.status(404).json({
      error: `Unknown debris cloud '${req.params.id}'. Known clouds: ${DEBRIS_CLOUDS.map((c) => c.id).join(", ")}.`,
    });
    return;
  }
  try {
    const { tles, source, epoch, fetchedAt } = await getTleGroup(cloud.celestrakGroup);
    const objectTypes = tles.map((t) => classify(t.name).type);

    // The object that broke up, found in the data rather than remembered.
    //
    // Three of the four groups still carry their parent payload alongside the
    // fragments, so it can be identified by classification instead of being
    // written down — which is the difference between a fact and a claim. Where
    // the parent has reentered or was never in the group, this is null and the
    // screen simply does not mention it.
    const parent = findCloudParent(cloud, tles);

    res.json({
      cloud,
      count: tles.length,
      parent,
      // Reported so the screen can say what it is looking at rather than
      // assuming every member of a debris group is debris — the parent body
      // and its rocket stage are often catalogued in the same group.
      typeCounts: objectTypes.reduce<Record<string, number>>((acc, type) => {
        acc[type] = (acc[type] ?? 0) + 1;
        return acc;
      }, {}),
      source,
      epoch,
      fetchedAt: new Date(fetchedAt).toISOString(),
      tles,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : `Could not load ${cloud.label}` });
  }
});

/**
 * Every fragment CelesTrak will serve without an account.
 *
 * The dome's point field was built against Space-Track, which needs
 * credentials, and without them it drew nothing at all — a layer advertising
 * the whole catalogue and delivering an empty sky. CelesTrak publishes the four
 * tracked breakup clouds to anyone, and the app already fetches them one at a
 * time for the debris screen. Merged, they are a few thousand real, current,
 * propagatable objects available to every visitor with no configuration.
 *
 * This is deliberately not presented as the full catalogue, because it is not:
 * it is fragments from four named events, with no spent stages and no dead
 * payloads beyond whichever parent bodies are still catalogued alongside their
 * debris. The full ~17,000 still needs Space-Track. What this removes is the
 * case where the honest answer was nothing at all.
 *
 * Fetched through the same cached group fetcher as everything else, so four
 * groups cost four upstream requests at most once per cache period.
 */
app.get("/api/debris/field", async (_req, res) => {
  const cloudResults = await Promise.all(
    DEBRIS_CLOUDS.map(async (cloud) => {
      try {
        const { tles, source } = await getTleGroup(cloud.celestrakGroup);
        return { id: cloud.id, label: cloud.label, count: tles.length, source, tles };
      } catch (err) {
        return {
          id: cloud.id,
          label: cloud.label,
          count: 0,
          source: "unavailable" as const,
          error: err instanceof Error ? err.message : "fetch failed",
          tles: [] as TleRecord[],
        };
      }
    })
  );

  // The rest of the non-active catalogue, from the one bulk file CelesTrak
  // serves without an account.
  //
  // Its group is called "active", which is not what it holds: 16,103 objects
  // whose very first entry is Calsphere 1, a passive calibration sphere from
  // 1964. It is closer to "everything CelesTrak tracks that is not fragment
  // debris" — thousands of spent stages among the working satellites. Those
  // stages are exactly what the field was missing, so they are taken by
  // classification rather than by trusting the group's name, and the working
  // payloads are left out.
  let derelicts: TleRecord[] = [];
  let activeSource = "unavailable";
  let activeTotal = 0;
  try {
    const { tles, source } = await getTleGroup("active");
    activeTotal = tles.length;
    activeSource = source;
    derelicts = tles.filter((t) => {
      const type = classify(t.name).type;
      return type === "ROCKET BODY" || type === "DEBRIS";
    });
  } catch {
    activeSource = "unavailable";
  }

  const results = [
    ...cloudResults,
    {
      id: "non-active",
      label: "Spent stages and other debris",
      count: derelicts.length,
      source: activeSource,
      tles: derelicts,
    },
  ];

  // Deduplicated across groups. The clouds are disjoint by construction, but a
  // parent body catalogued in two of them would otherwise be propagated twice.
  const seen = new Set<string>();
  const tles: TleRecord[] = [];
  for (const r of results) {
    for (const t of r.tles) {
      if (seen.has(t.satnum)) continue;
      seen.add(t.satnum);
      tles.push(t);
    }
  }

  // The weakest source present, not the best one.
  //
  // Four groups can answer four different ways, and reporting "live" because
  // one of them was would overstate the other three — a fixture is a fallback,
  // not fresh data, and the caller has to be able to tell.
  const failed = results.filter((r) => r.source === "unavailable");
  const rank = ["unavailable", "fixture", "file", "cache", "live"];
  const weakest = results.reduce(
    (worst, r) => (rank.indexOf(r.source) < rank.indexOf(worst) ? r.source : worst),
    "live" as string
  );

  res.json({
    count: tles.length,
    // Per-cloud, so a partial answer says which part is missing rather than
    // quietly returning a smaller number.
    clouds: results.map(({ id, label, count, source }) => ({ id, label, count, source })),
    source:
      failed.length === results.length ? "unavailable" : failed.length > 0 ? "partial" : weakest,
    tles,
  });
});

/**
 * The full public debris catalogue, joined from Space-Track.
 *
 * satcat says what an object is; only gp says where it is. This returns both,
 * joined on catalogue number server-side, so the client gets element sets it
 * can actually propagate rather than metadata it cannot place.
 *
 * Cached for hours and never queried on the request path, both to respect
 * Space-Track's fair-use policy and because a debris catalogue does not change
 * minute to minute. Without credentials, or on any failure, this reports
 * "unavailable" and the screen falls back to the curated clouds and derelicts.
 */
app.get("/api/spacetrack/debris", async (req, res) => {
  const requested = Number(req.query.limit);
  // No practical cap. The dome draws the bulk population as a single point
  // field — one geometry, one draw call — so it can hold the whole catalogue,
  // which is why the earlier 5,000 ceiling existed only for a caller that had
  // to make a marker per object.
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 40_000) : 900;

  const result = await getSpaceTrackDebris(toAlpha5, limit);
  res.json({
    count: result.objects.length,
    totalJoined: result.totalJoined,
    missingElements: result.missingElements,
    source: result.source,
    configured: credentialsConfigured(),
    fetchedAt: result.fetchedAt ? new Date(result.fetchedAt).toISOString() : null,
    requestsLastHour: result.requestsLastHour,
    error: result.error,
    objects: result.objects,
  });
});

/**
 * Search the full non-active catalogue.
 *
 * Serves from the same cached join as the route above, so a search costs
 * Space-Track nothing — a query per keystroke would breach their fair-use
 * policy in seconds, and the answer is already in memory.
 *
 * Results are capped, and deliberately: they exist to be read and chosen from
 * one at a time. Handing back thousands would invite the "add everything"
 * gesture that the dome then has to refuse anyway, at which point the refusal
 * is a worse experience than never offering it.
 */
app.get("/api/spacetrack/search", async (req, res) => {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const catalogue = await getFullCatalogue(toAlpha5);

  if (catalogue.source === "unavailable") {
    res.json({
      results: [],
      count: 0,
      limit: SEARCH_LIMIT,
      searchable: 0,
      facets: { types: [], sizes: [] },
      source: catalogue.source,
      configured: credentialsConfigured(),
      error: catalogue.error,
    });
    return;
  }

  const results = searchCatalogue(catalogue.objects, {
    q: str(req.query.q),
    type: str(req.query.type),
    size: str(req.query.size),
  });

  res.json({
    results,
    count: results.length,
    limit: SEARCH_LIMIT,
    searchable: catalogue.objects.length,
    facets: catalogueFacets(catalogue.objects),
    source: catalogue.source,
    configured: true,
  });
});

/**
 * Catalogue metadata for one group: object type and operational status.
 *
 * Element sets say where something is, never whether it still works. Without
 * this the sky dome can only classify by name, which proves a spent stage but
 * can never prove a dead payload — Envisat and ERS-1 are derelict and nothing
 * in their names says so.
 *
 * Additive and non-fatal. An unreachable SATCAT returns an empty list with
 * source "unavailable", and the caller keeps classifying by name exactly as
 * before rather than losing the distinction or failing the request.
 */
app.get("/api/satcat/:group", async (req, res) => {
  const { entries, source, fetchedAt, endpoint, error, attempts } = await getSatcatForGroup(
    req.params.group
  );
  res.json({
    group: req.params.group,
    count: entries.length,
    source,
    endpoint,
    fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
    error,
    attempts,
    // Precomputed so the client does not have to re-encode the status rules.
    derelictCount: entries.filter(isDerelictByStatus).length,
    entries,
  });
});

/**
 * Comets and asteroids bright enough to look for.
 *
 * Never fails: an unreachable JPL falls back to a few long-known asteroids and
 * says so, rather than leaving the sky empty with no explanation.
 */
app.get("/api/small-bodies", async (_req, res) => {
  res.json(await getSmallBodies());
});

/**
 * Amateur radio services for a satellite.
 *
 * Never fails the request: an unreachable register reports itself so the
 * Doppler figures, which are computed from the orbit and do not depend on it,
 * can still be shown against a frequency the operator types in themselves.
 */
app.get("/api/radio/:catnr", async (req, res) => {
  const { catnr } = req.params;
  if (!/^\d{1,9}$/.test(catnr)) {
    res.status(400).json({ error: "NORAD catalog number must be numeric." });
    return;
  }
  res.json(await getTransmitters(catnr));
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
    const message = err instanceof Error ? err.message : `Failed to fetch NORAD ID ${catnr}`;
    // A catalogue number that does not exist is a fact about the object, not a
    // failure of the gateway. Objects are struck from the catalogue constantly
    // as they reenter, so a stale bookmark or an old logbook entry pointing at
    // one is an ordinary thing to happen and gets an ordinary 404.
    if (statusFromError(message) === "not-in-catalogue") {
      res.status(404).json({
        error: `NORAD ID ${catnr} is not in the catalogue. It may have reentered — objects are removed when they do.`,
        catnr,
        reason: "not-in-catalogue",
      });
      return;
    }
    res.status(502).json({ error: message, catnr, reason: "unavailable" });
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

    // Two stages, in this order because they cut different things. First the
    // geometry: an orbit whose ground track never reaches this latitude can
    // never rise here, which two fields decide with no propagation at all.
    // Then brightness, which is what actually bounds the cost once a debris
    // group's several thousand objects all turn out to pass overhead.
    const reach = filterByReach(tles, observer.latitude);
    const { scanned, skipped } = rankForVisibility(reach.candidates);

    // Shares one observer-context build (darkness windows, sun-altitude table)
    // across every satellite instead of recomputing it per object.
    const { passes, tooFaintCount, brightestRejectedMagnitude: brightestRejected } =
      computePassesForMany(scanned, observer, { days, minElevationDeg, maxMagnitude });

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
      satelliteCount: scanned.length,
      /** Everything the chosen groups contain, before the scan cap. */
      catalogueCount: tles.length,
      /** Objects that can never rise at this latitude, rejected before propagating. */
      unreachableCount: reach.skipped,
      /** Objects dropped by the brightness cap, ranked out as the faintest candidates. */
      notScannedCount: skipped,
      maxScannedSatellites: MAX_SCANNED_SATELLITES,
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
  // ?probe=1 reports the raw outcome for every candidate URL. Which of these
  // public image paths are actually correct cannot be checked from a
  // development sandbox that has no route to the imagery hosts, so production
  // needs to be able to answer it.
  if (req.query.probe === "1") {
    res.json({ longitude, candidates: await probeCandidates(longitude) });
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

// Mounted here, below every other route, because the index walks the router's
// own table and has to be registered after everything it is meant to list.
app.get("/api", routeIndex);
app.get("/api/routes", routeIndex);

// Vercel invokes the exported app directly per-request rather than through a
// bound port, so a real listener is only useful (and only started) locally.
// LOOKUP_NO_LISTEN lets the route-index test import this module for its router
// table without leaving a listening socket that keeps the test process alive.
if (!process.env.VERCEL && !process.env.LOOKUP_NO_LISTEN) {
  app.listen(PORT, () => {
    console.log(`lookup server listening on http://localhost:${PORT}`);
  });
}

export default app;
