import { classify } from "./debris.js";
import type { TleRecord } from "./celestrak.js";

/**
 * Space-Track: the full public debris catalogue, with elements.
 *
 * CelesTrak publishes four named breakup groups and nothing else, so the app
 * has only ever seen a few thousand fragments out of the tens of thousands
 * catalogued. Space-Track has the rest, but it takes two queries and a join:
 *
 *   satcat  names, declared types, sizes, decay dates — and NO elements
 *   gp      the elements, and almost none of the context
 *
 * Neither is sufficient. satcat can tell you an object exists and how big it
 * is; only gp can tell you where it is. So the object list comes from satcat,
 * its catalogue numbers drive a gp query, and the two are joined on NORAD ID
 * before anything reaches the client.
 *
 * NOTHING FROM HERE IS EVER WRITTEN TO DISK. This repository is public and
 * Space-Track's user agreement restricts redistribution of their catalogue, so
 * the cache below is deliberately in memory only. If you are about to add a
 * disk cache to speed this up: don't. Aggregate figures derived from the data
 * are fine to commit; the responses themselves are not. See .gitignore.
 */

const BASE = "https://www.space-track.org";
const LOGIN_URL = `${BASE}/ajaxauth/login`;
const QUERY = `${BASE}/basicspacedata/query`;

/**
 * Rate limits.
 *
 * Space-Track publishes a fair-use policy; the figures below are the ones I
 * have on record — roughly 30 requests a minute and 300 an hour — and this
 * sandbox cannot reach space-track.org to confirm them. They are therefore
 * treated as upper bounds and the limiter runs well under: a full refresh costs
 * one login plus a handful of chunked queries, a few times a day at most.
 *
 * If you can check the current policy, do, and raise these only to whatever it
 * actually states. Being throttled here means the debris screen silently falls
 * back to the curated set, which is a worse outcome than a slow refresh.
 */
export const RATE_LIMIT_PER_MINUTE = 18;
export const RATE_LIMIT_PER_HOUR = 180;

/** How long a joined catalogue is served before refetching. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * A sliding-window limiter over two horizons at once.
 *
 * Both windows have to be satisfied, because they fail differently: bursting
 * through the per-minute allowance is easy when chunking a large query, while
 * the hourly one is what a badly-set refresh interval would breach.
 */
export class RateLimiter {
  private hits: number[] = [];

  constructor(
    private readonly perMinute = RATE_LIMIT_PER_MINUTE,
    private readonly perHour = RATE_LIMIT_PER_HOUR
  ) {}

  /** Whether a request may go out now, and why not if it may not. */
  check(now = Date.now()): { allowed: true } | { allowed: false; reason: string; retryAfterMs: number } {
    this.hits = this.hits.filter((t) => now - t < 3_600_000);
    const lastMinute = this.hits.filter((t) => now - t < 60_000);

    if (lastMinute.length >= this.perMinute) {
      const oldest = Math.min(...lastMinute);
      return {
        allowed: false,
        reason: `${this.perMinute} requests already made this minute`,
        retryAfterMs: 60_000 - (now - oldest),
      };
    }
    if (this.hits.length >= this.perHour) {
      const oldest = Math.min(...this.hits);
      return {
        allowed: false,
        reason: `${this.perHour} requests already made this hour`,
        retryAfterMs: 3_600_000 - (now - oldest),
      };
    }
    return { allowed: true };
  }

  record(now = Date.now()): void {
    this.hits.push(now);
  }

  /** Requests made in the last hour, for reporting. */
  recentCount(now = Date.now()): number {
    return this.hits.filter((t) => now - t < 3_600_000).length;
  }
}

/**
 * Catalogue numbers, chunked for a URL.
 *
 * Space-Track takes a comma-separated list, but a list of twelve thousand ids
 * is a hundred-kilobyte URL and will be rejected long before it is answered.
 * Chunking is not an optimisation here; without it the query simply fails.
 */
export const IDS_PER_QUERY = 400;

export function chunkIds(ids: string[], size = IDS_PER_QUERY): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export interface SatcatRecord {
  NORAD_CAT_ID: string;
  OBJECT_NAME: string;
  OBJECT_TYPE: string;
  /**
   * Space-Track's operational status flag: "+" operational, "-" nonoperational,
   * "P" partially operational, "B" backup, "S" spare, "X" extended mission,
   * "D" decayed, absent or "?" unknown. The only field that separates a working
   * satellite from a dead one, since both are OBJECT_TYPE=PAYLOAD.
   */
  OPS_STATUS_CODE?: string | null;
  DECAY: string | null;
  RCS_SIZE: string | null;
  COUNTRY: string | null;
  LAUNCH: string | null;
  PERIGEE: string | null;
  APOGEE: string | null;
  INCLINATION: string | null;
}

