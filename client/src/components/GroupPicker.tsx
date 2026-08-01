import { SATELLITE_GROUPS, normaliseGroups } from '../lib/satelliteGroups';

/**
 * Which parts of the catalogue to track.
 *
 * Deliberately a small, explicit set rather than "everything". Every selected
 * object is propagated in the browser on each tick of the sky dome and costs
 * server time in the pass search, so the choice is offered with its size
 * stated rather than hidden behind a number nobody can act on.
 */
export function GroupPicker({
  selected,
  onChange,
  satelliteCount,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  satelliteCount: number | null;
}) {
  const toggle = (id: string) => {
    const next = selected.includes(id)
      ? selected.filter((g) => g !== id)
      : [...selected, id];
    // normalise, so unchecking the last box falls back rather than blanking.
    onChange(normaliseGroups(next));
  };

  const active = normaliseGroups(selected);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {SATELLITE_GROUPS.map((group) => {
        const on = active.includes(group.id);
        return (
          <button
            key={group.id}
            type="button"
            onClick={() => toggle(group.id)}
            title={group.description}
            aria-pressed={on}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              on
                ? 'border-glow-400/60 text-glow-400 bg-glow-400/10 font-semibold'
                : 'border-space-700 text-space-300 hover:border-space-500'
            }`}
          >
            {group.label}
          </button>
        );
      })}
      {satelliteCount !== null && (
        <span className="text-[11px] text-space-400 font-mono">
          {satelliteCount} objects tracked
        </span>
      )}
    </div>
  );
}
