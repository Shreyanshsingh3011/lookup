import type { AircraftState } from './aircraft';

/**
 * Telling military traffic apart from airliners.
 *
 * Worth being blunt about what this can and cannot do.
 *
 * What it can: the community ADS-B aggregators this app uses do not filter
 * military traffic the way commercial providers do, so transports, tankers,
 * trainers, patrol aircraft and transits are genuinely in the feed already.
 * This just labels them.
 *
 * What it cannot: combat aircraft on operational sorties routinely switch
 * ADS-B off, or transmit Mode S with no position at all. Those are invisible
 * to every civilian tracker, this one included. An empty result means nothing
 * was broadcast, never that nothing was flying.
 *
 * And the classification itself is a heuristic. Transponder addresses are
 * allocated to nations in blocks and many nations reserve part of theirs for
 * military use, but the allocation is not a guarantee in either direction:
 * civil aircraft occasionally appear in a military block, and plenty of
 * military airframes fly on ordinary civil addresses. The UI says so.
 */

export interface MilitaryBlock {
  /** Inclusive range of ICAO 24-bit addresses. */
  from: number;
  to: number;
  country: string;
}

/**
 * Address ranges nations set aside for military airframes.
 *
 * This is the allocation table long used by the open ADS-B decoders
 * (dump1090/readsb and the tar1090 front end). It is not exhaustive — it
 * covers the nations that publish a distinct military block at all.
 */
export const MILITARY_BLOCKS: MilitaryBlock[] = [
  { from: 0x010070, to: 0x01008f, country: 'Egypt' },
  { from: 0x0a4000, to: 0x0a4fff, country: 'Algeria' },
  { from: 0x33ff00, to: 0x33ffff, country: 'Italy' },
  { from: 0x350000, to: 0x37ffff, country: 'Spain' },
  { from: 0x3a8000, to: 0x3affff, country: 'France' },
  { from: 0x3b0000, to: 0x3bffff, country: 'France' },
  { from: 0x3ea000, to: 0x3ebfff, country: 'Germany' },
  { from: 0x3f4000, to: 0x3fbfff, country: 'Germany' },
  { from: 0x400000, to: 0x40003f, country: 'United Kingdom' },
  { from: 0x43c000, to: 0x43cfff, country: 'United Kingdom' },
  { from: 0x444000, to: 0x446fff, country: 'Austria' },
  { from: 0x44f000, to: 0x44ffff, country: 'Belgium' },
  { from: 0x457000, to: 0x457fff, country: 'Bulgaria' },
  { from: 0x45f400, to: 0x45f4ff, country: 'Denmark' },
  { from: 0x468000, to: 0x4683ff, country: 'Greece' },
  { from: 0x473c00, to: 0x473c0f, country: 'Hungary' },
  { from: 0x478100, to: 0x4781ff, country: 'Norway' },
  { from: 0x480000, to: 0x480fff, country: 'Netherlands' },
  { from: 0x48d800, to: 0x48d87f, country: 'Poland' },
  { from: 0x497c00, to: 0x497cff, country: 'Portugal' },
  { from: 0x498420, to: 0x49842f, country: 'Czech Republic' },
  { from: 0x4b7000, to: 0x4b7fff, country: 'Switzerland' },
  { from: 0x4b8200, to: 0x4b82ff, country: 'Turkey' },
  { from: 0xadf7c8, to: 0xafffff, country: 'United States' },
  { from: 0xc20000, to: 0xc3ffff, country: 'Canada' },
  { from: 0xe40000, to: 0xe41fff, country: 'Brazil' },
];

/**
 * Callsign prefixes used by military air arms.
 *
 * Weaker evidence than an address block — these are chosen by crews and
 * nothing stops a civil flight using a similar string — so a callsign match
 * alone is reported as such.
 */
export const MILITARY_CALLSIGN_PREFIXES: Array<{ prefix: string; operator: string }> = [
  { prefix: 'RCH', operator: 'US Air Mobility Command' },
  { prefix: 'RRR', operator: 'Royal Air Force' },
  { prefix: 'ASCOT', operator: 'Royal Air Force' },
  { prefix: 'CFC', operator: 'Royal Canadian Air Force' },
  { prefix: 'NATO', operator: 'NATO' },
  { prefix: 'GAF', operator: 'German Air Force' },
  { prefix: 'IAM', operator: 'Italian Air Force' },
  { prefix: 'HKY', operator: 'US Air National Guard' },
  { prefix: 'BAF', operator: 'Belgian Air Force' },
  { prefix: 'NAF', operator: 'Royal Netherlands Air Force' },
  { prefix: 'SVF', operator: 'Swedish Air Force' },
  { prefix: 'PLF', operator: 'Polish Air Force' },
];

export interface MilitaryClassification {
  military: boolean;
  /** How it was decided, so the UI can be honest about the strength of it. */
  basis: 'address-block' | 'callsign' | null;
  country: string | null;
  operator: string | null;
}

const NOT_MILITARY: MilitaryClassification = {
  military: false,
  basis: null,
  country: null,
  operator: null,
};

export function classifyMilitary(state: AircraftState): MilitaryClassification {
  const address = Number.parseInt(state.icao24, 16);
  if (Number.isFinite(address)) {
    const block = MILITARY_BLOCKS.find((b) => address >= b.from && address <= b.to);
    if (block) {
      return { military: true, basis: 'address-block', country: block.country, operator: null };
    }
  }

  const callsign = state.callsign?.trim().toUpperCase() ?? '';
  if (callsign) {
    const match = MILITARY_CALLSIGN_PREFIXES.find(({ prefix }) => callsign.startsWith(prefix));
    // Require a digit after the prefix so ordinary airline callsigns that
    // happen to begin with the same letters are not swept in.
    if (match && /\d/.test(callsign.slice(match.prefix.length))) {
      return { military: true, basis: 'callsign', country: null, operator: match.operator };
    }
  }

  return NOT_MILITARY;
}

/**
 * Whether the aircraft has described itself as a high-performance airframe.
 *
 * ADS-B category A6 means "capable of over 5 g and over 400 knots", which in
 * practice means a fighter or a fast jet trainer. This is the one airframe
 * hint that comes from the aircraft's own transmission rather than from
 * inference, so it is the only basis on which a fighter silhouette is drawn —
 * guessing from a transponder address would be inventing the shape.
 */
export function isHighPerformance(category: string | null): boolean {
  return category === 'A6';
}

/** Broad shape class, used only to decide which model to draw. */
export type Airframe = 'airliner' | 'fast-jet' | 'rotorcraft';

export function airframeFor(state: AircraftState): Airframe {
  if (isHighPerformance(state.category)) return 'fast-jet';
  if (state.category === 'A7') return 'rotorcraft';
  return 'airliner';
}

export function describeMilitary(classification: MilitaryClassification): string | null {
  if (!classification.military) return null;
  if (classification.basis === 'address-block') {
    return `${classification.country} military address block`;
  }
  return `${classification.operator} callsign`;
}
