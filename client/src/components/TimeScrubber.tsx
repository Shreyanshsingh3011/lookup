import { PLAYBACK_SPEEDS, TIME_RANGE_MS, type PlaybackSpeed, type TimeControl } from '../hooks/useTimeControl';

const timeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatOffset(ms: number): string {
  if (ms < 1000) return 'now';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `+${minutes}m`;
  return minutes === 0 ? `+${hours}h` : `+${hours}h ${minutes}m`;
}

function speedLabel(speed: PlaybackSpeed): string {
  if (speed === 1) return 'realtime';
  if (speed < 3600) return `${speed}×`;
  return `${speed / 60}×`;
}

export function TimeScrubber({ control }: { control: TimeControl }) {
  const { displayTime, offsetMs, live, playing, speed, setOffsetMs, setSpeed, togglePlay, resetToNow } = control;
  const progress = (offsetMs / TIME_RANGE_MS) * 100;

  return (
    <div className="glass-panel rounded-xl px-3 py-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause playback' : 'Play forward in time'}
          className="shrink-0 w-9 h-9 grid place-items-center rounded-full bg-glow-600/20 text-glow-400 border border-glow-600/40 hover:bg-glow-600/30 hover:shadow-[var(--shadow-glow-sm)] transition"
        >
          {playing ? (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor" aria-hidden="true">
              <rect x="0" y="0" width="4" height="13" rx="1" />
              <rect x="8" y="0" width="4" height="13" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor" aria-hidden="true">
              <path d="M1 1.2c0-.9 1-1.4 1.7-.9l8 5.3c.7.4.7 1.4 0 1.8l-8 5.3c-.7.5-1.7 0-1.7-.9V1.2Z" />
            </svg>
          )}
        </button>

        <div className="shrink-0 min-w-[150px]">
          <div className="font-mono text-sm text-space-100 tabular-nums">{timeFmt.format(displayTime)}</div>
          <div className="text-[10px] text-space-300">
            {live ? (
              <span className="text-glow-400">● live</span>
            ) : (
              <span>{formatOffset(offsetMs)} from now</span>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 relative flex items-center">
          {/* Filled track under the native range input */}
          <div className="absolute inset-x-0 h-1.5 rounded-full bg-space-700 pointer-events-none">
            <div
              className="h-full rounded-full bg-gradient-to-r from-glow-600 to-glow-400"
              style={{ width: `${progress}%` }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={TIME_RANGE_MS}
            step={60_000}
            value={offsetMs}
            onChange={(e) => setOffsetMs(Number(e.target.value))}
            aria-label="Scrub display time up to 24 hours ahead"
            className="relative w-full appearance-none bg-transparent cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-glow-400
                       [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(45,212,191,0.8)] [&::-webkit-slider-thumb]:cursor-grab
                       [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                       [&::-moz-range-thumb]:bg-glow-400 [&::-moz-range-thumb]:border-0"
          />
        </div>

        <button
          type="button"
          onClick={resetToNow}
          disabled={live}
          className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg bg-space-700/60 text-space-200 border border-space-600 hover:bg-space-700 transition disabled:opacity-40 disabled:hover:bg-space-700/60"
        >
          Now
        </button>
      </div>

      <div className="flex items-center gap-2 pl-12">
        <span className="text-[10px] uppercase tracking-wider text-space-300">Speed</span>
        <div className="flex gap-1">
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                speed === s
                  ? 'bg-glow-600/20 text-glow-400 border-glow-600/40'
                  : 'bg-transparent text-space-300 border-space-700 hover:border-space-600 hover:text-space-200'
              }`}
            >
              {speedLabel(s)}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-space-300 ml-auto hidden sm:inline">timeline spans the next 24 hours</span>
      </div>
    </div>
  );
}
