/**
 * What a satellite transmits on.
 *
 * Deliberately not a table typed out from memory. Amateur satellite
 * frequencies change, transponders get switched between modes, and satellites
 * decay — a hardcoded list would be confidently wrong within a year and there
 * is no way for a reader to tell which entries had gone stale. SatNOGS DB is
 * the community-maintained register that everybody else uses, so it is asked
 * rather than second-guessed.
 *
 * The one exception is the ISS, whose three amateur services have been on the
 * same frequencies for years and are the ones people actually look up. Those
 * are bundled so the feature still answers something when the upstream is
 * unreachable, and they are labelled as built-in rather than passed off as
 * live.
 */

const SATNOGS_BASE = "https://db.satnogs.org/api/transmitters/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // frequencies change on the order of months
const FETCH_TIMEOUT_MS = 6000;

export type TransmitterSource = "live" | "cache" | "builtin" | "unavailable";

export interface Transmitter {
  description: string;
  /** Hz, or null for a receive-only or transmit-only service. */
  uplinkHz: number | null;
  downlinkHz: number | null;
  mode: string | null;
  /** Whether the register believes this service is currently working. */
  alive: boolean;
  /** e.g. "Transmitter", "Transceiver", "Transponder". */
  type: string | null;
}

export interface TransmitterResult {
  satnum: string;
  transmitters: Transmitter[];
  source: TransmitterSource;
  error?: string;
}

/**
 * The ISS amateur services, as a fallback only.
 *
 * These three have been stable for years and are the ones people look up:
 * the packet/APRS digipeater, the SSTV downlink, and the voice repeater.
 * Anything else comes from the register or is not shown at all.
 */
const BUILTIN: Record<string, Transmitter[]> = {
  "25544": [
    {
      description: "APRS / packet digipeater",
      uplinkHz: 145_825_000,
      downlinkHz: 145_825_000,
      mode: "FM AFSK 1k2",
      alive: true,
      type: "Transceiver",
    },
    {
      description: "SSTV downlink",
      uplinkHz: null,
      downlinkHz: 145_800_000,
      mode: "FM SSTV",
      alive: true,
      type: "Transmitter",
    },
    {
      description: "Voice repeater (67.0 Hz tone)",
      uplinkHz: 145_990_000,
      downlinkHz: 437_800_000,
      mode: "FM",
      alive: true,
      type: "Transponder",
    },
  ],
};

interface CacheEntry {
  transmitters: Transmitter[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Transmitter[]>>();

interface SatnogsTransmitter {
  description?: string;
  alive?: boolean;
  type?: string;
  uplink_low?: number | null;
  downlink_low?: number | null;
  mode?: string | null;
  status?: string;
}

export function parseSatnogs(payload: unknown): Transmitter[] {
  if (!Array.isArray(payload)) return [];
  const out: Transmitter[] = [];
  for (const raw of payload as SatnogsTransmitter[]) {
    if (!raw || typeof raw !== "object") continue;
    const uplinkHz = Number.isFinite(raw.uplink_low) ? Number(raw.uplink_low) : null;
    const downlinkHz = Number.isFinite(raw.downlink_low) ? Number(raw.downlink_low) : null;
    // A transmitter with neither frequency tells an operator nothing.
    if (uplinkHz === null && downlinkHz === null) continue;
    out.push({
      description: typeof raw.description === "string" && raw.description ? raw.description : "Unnamed service",
      uplinkHz,
      downlinkHz,
      mode: typeof raw.mode === "string" ? raw.mode : null,
      // The register marks dead transmitters rather than deleting them, which
      // is useful: "this used to work" beats an unexplained absence.
      alive: raw.alive !== false && raw.status !== "dead",
      type: typeof raw.type === "string" ? raw.type : null,
    });
  }
  // Working services first, then by downlink, so the useful ones lead.
  return out.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return (a.downlinkHz ?? Infinity) - (b.downlinkHz ?? Infinity);
  });
}

async function fetchFromSatnogs(satnum: string): Promise<Transmitter[]> {
  const url = `${SATNOGS_BASE}?satellite__norad_cat_id=${encodeURIComponent(satnum)}&format=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "lookup-satellite-tracker/0.1" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`SatNOGS returned ${res.status}`);
    return parseSatnogs(await res.json());
  } finally {
    clearTimeout(timer);
  }
}

export async function getTransmitters(satnum: string): Promise<TransmitterResult> {
  const cached = cache.get(satnum);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { satnum, transmitters: cached.transmitters, source: "live" };
  }

  let pending = inFlight.get(satnum);
  if (!pending) {
    pending = fetchFromSatnogs(satnum)
      .then((transmitters) => {
        cache.set(satnum, { transmitters, fetchedAt: Date.now() });
        return transmitters;
      })
      .finally(() => {
        inFlight.delete(satnum);
      });
    inFlight.set(satnum, pending);
  }

  try {
    const transmitters = await pending;
    // An empty answer is a real one: plenty of satellites carry no amateur
    // payload, and saying so beats falling back to something invented.
    return { satnum, transmitters, source: "live" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (cached) return { satnum, transmitters: cached.transmitters, source: "cache" };
    if (BUILTIN[satnum]) return { satnum, transmitters: BUILTIN[satnum], source: "builtin" };
    return {
      satnum,
      transmitters: [],
      source: "unavailable",
      error: `Could not reach the frequency register (${detail}).`,
    };
  }
}
