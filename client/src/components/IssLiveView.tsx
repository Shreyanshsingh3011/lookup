import { useEffect, useMemo, useState } from 'react';
import {
  NASA_LIVE_EMBED_URL,
  NASA_LIVE_WATCH_URL,
  findIss,
  formatCountdown,
  issSunlight,
} from '../lib/issStream';
import type { TleRecord } from '../types';

/** Re-check illumination on this cadence; the terminator crossing is not urgent. */
const TICK_MS = 15_000;

/**
 * NASA's live view from the International Space Station.
 *
 * The player is not mounted until asked for. An autoloaded YouTube iframe is a
 * heavy third-party frame that opens a connection on every page view, and most
 * visits here are not about watching video.
 *
 * The illumination notice is the reason this is worth building rather than
 * just linking out. The station's external cameras carry no light of their
 * own, so for roughly a third of every orbit the feed is genuinely black. The
 * app already knows the orbit, so it can say "the station is in Earth's shadow,
 * sunrise in 14 minutes" instead of leaving someone to conclude the stream is
 * broken.
 */
export function IssLiveView({ tles }: { tles: TleRecord[] }) {
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const iss = useMemo(() => findIss(tles), [tles]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const sunlight = useMemo(() => (iss ? issSunlight(iss, now) : null), [iss, now]);

  // Without elements for the station there is nothing to be accurate about, so
  // the section stays out of the way entirely.
  if (!iss) return null;

  const dark = sunlight?.sunlit === false;
  const changesAt = sunlight?.changesAt ?? null;

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-space-100">Live from the ISS</h2>
          <p className="text-xs text-space-300">
            NASA's external cameras, 400 km up and moving at 7.7 km/s
          </p>
        </div>
        {!playing && (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-glow-400/50 text-glow-400 hover:bg-glow-400/10 transition-colors"
          >
            Watch live
          </button>
        )}
      </div>

      {sunlight?.sunlit !== null && (
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            dark
              ? 'border-amber-glow/40 bg-amber-glow/5 text-amber-glow'
              : 'border-space-800/80 text-space-300'
          }`}
        >
          {dark ? (
            <>
              <span className="font-semibold">The station is in Earth's shadow.</span> The external
              cameras have no light of their own, so the feed will be black
              {changesAt && <> until orbital sunrise {formatCountdown(now.getTime(), changesAt.getTime())}</>}.
            </>
          ) : (
            <>
              <span className="font-semibold text-space-100">The station is in sunlight.</span>{' '}
              {changesAt ? (
                <>Cameras go dark at orbital sunset {formatCountdown(now.getTime(), changesAt.getTime())}.</>
              ) : (
                <>The cameras should be showing daylit Earth.</>
              )}
            </>
          )}
        </div>
      )}

      {playing ? (
        <div className="rounded-xl overflow-hidden glass-panel">
          <div className="relative w-full aspect-video bg-black">
            <iframe
              className="absolute inset-0 w-full h-full"
              src={NASA_LIVE_EMBED_URL}
              title="Live views from the International Space Station (NASA)"
              // Autoplay is not requested: a video that starts talking on its
              // own is hostile, and mobile browsers block it regardless.
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </div>
      ) : (
        <div className="glass-panel rounded-xl px-4 py-6 text-center">
          <p className="text-xs text-space-300">
            The player is a YouTube embed, so it is only loaded once you ask for it.
          </p>
        </div>
      )}

      <p className="text-[11px] text-space-400 leading-relaxed">
        Streamed by NASA and embedded here, not rehosted — if the player is blocked, watch it{' '}
        <a
          href={NASA_LIVE_WATCH_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-glow-400 hover:underline"
        >
          on NASA's channel
        </a>
        . Coverage is occasionally interrupted for other broadcasts or when the station switches
        data relay satellites. The ISS is the only object here with a live feed: satellites in
        general carry no public downlink, so nothing else offers one.
      </p>
    </section>
  );
}
