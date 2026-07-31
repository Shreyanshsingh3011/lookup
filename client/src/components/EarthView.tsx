import { useEffect, useState } from 'react';
import { fetchEarthImagery } from '../api/client';
import {
  describeFrameAge,
  frameIsStale,
  type EarthImageryResponse,
} from '../lib/earthImagery';
import type { Observer } from '../types';

/**
 * Earth from a geostationary weather satellite.
 *
 * Opt-in, because the full-disk frames are several megabytes and most visits
 * here are about the sky overhead rather than the planet underneath.
 *
 * The word "live" is deliberately absent. A full-disk scan takes ten minutes,
 * so the newest frame is typically ten to twenty minutes old; the panel says
 * how old, whenever the host tells us.
 */
export function EarthView({ observer }: { observer: Observer }) {
  const [result, setResult] = useState<EarthImageryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A new location may well be a different satellite's hemisphere.
  useEffect(() => {
    setResult(null);
    setImageFailed(false);
  }, [observer.longitude]);

  const load = () => {
    setLoading(true);
    setError(null);
    setImageFailed(false);
    fetchEarthImagery(observer.longitude)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load Earth imagery'))
      .finally(() => setLoading(false));
  };

  const image = result?.image ?? null;
  const age = image ? describeFrameAge(image.frameTime, now) : null;
  const stale = image ? frameIsStale(image.frameTime, now) : false;

  return (
    <section className="flex flex-col gap-2 print:hidden">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-space-100">Earth from above</h2>
          <p className="text-xs text-space-300">
            Full-disk imagery from the weather satellite that can see you
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs font-semibold px-3 py-1.5 rounded-md border border-glow-400/50 text-glow-400 hover:bg-glow-400/10 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading…' : result ? 'Refresh' : 'Show Earth'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-glow/40 bg-amber-glow/5 px-4 py-3 text-xs text-amber-glow">
          {error}
        </div>
      )}

      {result && !image && (
        <div className="glass-panel rounded-xl px-4 py-3 text-xs text-space-300">
          {result.error ?? 'No imagery available for your longitude right now.'}
          {result.unreachable.length > 0 && (
            <> Tried: {result.unreachable.join(', ')}.</>
          )}
        </div>
      )}

      {image && (
        <figure className="glass-panel rounded-xl overflow-hidden">
          {imageFailed ? (
            <div className="px-4 py-8 text-center text-xs text-space-300">
              The image host confirmed the frame but the picture would not load — it may be
              blocked on this network.{' '}
              <a
                href={image.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-glow-400 hover:underline"
              >
                Open it directly
              </a>
              .
            </div>
          ) : (
            <img
              // checkedAt busts the browser cache when the panel is refreshed,
              // without which "Refresh" would silently redisplay the old frame.
              src={`${image.url}?t=${encodeURIComponent(image.checkedAt)}`}
              alt={`Full-disk view of Earth from ${image.name}`}
              className="w-full h-auto bg-black"
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          )}
          <figcaption className="px-4 py-3 flex flex-wrap gap-x-4 gap-y-1 items-baseline">
            <span className="text-sm font-semibold text-space-100">{image.name}</span>
            <span className="text-[11px] text-space-300 font-mono">
              {Math.abs(image.longitudeDeg).toFixed(1)}°{image.longitudeDeg < 0 ? 'W' : 'E'} ·
              geostationary
            </span>
            <span className={`text-[11px] ml-auto ${stale ? 'text-amber-glow' : 'text-space-300'}`}>
              {age ? `Frame ${age}` : 'Latest available frame'}
              {stale && ' — this feed looks stalled'}
            </span>
            {image.nearLimb && (
              <p className="basis-full text-[11px] text-space-400">
                You are {image.observerSeparationDeg.toFixed(0)}° round from this satellite's
                viewpoint, so your own region sits near the edge of the disk and is heavily
                foreshortened.
              </p>
            )}
          </figcaption>
        </figure>
      )}

      {result && (
        <p className="text-[11px] text-space-400 leading-relaxed">
          {image?.product}. Imagery, not video: a full-disk scan takes about ten minutes, so the
          newest frame is usually ten to twenty minutes behind. Served directly from{' '}
          {image?.operator ?? 'the imagery host'} and not rehosted here. Coverage is currently the
          two GOES satellites — the Americas, the Pacific, the Atlantic and western Europe; no
          public full-disk feed has been found for the Meteosat and Himawari regions yet.
        </p>
      )}
    </section>
  );
}
