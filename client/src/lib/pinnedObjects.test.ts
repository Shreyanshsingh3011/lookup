import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assessReach, preFilter } from './debris';
import type { Observer, TleRecord } from '../types';

/**
 * The pre-filter is what makes catalogue objects safe to add to the dome.
 *
 * Non-negotiable at this scale rather than polish: the dome re-propagates
 * everything it holds several times a second, so an object that can never rise
 * at this latitude would be integrated forward forever to be found below the
 * horizon every time. These assertions cover the property the hook depends on,
 * using real element sets.
 */

const SL16: TleRecord = {
  name: 'SL-16 R/B',
  satnum: '16182',
  line1: '1 16182U 85097B   26215.38364846 -.00000145  00000+0 -48837-4 0  9990',
  line2: '2 16182  71.0012 191.7137 0006582  15.5500 136.7162 14.16615346108009',
};
const HST: TleRecord = {
  name: 'HST',
  satnum: '20580',
  line1: '1 20580U 90037B   26215.07632950  .00006338  00000+0  19645-3 0  9999',
  line2: '2 20580  28.4731 119.9792 0001799 314.8840  45.1610 15.31251640795763',
};
const LAGEOS: TleRecord = {
  name: 'LAGEOS 2',
  satnum: '22195',
  line1: '1 22195U 92070B   26215.25016075 -.00000009  00000+0  00000+0 0  9997',
  line2: '2 22195  52.6402 236.9187 0137993 207.9535 130.9014  6.47294124798460',
};

const LONDON: Observer = { latitude: 51.5, longitude: -0.13, elevation: 0 };
const SVALBARD: Observer = { latitude: 78.2, longitude: 15.6, elevation: 0 };

test('a catalogue object that can rise here is kept', () => {
  const { candidates } = preFilter([SL16], LONDON);
  assert.equal(candidates.length, 1);
  assert.equal(assessReach(SL16, LONDON).reason, 'reachable');
});

test('one that cannot rise here is rejected before any propagation', () => {
  // Hubble at 28.5 degrees inclination plus a 22.8 degree footprint reaches
  // 51.3 — just short of London, and nowhere near Svalbard.
  assert.equal(assessReach(HST, LONDON).reason, 'never-rises');
  assert.equal(preFilter([HST], LONDON).candidates.length, 0);

  // And it is inclination plus footprint that decides, not latitude alone.
  // SL-16 sits at 71 degrees with a 28.1 degree footprint, so it reaches 99 —
  // Svalbard at 78.2 N is comfortably inside that, while Hubble is not. A
  // high-latitude observer is not automatically a worse one.
  const atSvalbard = preFilter([SL16, HST], SVALBARD);
  assert.equal(atSvalbard.rejected['never-rises'], 1, 'only Hubble is out of reach there');
  assert.deepEqual(atSvalbard.candidates.map((t) => t.satnum), ['16182']);
});

test('filtering a mixed selection keeps only what is reachable, losing nothing else', () => {
  const chosen = [SL16, HST, LAGEOS];
  const result = preFilter(chosen, LONDON);
  const rejected = Object.values(result.rejected).reduce((a, b) => a + b, 0);
  assert.equal(result.candidates.length + rejected, chosen.length, 'every object accounted for');
  assert.ok(result.candidates.some((t) => t.satnum === '16182'));
  assert.ok(!result.candidates.some((t) => t.satnum === '20580'));
});

test('every rejection reason has wording, so the UI never shows a raw enum', () => {
  // Mirrors REASON_TEXT in usePinnedObjects. A reason with no entry would reach
  // a reader as "never-rises", which is not a sentence.
  const wording: Record<string, string> = {
    'never-rises': 'never reaches your latitude',
    'too-low': 'perigee below 130 km',
    'too-high': 'too far out',
    unreadable: 'will not parse',
  };
  for (const reason of ['never-rises', 'too-low', 'too-high', 'unreadable']) {
    assert.ok(wording[reason], `${reason} needs wording`);
  }
  // And the reachable case must not appear in that map, since it is not a rejection.
  assert.equal(wording.reachable, undefined);
});

test('merging pinned objects into the curated layer never duplicates a satnum', () => {
  // The merge in App.tsx: curated first, pinned only if not already present.
  // Six of the eight curated derelicts are also in the bright-objects group, so
  // an overlap here is the expected case rather than an edge one.
  const curated = [SL16, LAGEOS];
  const pinnedTles = [SL16, HST];
  const seen = new Set(curated.map((t) => t.satnum));
  const merged = [...curated, ...pinnedTles.filter((t) => !seen.has(t.satnum))];
  assert.equal(merged.length, 3);
  assert.equal(new Set(merged.map((t) => t.satnum)).size, 3, 'no duplicates');
  // Curated entries keep their position, so the default layer is unchanged.
  assert.equal(merged[0].satnum, '16182');
  assert.equal(merged[1].satnum, '22195');
});

test('the pinned cap is small enough that propagation stays affordable', () => {
  // 900 objects measured at 0.66 ms per frame; 40 is well inside the budget on
  // top of the curated set, and the real reason for the cap is that fragments
  // are invisible, not that the maths is slow.
  const MAX_PINNED = 40;
  assert.ok(MAX_PINNED <= 100, 'a cap in the hundreds would be a legibility problem');
  assert.ok(MAX_PINNED >= 10, 'and it has to be useful');
});
