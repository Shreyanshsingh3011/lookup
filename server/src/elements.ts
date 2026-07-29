import { readFileSync } from "node:fs";

/**
 * Epoch encoded in columns 19-32 of a TLE's first line: a two-digit year
 * followed by the day of year with a fractional part.
 *
 * The two-digit year uses the standard NORAD pivot — 57-99 means 1957-1999
 * (Sputnik launched in 1957, so there are no earlier element sets) and 00-56
 * means 2000-2056. Naively prefixing "20" silently misdates every historical
 * element set by a century.
 */
export function tleEpoch(line1: string): Date {
  const yearField = line1.slice(18, 20);
  const dayField = line1.slice(20, 32);

  // Validate the shape before converting. `Number("")` is 0, not NaN, so a
  // string too short to slice would otherwise parse as a valid year-2000 epoch
  // instead of being rejected.
  if (!/^\d{2}$/.test(yearField) || !/^\s*\d{1,3}(\.\d+)?\s*$/.test(dayField)) {
    throw new Error(`Unparseable TLE epoch in line: ${line1.slice(0, 40)}…`);
  }

  const twoDigitYear = Number(yearField);
  const dayOfYear = Number(dayField);
  if (dayOfYear < 1 || dayOfYear >= 367) {
    throw new Error(`TLE epoch day out of range (${dayOfYear}) in line: ${line1.slice(0, 40)}…`);
  }

  const year = twoDigitYear >= 57 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
  // Day 1.0 is midnight at the start of 1 January. Round to the millisecond:
  // the fractional day carries ~1e-8 day precision (under a millisecond), so
  // the product otherwise lands a millisecond short through float error.
  return new Date(Date.UTC(year, 0, 1) + Math.round((dayOfYear - 1) * 86_400_000));
}

export interface EpochSpan {
  /** Age in days of the most recently published element in the set. */
  newestAgeDays: number;
  /** Age in days of the least recently published element in the set. */
  oldestAgeDays: number;
}

/**
 * How old a set of elements is.
 *
 * `newestAgeDays` is the useful signal for "when did this source last publish",
 * since Celestrak refreshes a whole group together. `oldestAgeDays` catches a
 * set that also carries long-decayed objects.
 */
export function epochSpan(line1s: string[], now = Date.now()): EpochSpan | null {
  let newest = Infinity;
  let oldest = -Infinity;

  for (const line1 of line1s) {
    let ageDays: number;
    try {
      ageDays = (now - tleEpoch(line1).getTime()) / 86_400_000;
    } catch {
      continue; // a single malformed line shouldn't discard the whole set
    }
    if (ageDays < newest) newest = ageDays;
    if (ageDays > oldest) oldest = ageDays;
  }

  if (!Number.isFinite(newest)) return null;
  return {
    newestAgeDays: Math.round(newest * 100) / 100,
    oldestAgeDays: Math.round(oldest * 100) / 100,
  };
}

/**
 * Path to an operator-supplied element file, if one is configured.
 *
 * Set `TLE_FILE` to a Celestrak-format `.txt` (repeating name / line 1 / line 2
 * triples). Useful for air-gapped or offline deployments, for reproducible
 * predictions in tests, and for running against known-current elements in an
 * environment that cannot reach celestrak.org.
 *
 * An explicit file takes precedence over a live fetch: an operator who sets it
 * means it. Responses report `source: "file"` so the UI can say where the
 * numbers came from.
 */
export function elementFilePath(): string | null {
  const path = process.env.TLE_FILE?.trim();
  return path ? path : null;
}

export function readElementFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read TLE_FILE at '${path}': ${message}`);
  }
}