export interface GpRecord {
  NORAD_CAT_ID: string;
  OBJECT_NAME?: string;
  TLE_LINE1?: string;
  TLE_LINE2?: string;
  EPOCH?: string;
}

/** One object with both halves: context from satcat, elements from gp. */
export interface JoinedObject {
  satnum: string;
  name: string;
  objectType: string;
  /** LARGE / MEDIUM / SMALL, as Space-Track classes it. Often null. */
  rcsSize: string | null;
  country: string | null;
  launchDate: string | null;
  perigeeKm: number | null;
  apogeeKm: number | null;
  inclinationDeg: number | null;
  /** The reason this class exists: elements, in the shape the app already uses. */
  tle: TleRecord;
  epoch: string | null;
}

/**
 * Join satcat context onto gp elements.
 *
 * Inner join on catalogue number, deliberately. An object in satcat with no gp
 * record cannot be propagated and so cannot be drawn — including it with a null
 * element set would push that failure into every consumer. An object in gp with
 * no satcat record is dropped too, since without a declared type it is exactly
 * the guess this integration exists to remove.
 *
 * Catalogue numbers are normalised to the five-character form TLEs carry, so
 * they match everything else in this app. See toAlpha5 in satcat.ts.
 */
export function joinSatcatWithGp(
  satcat: SatcatRecord[],
  gp: GpRecord[],
  normaliseId: (id: string) => string
): { joined: JoinedObject[]; missingElements: number; unmatchedElements: number } {
  const byId = new Map<string, SatcatRecord>();
  for (const rec of satcat) {
    if (rec.NORAD_CAT_ID) byId.set(normaliseId(rec.NORAD_CAT_ID), rec);
  }

  const joined: JoinedObject[] = [];
  const seen = new Set<string>();
  let unmatchedElements = 0;

  for (const el of gp) {
    if (!el.NORAD_CAT_ID || !el.TLE_LINE1 || !el.TLE_LINE2) {
      unmatchedElements++;
      continue;
    }
    const satnum = normaliseId(el.NORAD_CAT_ID);
    const ctx = byId.get(satnum);
    if (!ctx) {
      unmatchedElements++;
      continue;
    }
    seen.add(satnum);

    const num = (v: string | null | undefined) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    joined.push({
      satnum,
      name: (ctx.OBJECT_NAME ?? el.OBJECT_NAME ?? "").trim(),
      objectType: classify(ctx.OBJECT_NAME ?? "", ctx.OBJECT_TYPE).type,
      rcsSize: ctx.RCS_SIZE ?? null,
      country: ctx.COUNTRY ?? null,
      launchDate: ctx.LAUNCH ?? null,
      perigeeKm: num(ctx.PERIGEE),
      apogeeKm: num(ctx.APOGEE),
      inclinationDeg: num(ctx.INCLINATION),
      tle: {
        name: (ctx.OBJECT_NAME ?? "").trim(),
        satnum,
        line1: el.TLE_LINE1.trim(),
        line2: el.TLE_LINE2.trim(),
      },
      epoch: el.EPOCH ?? null,
    });
  }

  return { joined, missingElements: byId.size - seen.size, unmatchedElements };
}

/**
 * Biggest first.
 *
 * The browser cannot propagate twelve thousand objects per frame, so a capped
 * response has to choose. Size is the honest basis: RCS_SIZE is a declared
 * class rather than a derived guess, and a LARGE fragment is both the one worth
 * drawing and the one that matters for collision risk. Objects with no declared
 * size sort last rather than being dropped, since absent is not small.
 */
const SIZE_RANK: Record<string, number> = { LARGE: 0, MEDIUM: 1, SMALL: 2 };

