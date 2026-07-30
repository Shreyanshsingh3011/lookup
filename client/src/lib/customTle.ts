import * as satellite from 'satellite.js';
import type { TleRecord } from '../types';

/**
 * Parse and validate a user-pasted TLE: either three lines (name, line 1,
 * line 2) or just the two element lines, in which case a generic name is
 * used. Validated the same way the rest of the app trusts a TLE — via
 * satellite.js's own SGP4 initialization — so a garbled paste is rejected
 * before it ever reaches the sky dome or a passes request.
 */
export function parsePastedTle(raw: string): TleRecord | string {
  const lines = raw
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  let name: string;
  let line1: string;
  let line2: string;
  if (lines.length >= 3) {
    [name, line1, line2] = lines;
  } else if (lines.length === 2) {
    [line1, line2] = lines;
    name = '';
  } else {
    return 'Paste at least two lines: TLE line 1 and line 2 (optionally preceded by a name line).';
  }

  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    return "Line 1 must start with '1 ' and line 2 with '2 ' — this doesn't look like a TLE.";
  }

  const satnum = line1.slice(2, 7).trim();
  if (!satnum) {
    return 'Could not read a NORAD catalog number from line 1.';
  }

  try {
    const rec = satellite.twoline2satrec(line1, line2);
    if (rec.error) {
      return `satellite.js rejected these elements (error code ${rec.error}).`;
    }
  } catch (err) {
    return err instanceof Error ? err.message : 'Could not parse these elements.';
  }

  return { name: name.trim() || `Satellite ${satnum}`, satnum, line1, line2 };
}
