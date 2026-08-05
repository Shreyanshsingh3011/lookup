/**
 * Which objects the camera is pointing at.
 *
 * How "particular by zooming in" is answered: zoomed out the field is a
 * population, zoomed in the few objects actually in front of you become
 * individually identified. Selecting by angle from the boresight rather than by
 * screen projection keeps this to a dot product per object, and gives the same
 * answer for the only case that matters — what sits near the middle of a narrow
 * field.
 *
 * Reads the position buffer directly rather than taking an array of objects,
 * because the caller has just written that buffer inside its frame loop and
 * allocating a wrapper per object per frame would cost more than the search.
 */
export function nearestToBoresight(
  positions: Float32Array,
  count: number,
  satnums: string[],
  boresight: { x: number; y: number; z: number },
  maxAngleDeg: number,
  limit: number
): string[] {
  if (count === 0) return [];

  const bl = Math.hypot(boresight.x, boresight.y, boresight.z);
  if (bl === 0) return [];
  const bx = boresight.x / bl;
  const by = boresight.y / bl;
  const bz = boresight.z / bl;
  const minCos = Math.cos((maxAngleDeg * Math.PI) / 180);

  const scored: Array<{ satnum: string; cos: number }> = [];
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    if (l === 0) continue;
    const cos = (x * bx + y * by + z * bz) / l;
    if (cos < minCos) continue;
    scored.push({ satnum: satnums[i], cos });
  }

  scored.sort((a, b) => b.cos - a.cos);
  return scored.slice(0, limit).map((s) => s.satnum);
}