export function rankBySize(objects: JoinedObject[]): JoinedObject[] {
  return [...objects].sort((a, b) => {
    const ra = a.rcsSize ? (SIZE_RANK[a.rcsSize] ?? 3) : 3;
    const rb = b.rcsSize ? (SIZE_RANK[b.rcsSize] ?? 3) : 3;
    if (ra !== rb) return ra - rb;
    // Stable tiebreak so a capped response does not reshuffle between refreshes.
    return a.satnum < b.satnum ? -1 : a.satnum > b.satnum ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Session and fetching
// ---------------------------------------------------------------------------

export function credentialsConfigured(): boolean {
  return Boolean(process.env.SPACETRACK_USER && process.env.SPACETRACK_PASS);
}

let sessionCookie: string | null = null;
const limiter = new RateLimiter();

/**
 * Log in and keep the session cookie.
 *
 * Credentials go in the POST body, never in a query string — a URL ends up in
 * logs, proxies and error messages, and this one would carry a password.
 */
async function login(): Promise<string> {
  const identity = process.env.SPACETRACK_USER;
  const password = process.env.SPACETRACK_PASS;
  if (!identity || !password) throw new Error("SPACETRACK_USER and SPACETRACK_PASS are not set.");

  const gate = limiter.check();
  if (!gate.allowed) throw new Error(`Rate limited before login: ${gate.reason}.`);
  limiter.record();

  const res = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ identity, password }).toString(),
  });
  if (!res.ok) throw new Error(`Space-Track login returned ${res.status} ${res.statusText}.`);

  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error("Space-Track login succeeded but returned no session cookie.");
  // Keep only the name=value pairs; attributes are for a browser, not for us.
  sessionCookie = raw
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .join("; ");
  return sessionCookie;
}

/**
 * One authenticated GET, re-authenticating once if the session has expired.
 *
 * Space-Track answers an expired session with a 401 or a redirect to the login
 * page rather than a clear error, so both are treated as "log in and retry".
 * Exactly one retry: a second failure is a real problem, and looping on it
 * would burn the rate limit that the fallback depends on.
 */
async function authedGet(url: string, allowRetry = true): Promise<unknown> {
  if (!sessionCookie) await login();

  const gate = limiter.check();
  if (!gate.allowed) throw new Error(`Rate limited: ${gate.reason}, retry in ${Math.ceil(gate.retryAfterMs / 1000)}s.`);
  limiter.record();

  const res = await fetch(url, {
    headers: { cookie: sessionCookie!, accept: "application/json" },
    redirect: "manual",
  });

  const expired = res.status === 401 || res.status === 302 || res.status === 303;
  if (expired && allowRetry) {
    sessionCookie = null;
    return authedGet(url, false);
  }
  if (!res.ok) throw new Error(`Space-Track query returned ${res.status} ${res.statusText}.`);

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // An HTML body here almost always means the login page, i.e. a session that
    // expired in a way the status code did not admit to.
    throw new Error("Space-Track returned a non-JSON body; the session is probably not valid.");
  }
}

export interface DebrisCatalogue {
  objects: JoinedObject[];
  /** Everything joined, before any cap was applied. */
  totalJoined: number;
  /** In satcat but with no current element set, so not propagatable. */
  missingElements: number;
  source: "live" | "cache" | "unavailable";
  fetchedAt: number | null;
  requestsLastHour: number;
  error?: string;
}

let cache: { catalogue: DebrisCatalogue; fetchedAt: number } | null = null;

/**
 * The joined debris catalogue.
 *
 * Never throws, and never queries Space-Track on the request path when a cached
 * copy is usable — one refresh serves every visitor for six hours. A failure at
 * any stage returns source "unavailable" with the reason, and the caller falls
 * back to the curated four clouds and eight derelicts, which is a smaller true
 * answer rather than a broken screen.
 */
/**
 * Every current element set, in one request where possible.
 *
 * The bulk form asks gp for everything still in orbit and keeps the rows that
 * match the objects wanted, which trades a slightly larger response for two
 * requests instead of forty-odd. If it fails for any reason — URL rejected,
 * response truncated, a shape change at the far end — the id-chunked form still
 * works, so that is tried rather than giving up on the catalogue entirely.
 *
 * Both paths are rate-limited through the same limiter, so the fallback cannot
 * quietly exceed what the bulk path was avoiding; it will fail loudly instead.
 */
