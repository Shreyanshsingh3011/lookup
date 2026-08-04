import { useState } from 'react';
import {
  estimatedSize,
  groupsByCategory,
  normaliseGroups,
  type SatelliteGroup,
} from '../lib/satelliteGroups';

/**
 * Which parts of the catalogue to track.
 *
 * Every selected object is propagated in the browser on each tick of the sky
 * dome and costs server time in the pass search, so each group is offered with
 * its size stated rather than hidden behind a number nobody can act on.
 * Picking Starlink is a legitimate thing to want; being surprised by what it
 * costs is not.
 */
export function GroupPicker({
  selected,
  onChange,
  catalogue,
  satelliteCount,
  maxScanned,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  catalogue: SatelliteGroup[];
  satelliteCount: number | null;
  maxScanned: number | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const active = normaliseGroups(selected, catalogue);
  const toggle = (id: string) => {
    const next = active.includes(id) ? active.filter((g) => g !== id) : [...active, id];
    // Normalise, so unchecking the last box falls back rather than blanking.
    onChange(normaliseGroups(next, catalogue));
  };

  const categories = groupsByCategory(catalogue);
  // Collapsed, only the groups worth a beginner's first click are shown; the
  // rest are a click away rather than a wall of sixty buttons on first load.
  const visible = expanded ? categories : categories.slice(0, 1);
  const hiddenCount = catalogue.length - (categories[0]?.[1].length ?? 0);

  const selectedSize = estimatedSize(active, catalogue);
  const overCap = maxScanned !== null && selectedSize > maxScanned;

  return (
    <div className="flex flex-col gap-2">
      {visible.map(([category, groups]) => (
        <div key={category} className="flex flex-wrap items-center gap-2">
          {expanded && (
            <span className="text-[10px] uppercase tracking-wide text-space-500 w-full sm:w-28 shrink-0">
              {category}
            </span>
          )}
          {groups.map((group) => {
            const on = active.includes(group.id);
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => toggle(group.id)}
                title={`${group.description} · about ${group.approximateSize.toLocaleString()} objects`}
                aria-pressed={on}
                className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  on
                    ? 'border-glow-400/60 text-glow-400 bg-glow-400/10 font-semibold'
                    : 'border-space-700 text-space-300 hover:border-space-500'
                }`}
              >
                {group.label}
                {group.approximateSize >= 500 && (
                  <span className="ml-1.5 text-[10px] text-space-400 font-mono">
                    {group.approximateSize >= 1000
                      ? `${Math.round(group.approximateSize / 1000)}k`
                      : group.approximateSize}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="text-[11px] text-glow-400 hover:underline"
          >
            {expanded ? 'Fewer groups' : `More groups (${hiddenCount})`}
          </button>
        )}
        {satelliteCount !== null && (
          <span className="text-[11px] text-space-400 font-mono">
            {satelliteCount.toLocaleString()} objects tracked
          </span>
        )}
        {overCap && (
          <span className="text-[11px] text-amber-glow">
            That is about {selectedSize.toLocaleString()} objects — the pass search will scan the{' '}
            {maxScanned.toLocaleString()} most likely to be visible.
          </span>
        )}
      </div>
    </div>
  );
}
