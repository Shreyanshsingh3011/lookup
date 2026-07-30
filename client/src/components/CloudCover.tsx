/**
 * Cloud-cover forecast display.
 *
 * The forecast is advisory: a pass is still listed when the sky is expected to
 * be overcast, because forecasts are wrong often enough that hiding the pass
 * would be worse than flagging it.
 */

function label(percent: number): string {
  if (percent <= 15) return 'clear';
  if (percent <= 50) return 'partly cloudy';
  if (percent <= 85) return 'mostly cloudy';
  return 'overcast';
}

function toneClass(percent: number): string {
  if (percent <= 15) return 'text-glow-400';
  if (percent <= 50) return 'text-space-100';
  if (percent <= 85) return 'text-amber-glow/80';
  return 'text-amber-glow';
}

/** Four-eighths-style pictogram: a filled arc proportional to cloud cover. */
function CloudDial({ percent }: { percent: number }) {
  const r = 5;
  const circumference = 2 * Math.PI * r;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.25" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={`${(percent / 100) * circumference} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

export function CloudCover({
  percent,
  showLabel = false,
}: {
  percent: number | null | undefined;
  showLabel?: boolean;
}) {
  if (percent === null || percent === undefined) {
    return (
      <span className="text-space-500 text-xs" title="No cloud forecast covers this time">
        —
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${toneClass(percent)}`}
      title={`${Math.round(percent)}% cloud cover forecast — ${label(percent)}`}
    >
      <CloudDial percent={percent} />
      <span className="font-mono text-xs">{Math.round(percent)}%</span>
      {showLabel && <span className="text-xs text-space-300">{label(percent)}</span>}
    </span>
  );
}

export function WeatherNotice({ status, error }: { status: string; error?: string }) {
  if (status === 'live') return null;
  return (
    <p className="text-[11px] text-space-300 mt-2">
      {status === 'cache'
        ? 'Cloud forecast may be out of date — the weather service is currently unreachable.'
        : `Cloud forecast unavailable${error ? ` (${error})` : ''}.`}
    </p>
  );
}