async function fetchElements(wanted: SatcatRecord[]): Promise<GpRecord[]> {
  const ids = wanted.map((r) => r.NORAD_CAT_ID).filter(Boolean);
  const keep = new Set(ids);

  try {
    const all = (await authedGet(
      `${QUERY}/class/gp/decay_date/null-val/orderby/NORAD_CAT_ID/format/json`
    )) as GpRecord[];
    if (!Array.isArray(all) || all.length === 0) throw new Error("gp returned no rows.");
    const matched = all.filter((r) => keep.has(String(r.NORAD_CAT_ID)));
    if (matched.length === 0) throw new Error("gp returned rows but none matched the object list.");
    return matched;
  } catch {
    const gp: GpRecord[] = [];
    for (const chunk of chunkIds(ids)) {
      const part = (await authedGet(
        `${QUERY}/class/gp/NORAD_CAT_ID/${chunk.join(",")}/format/json`
      )) as GpRecord[];
      if (Array.isArray(part)) gp.push(...part);
    }
    return gp;
  }
}

/**
 * Everything in orbit that is not a working satellite.
 *
 * Fragments and spent stages were never spacecraft, so type settles them. A
 * payload needs the catalogue to actually say it is dead: "-" is
 * nonoperational, and that is the only claim Space-Track makes here. Backup and
 * spare are dormant but alive, extended mission is still working past its
 * planned span, and an absent status is an absent answer — inferring death from
 * silence would put thousands of live satellites in the derelict field, which is
 * exactly the kind of invention this whole layer exists to avoid.
 *
 * OBJECT_TYPE=UNKNOWN and TBA are excluded for the same reason: the catalogue
 * has not said what they are, and "probably debris" is a guess. That leaves a
 * known gap rather than a wrong answer, which is the right way round.
 *
 * This mirrors isDerelictByStatus in satcat.ts, which decides the same question
 * from the CSV catalogue. Deliberately the same rule in both places.
 */
export function nonActive(rows: SatcatRecord[]): SatcatRecord[] {
  return rows.filter((r) => {
    const type = (r.OBJECT_TYPE ?? "").trim().toUpperCase();
    if (type === "ROCKET BODY" || type === "DEBRIS") return true;
    if (type !== "PAYLOAD") return false;
    return (r.OPS_STATUS_CODE ?? "").trim() === "-";
  });
}

export async function getSpaceTrackDebris(
  normaliseId: (id: string) => string,
  limit = 900
): Promise<DebrisCatalogue> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ...cache.catalogue, objects: cache.catalogue.objects.slice(0, limit), source: "cache" };
  }

  if (!credentialsConfigured()) {
    return {
      objects: [],
      totalJoined: 0,
      missingElements: 0,
      source: "unavailable",
      fetchedAt: null,
      requestsLastHour: limiter.recentCount(),
      error: "Space-Track credentials are not configured; using the curated set.",
    };
  }

  try {
    // 1. Object list. DECAY/null-val keeps what is still in orbit rather than
    //    the ~35,800 ever catalogued — two thirds of that file is history.
    //
    //    No OBJECT_TYPE filter. There was one, pinned to DEBRIS, and it was
    //    wrong: Space-Track files spent stages as ROCKET BODY and dead
    //    satellites as PAYLOAD, so a DEBRIS-only query returned fragments and
    //    silently excluded every derelict a person could actually go outside
    //    and see. The dome was left showing whichever stages happened to be in
    //    the user's selected CelesTrak groups — around ninety with "visual"
    //    chosen, and exactly the eight curated ones without it — while a status
    //    line claimed to be plotting the catalogue.
    const satcat = (await authedGet(
      `${QUERY}/class/satcat/DECAY/null-val/orderby/NORAD_CAT_ID/format/json`
    )) as SatcatRecord[];
    if (!Array.isArray(satcat) || satcat.length === 0) throw new Error("satcat returned no rows.");

    // 2. Elements. One request for every current element set, not one per
    //    chunk of ids.
    //
    //    This used to ask for elements by id, 400 at a time. At the old
    //    DEBRIS-only size that was 32 requests; widened to stages and dead
    //    payloads it is well over forty, and that does not merely get slower —
    //    it stops working twice over. The limiter allows 18 requests a minute
    //    and throws rather than waiting, so the refresh dies partway through;
    //    and a refresh happens on whichever user request finds the cache cold,
    //    inside a serverless invocation with a timeout measured in seconds.
    //
    //    gp filtered on decay_date/null-val returns every in-orbit element set
    //    in a single response, so the whole fetch is two requests regardless of
    //    catalogue size. The id-chunked path is kept below as a fallback,
    //    because a URL-length or response-size failure on the bulk form should
    //    degrade to the slow route rather than to nothing.
    const wanted = nonActive(satcat);
    if (wanted.length === 0) throw new Error("satcat returned no non-active objects.");
    const gp = await fetchElements(wanted);

    // 3. Join, then rank so a capped response keeps the largest objects.
    const { joined, missingElements } = joinSatcatWithGp(wanted, gp, normaliseId);
    if (joined.length === 0) throw new Error("satcat and gp produced no joined objects.");

    const catalogue: DebrisCatalogue = {
      objects: rankBySize(joined),
      totalJoined: joined.length,
      missingElements,
      source: "live",
      fetchedAt: now,
      requestsLastHour: limiter.recentCount(),
    };
    cache = { catalogue, fetchedAt: now };
    return { ...catalogue, objects: catalogue.objects.slice(0, limit) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Stale beats absent, but only when it is labelled as stale.
    if (cache) {
      return {
        ...cache.catalogue,
        objects: cache.catalogue.objects.slice(0, limit),
        source: "cache",
        error: `Refresh failed, serving cached data: ${message}`,
      };
    }
    return {
      objects: [],
      totalJoined: 0,
      missingElements: 0,
      source: "unavailable",
      fetchedAt: null,
      requestsLastHour: limiter.recentCount(),
      error: message,
    };
  }
}

