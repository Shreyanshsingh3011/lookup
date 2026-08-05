import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isDerelictByName } from './debris';

test('spent stages are recognised across every launcher family in the bright catalogue', () => {
  // Every rocket-body naming form present in CelesTrak's "visual" group.
  const stages = [
    'SL-16 R/B', 'SL-14 R/B', 'SL-8 R/B', 'SL-3 R/B', 'SL-4 R/B', 'SL-6 R/B(2)', 'SL-12 R/B(2)',
    'CZ-2C R/B', 'CZ-2D R/B', 'CZ-4B R/B', 'CZ-8A R/B',
    'H-2A R/B', 'ARIANE 40 R/B', 'ARIANE 40+ R/B', 'ARIANE 5 R/B', 'IDEFIX & ARIANE 42P R/B',
    'DELTA 1 R/B', 'DELTA 2 R/B(1)', 'DELTA 1 R/B(2)',
    'THOR AGENA D R/B', 'ATLAS CENTAUR R/B', 'TITAN 4B R/B', 'TITAN 3A TRANSTAGE R/B',
    'GSLV R/B', 'SCOUT X-4 R/B', 'VANGUARD R/B', 'DIAMANT R/B',
  ];
  for (const name of stages) {
    assert.equal(isDerelictByName(name), true, `${name} should be recognised as a spent stage`);
  }
});

test('fragment and debris naming forms are recognised', () => {
  for (const name of [
    'FENGYUN 1C DEB',
    'COSMOS 2251 DEB',
    'IRIDIUM 33 DEB',
    'SL-16 DEB',
    'DELTA 1 DEB',
    'WESTFORD NEEDLES',
    'THORAD AGENA D SHROUD',
    'SL-12 R/B(AUX MOTOR)',
  ]) {
    assert.equal(isDerelictByName(name), true, `${name} should be recognised as debris`);
  }
});

test('working payloads are not swept up by the pattern', () => {
  // Includes the awkward ones: names containing R, B, or DEB as substrings.
  for (const name of [
    'ISS (ZARYA)',
    'CSS (TIANHE)',
    'HST',
    'TERRA',
    'AQUA',
    'XRISM',
    'ALOS-2',
    'SAOCOM 1A',
    'COSMO-SKYMED 1',
    'SPACEMOBILE-003',
    'STARLINK-1007',
    'NOAA 19',
    'DEBUT-1',           // "DEB" only as a word prefix, not a whole word
    'RADARSAT-2',        // contains R, no R/B
    'GLOBALSTAR M081',
  ]) {
    assert.equal(isDerelictByName(name), false, `${name} should not be treated as derelict`);
  }
});

test('dead payloads are deliberately NOT claimed, because the name cannot prove it', () => {
  // These really are derelict, and the app draws them as active. That is the
  // documented limit of name-based classification: claiming otherwise would
  // mean guessing which payloads are dead, and there is no field here to say.
  for (const name of ['ENVISAT', 'ERS-1', 'SEASAT 1', 'ASTRO-H (HITOMI)', 'OAO 2', 'KORONAS-FOTON']) {
    assert.equal(
      isDerelictByName(name),
      false,
      `${name} is dead, but nothing in its name says so — this test pins the known limitation`
    );
  }
});

test('the real bright-objects group splits the way the live catalogue says it does', () => {
  // Names taken verbatim from CelesTrak's "visual" group via production on
  // 2026-08-05: 157 objects, 93 of them spent stages. If the classifier drifts,
  // this count moves and the test fails.
  const visual = `ATLAS CENTAUR 2|THOR AGENA D R/B|SL-3 R/B|SL-8 R/B|SL-8 R/B|OAO 2|ISIS 1|SERT 2|SL-3 R/B|ASTEX 1|SL-8 R/B|OAO 3 (COPERNICUS)|ATLAS CENTAUR R/B|SL-8 R/B|SL-3 R/B|SEASAT 1|SL-14 R/B|SL-8 R/B|SL-14 R/B|SL-8 R/B|SL-3 R/B|SL-3 R/B|SL-3 R/B|SL-3 R/B|SL-3 R/B|SL-14 R/B|SL-3 R/B|SL-3 R/B|COSMOS 1536|SL-14 R/B|SL-8 R/B|SL-12 R/B(2)|SL-14 R/B|SL-16 R/B|SL-14 R/B|COSMOS 1743|SL-14 R/B|SL-14 R/B|AJISAI (EGS)|SL-14 R/B|COSMOS 1833|SL-16 R/B|SL-14 R/B|COSMOS 1844|SL-14 R/B|COSMOS 1867|SL-14 R/B|COSMOS 1933|SL-3 R/B|SL-16 R/B|COSMOS 1953|SL-8 R/B|COSMOS 1975|SL-14 R/B|SL-16 R/B|INTERCOSMOS 24|SL-14 R/B|DELTA 1 R/B|ARIANE 40 R/B|DELTA 2 R/B(1)|COSMOS 2058|SL-14 R/B|SL-14 R/B|HST|SL-16 R/B|COSMOS 2084|SL-6 R/B(2)|SL-8 R/B|SL-8 R/B|OKEAN-3|COSMOS 2151|SL-14 R/B|ERS-1|ARIANE 40 R/B|INTERCOSMOS 25|SL-8 R/B|SL-8 R/B|USA 81|COSMOS 2219|SL-16 R/B|COSMOS 2221|SL-16 R/B|COSMOS 2228|SL-16 R/B|COSMOS 2242|SL-16 R/B|ARIANE 40 R/B|COSMOS 2278|SL-16 R/B|SL-16 R/B|SL-16 R/B|ARIANE 40+ R/B|SL-16 R/B|SL-16 R/B|ORBVIEW 2 (SEASTAR)|SL-16 R/B|SL-16 R/B|ISS (ZARYA)|CZ-4B R/B|OKEAN-O|SL-16 R/B|DELTA 2 R/B|HELIOS 1B|TERRA|SL-16 R/B|TITAN 4B R/B|ENVISAT|IDEFIX & ARIANE 42P R/B|AQUA|CZ-4B R/B|MIDORI II (ADEOS-II)|H-2A R/B|CZ-4B R/B|CZ-2C R/B|SL-16 R/B|CZ-4B R/B|CZ-2C R/B|ARIANE 5 R/B|CZ-2D R/B|ALOS (DAICHI)|H-2A R/B|RESURS-DK 1|CZ-4B R/B|CZ-2C R/B|COSMO-SKYMED 1|COSMOS 2428|SL-16 R/B|KORONAS-FOTON|CZ-2C R/B|H-2A R/B|SHIJIAN-16 (SJ-16)|SL-4 R/B|ALOS-2|YAOGAN-29|ASTRO-H (HITOMI)|HXMT (HUIYAN)|SAOCOM 1A|H-2A R/B|SAOCOM 1B|CSS (TIANHE)|COSMOS 2550|CZ-2C R/B|CZ-2C R/B|GSLV R/B|XRISM|ACS3|SPACEMOBILE-003|SPACEMOBILE-005|SPACEMOBILE-001|SPACEMOBILE-002|SPACEMOBILE-004|CZ-8A R/B|SZ-21 MODULE|SPACEMOBILE-006|SPACEMOBILE-008|SPACEMOBILE-009|SPACEMOBILE-010`.split('|');

  assert.equal(visual.length, 157);
  assert.equal(visual.filter(isDerelictByName).length, 93);

  // The headline this feature rests on: the majority of the naked-eye sky is junk.
  assert.ok(visual.filter(isDerelictByName).length > visual.length / 2);
});
