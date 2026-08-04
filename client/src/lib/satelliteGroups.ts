/**
 * Which slice of the catalogue to track.
 *
 * The app shipped hardcoded to the "stations" group — about twenty objects.
 * That was right when this was an ISS pass table and quietly wrong ever
 * after: at a typical site the stations go weeks at a time with no pass above
 * ten degrees, so the whole app could sit there showing nothing while a
 * hundred and fifty brighter objects went by unlisted.
 *
 * The catalogue itself now comes from the server, which is the side that
 * knows what Celestrak will actually serve. What stays here is the fallback
 * used before that request lands or when it fails — the two groups that are
 * always worth having, so an offline first paint still offers a real choice
 * rather than an empty row of buttons.
 */

export type GroupCategory = 'Easy to see' | 'Constellations' | 'Navigation' | 'Earth & science' | 'Recent';

export interface SatelliteGroup {
  /** Group key the API understands. Appears in shared links, so it is stable. */
  id: string;
  label: string;
  /** Shown under the label, so the choice is informed rather than a guess. */
  description: string;
  category: GroupCategory;
  approximateSize: number;
}

export const CATEGORY_ORDER: GroupCategory[] = [
  'Easy to see',
  'Constellations',
  'Navigation',
  'Earth & science',
  'Recent',
];

/** Used until `/api/groups` answers, and if it never does. */
export const FALLBACK_GROUPS: SatelliteGroup[] = [
  {
    id: 'stations',
    label: 'Space stations',
    description: 'ISS, Tiangong and the vehicles visiting them',
    category: 'Easy to see',
    approximateSize: 30,
  },
  {
    id: 'visual',
    label: 'Brightest objects',
    description: "Celestrak's brightest ~150, mostly spent rocket bodies",
    category: 'Easy to see',
    approximateSize: 160,
  },
];

export const DEFAULT_GROUP_IDS = ['stations', 'visual'];

/**
 * Never fetch nothing.
 *
 * Clearing every checkbox would otherwise produce an empty sky with no
 * explanation, which reads as a broken app rather than as a choice.
 *
 * Unknown ids are dropped rather than trusted: a shared link can name a group
 * that has since been removed, and passing it through would turn someone
 * else's stale bookmark into a 404 on the pass search.
 */
export function normaliseGroups(ids: string[], known: SatelliteGroup[] = FALLBACK_GROUPS): string[] {
  const valid = ids.filter((id) => known.some((g) => g.id === id));
  return valid.length > 0 ? valid : DEFAULT_GROUP_IDS;
}

export function describeGroups(ids: string[], known: SatelliteGroup[] = FALLBACK_GROUPS): string {
  const labels = normaliseGroups(ids, known).map(
    (id) => known.find((g) => g.id === id)?.label ?? id
  );
  if (labels.length === 1) return labels[0];
  if (labels.length > 3) return `${labels.length} groups`;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`.toLowerCase();
}

/** Rough object count for a selection, for warning before an expensive pick. */
export function estimatedSize(ids: string[], known: SatelliteGroup[]): number {
  return ids.reduce((sum, id) => sum + (known.find((g) => g.id === id)?.approximateSize ?? 0), 0);
}

export function groupsByCategory(known: SatelliteGroup[]): Array<[GroupCategory, SatelliteGroup[]]> {
  return CATEGORY_ORDER.map(
    (category) => [category, known.filter((g) => g.category === category)] as [GroupCategory, SatelliteGroup[]]
  ).filter(([, groups]) => groups.length > 0);
}
