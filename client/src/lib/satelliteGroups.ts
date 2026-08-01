/**
 * Which slice of the catalogue to track.
 *
 * The app shipped hardcoded to the "stations" group — about twenty objects.
 * That was right when this was an ISS pass table and quietly wrong ever
 * after: at a typical site the stations go weeks at a time with no pass above
 * ten degrees, so the whole app could sit there showing nothing while a
 * hundred and fifty brighter objects went by unlisted.
 *
 * Celestrak's "visual" group is the answer to that — its brightest hundred and
 * fifty or so, which in practice is dominated by spent rocket bodies, the
 * genuinely eye-catching things crossing a dark sky. It does not contain the
 * ISS, which lives in "stations", so the default is deliberately both.
 */

export interface SatelliteGroup {
  /** Group key the API understands. */
  id: string;
  label: string;
  /** Shown under the label, so the choice is informed rather than a guess. */
  description: string;
}

export const SATELLITE_GROUPS: SatelliteGroup[] = [
  {
    id: 'stations',
    label: 'Space stations',
    description: 'ISS, Tiangong and the vehicles visiting them — about 20 objects',
  },
  {
    id: 'visual',
    label: 'Brightest objects',
    description: "Celestrak's brightest ~150, mostly spent rocket bodies",
  },
];

export const DEFAULT_GROUP_IDS = ['stations', 'visual'];

/**
 * Never fetch nothing.
 *
 * Clearing every checkbox would otherwise produce an empty sky with no
 * explanation, which reads as a broken app rather than as a choice.
 */
export function normaliseGroups(ids: string[]): string[] {
  const known = ids.filter((id) => SATELLITE_GROUPS.some((g) => g.id === id));
  return known.length > 0 ? known : DEFAULT_GROUP_IDS;
}

export function describeGroups(ids: string[]): string {
  const labels = normaliseGroups(ids).map(
    (id) => SATELLITE_GROUPS.find((g) => g.id === id)?.label ?? id
  );
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`.toLowerCase();
}