/** Test seam: drop the cached session and catalogue. */
export function resetSpaceTrackState(): void {
  sessionCookie = null;
  cache = null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface CatalogueQuery {
  /** Free text, matched against the name and the catalogue number. */
  q?: string;
  /** PAYLOAD / ROCKET BODY / DEBRIS / UNKNOWN. */
  type?: string;
  /** LARGE / MEDIUM / SMALL. */
  size?: string;
  limit?: number;
}

export const SEARCH_LIMIT = 60;

/**
 * Search the cached catalogue.
 *
 * A pure filter over data already in memory, deliberately. Searching must never
 * reach Space-Track: a query per keystroke would breach their fair-use policy
 * within seconds, and the answer is already local — one refresh serves every
 * search for six hours.
 *
 * Results are capped because they exist to be looked at and chosen from. The
 * dome takes objects one at a time by design; handing back thousands would
 * invite exactly the "add everything" gesture that the cap on the dome side
 * then has to refuse.
 */
export function searchCatalogue(objects: JoinedObject[], query: CatalogueQuery): JoinedObject[] {
  const text = query.q?.trim().toUpperCase() ?? "";
  const type = query.type?.trim().toUpperCase();
  const size = query.size?.trim().toUpperCase();
  const limit = Math.min(query.limit ?? SEARCH_LIMIT, SEARCH_LIMIT);

  const matches: JoinedObject[] = [];
  for (const obj of objects) {
    if (type && obj.objectType.toUpperCase() !== type) continue;
    if (size && (obj.rcsSize ?? "").toUpperCase() !== size) continue;
    if (text) {
      // Catalogue number matched without padding too, since that is how people
      // read them out and how Space-Track itself writes them.
      const num = String(Number(obj.satnum.replace(/^0+/, "")) || obj.satnum);
      if (!obj.name.toUpperCase().includes(text) && !obj.satnum.includes(text) && !num.includes(text)) {
        continue;
      }
    }
    matches.push(obj);
    if (matches.length >= limit) break;
  }
  return matches;
}

/** Object types and sizes actually present, so a picker offers only real options. */
export function catalogueFacets(objects: JoinedObject[]): { types: string[]; sizes: string[] } {
  const types = new Set<string>();
  const sizes = new Set<string>();
  for (const o of objects) {
    types.add(o.objectType);
    if (o.rcsSize) sizes.add(o.rcsSize);
  }
  return {
    types: [...types].sort(),
    // Size is ordinal, not alphabetical — LARGE before MEDIUM before SMALL.
    sizes: ["LARGE", "MEDIUM", "SMALL"].filter((s) => sizes.has(s)),
  };
}

/**
 * The whole cached catalogue, for searching over.
 *
 * Separate from getSpaceTrackDebris because that caps its result for the dome,
 * and a search has to see everything the cache holds.
 */
export async function getFullCatalogue(
  normaliseId: (id: string) => string
): Promise<DebrisCatalogue> {
  return getSpaceTrackDebris(normaliseId, Number.MAX_SAFE_INTEGER);
}
