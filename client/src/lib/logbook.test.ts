import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  MAX_ENTRIES,
  MAX_NOTE_LENGTH,
  STORAGE_KEY,
  addEntry,
  createEntry,
  entriesToCsv,
  isValidEntry,
  loadEntries,
  observingNight,
  removeEntry,
  saveEntries,
  summarise,
  type LogEntry,
} from './logbook';

const HERE = { latitude: 51.4769, longitude: -0.0005, elevation: 45 };

function entry(subject: string, observedAt: string, extra: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `${subject}-${observedAt}`,
    observedAt,
    subject,
    satnum: null,
    observer: HERE,
    maxElevationDeg: null,
    magnitude: null,
    seeing: null,
    note: '',
    recordedAt: observedAt,
    ...extra,
  };
}

/** A localStorage stand-in, since these run in node. */
function fakeStorage(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
}

test('an observation without a subject is not a record of anything', () => {
  assert.equal(createEntry({ observedAt: new Date(), subject: '', observer: HERE }), null);
  assert.equal(createEntry({ observedAt: new Date(), subject: '   ', observer: HERE }), null);
  // An unparseable time would file the entry nowhere.
  assert.equal(createEntry({ observedAt: new Date('nonsense'), subject: 'ISS', observer: HERE }), null);
});

test('a good observation keeps what it was given', () => {
  // Comfortably in the past, so 'written down after it was seen' holds.
  const when = new Date(Date.now() - 3 * 86_400_000);
  const created = createEntry({
    observedAt: when,
    subject: '  ISS  ',
    satnum: '25544',
    observer: HERE,
    maxElevationDeg: 68,
    magnitude: -3.1,
    seeing: 'good',
    note: 'Brilliant, right overhead, faded into shadow near the zenith.',
  })!;

  assert.equal(created.subject, 'ISS', 'whitespace is trimmed');
  assert.equal(created.observedAt, when.toISOString());
  assert.equal(created.satnum, '25544');
  assert.equal(created.maxElevationDeg, 68);
  assert.equal(created.magnitude, -3.1);
  assert.equal(created.seeing, 'good');
  assert.ok(created.id.length > 0);
  // When it was seen and when it was written down are different facts.
  assert.ok(Date.parse(created.recordedAt) >= Date.parse(created.observedAt));
});

test('runaway input is truncated rather than refused', () => {
  const created = createEntry({
    observedAt: new Date(),
    subject: 'x'.repeat(500),
    observer: HERE,
    note: 'y'.repeat(MAX_NOTE_LENGTH + 500),
  })!;
  assert.equal(created.subject.length, 200);
  assert.equal(created.note.length, MAX_NOTE_LENGTH);
});

test('one corrupt entry does not take the logbook down with it', () => {
  // Storage survives upgrades and can be hand-edited, so it is not trusted.
  const storage = fakeStorage(
    JSON.stringify([
      entry('ISS', '2026-08-04T21:00:00Z'),
      { id: 'broken' },
      null,
      'not an object',
      { ...entry('Tiangong', '2026-08-03T22:00:00Z'), observer: { latitude: 'north' } },
      entry('Hubble', '2026-08-02T20:00:00Z'),
    ])
  );
  const loaded = loadEntries(storage);
  assert.deepEqual(loaded.map((e) => e.subject), ['ISS', 'Hubble']);
});

test('unreadable storage loses the logbook, not the app', () => {
  assert.deepEqual(loadEntries(fakeStorage('{{{ not json')), []);
  assert.deepEqual(loadEntries(fakeStorage('{"not":"an array"}')), []);
  assert.deepEqual(loadEntries(fakeStorage()), []);
});

test('entries come back newest first however they went in', () => {
  const storage = fakeStorage(
    JSON.stringify([
      entry('oldest', '2026-08-01T21:00:00Z'),
      entry('newest', '2026-08-09T21:00:00Z'),
      entry('middle', '2026-08-05T21:00:00Z'),
    ])
  );
  assert.deepEqual(loadEntries(storage).map((e) => e.subject), ['newest', 'middle', 'oldest']);
});

test('a full logbook drops its oldest entries, not its newest', () => {
  // The alternative is refusing to record anything once full, which would fail
  // silently on exactly the night somebody saw something worth keeping.
  let entries: LogEntry[] = [];
  for (let i = 0; i < MAX_ENTRIES + 25; i++) {
    entries = addEntry(entries, entry(`sighting ${i}`, new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString()));
  }
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries[0].subject, `sighting ${MAX_ENTRIES + 24}`, 'the newest must survive');
  assert.ok(!entries.some((e) => e.subject === 'sighting 0'), 'the oldest must be the one dropped');
});

test('a failed save reports itself instead of pretending', () => {
  // A private window with storage disabled must not silently swallow a night's
  // observations and leave the user believing they were kept.
  const broken = {
    setItem: () => {
      throw new DOMException('QuotaExceededError');
    },
  };
  assert.equal(saveEntries([entry('ISS', '2026-08-04T21:00:00Z')], broken), false);

  const working = fakeStorage();
  assert.equal(saveEntries([entry('ISS', '2026-08-04T21:00:00Z')], working), true);
  assert.ok(working.read()!.includes(STORAGE_KEY) === false, 'the key is not stored inside the value');
  assert.deepEqual(loadEntries({ getItem: () => working.read() ?? null }).map((e) => e.subject), ['ISS']);
});

test('removing an entry removes exactly one', () => {
  const entries = [entry('a', '2026-08-03T21:00:00Z'), entry('b', '2026-08-02T21:00:00Z')];
  const left = removeEntry(entries, entries[0].id);
  assert.deepEqual(left.map((e) => e.subject), ['b']);
  // Removing something absent is not an error.
  assert.equal(removeEntry(entries, 'no-such-id').length, 2);
});

test('an evening that runs past midnight is one night, not two', () => {
  // Counting a session that ends at 1 a.m. as two nights would make every
  // serious session look like two casual ones.
  const evening = new Date(2026, 7, 4, 23, 30);
  const afterMidnight = new Date(2026, 7, 5, 1, 15);
  assert.equal(observingNight(evening), observingNight(afterMidnight));
  assert.equal(observingNight(evening), '2026-08-04');

  // The following evening is a different night.
  assert.notEqual(observingNight(evening), observingNight(new Date(2026, 7, 5, 22, 0)));
});

test('the summary counts what a logbook is for', () => {
  const entries = [
    entry('ISS', new Date(2026, 7, 4, 21, 0).toISOString()),
    entry('ISS', new Date(2026, 7, 5, 0, 30).toISOString()), // same night, past midnight
    entry('ISS', new Date(2026, 7, 8, 22, 0).toISOString()),
    entry('Tiangong', new Date(2026, 7, 8, 22, 30).toISOString()),
  ];
  const summary = summarise(entries);

  assert.equal(summary.total, 4);
  assert.equal(summary.distinctSubjects, 2);
  assert.equal(summary.nights, 2, 'four sightings across two evenings');
  assert.deepEqual(summary.mostSeen[0], { subject: 'ISS', count: 3 });
  assert.equal(Date.parse(summary.firstObservedAt!) < Date.parse(summary.lastObservedAt!), true);
});

test('an empty logbook summarises to zero rather than to nothing', () => {
  const summary = summarise([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.nights, 0);
  assert.deepEqual(summary.mostSeen, []);
  assert.equal(summary.firstObservedAt, null);
});

test('the export is real CSV, including the awkward notes', () => {
  const entries = [
    entry('ISS', '2026-08-04T21:00:00Z', {
      satnum: '25544',
      magnitude: -3.1,
      maxElevationDeg: 68,
      seeing: 'excellent',
      note: 'Bright, "unmistakable", and it faded near the zenith,\nright into shadow.',
    }),
  ];
  const csv = entriesToCsv(entries);

  assert.ok(csv.startsWith('observed_at,subject,norad_id'));
  assert.ok(csv.includes('25544'));
  // A note containing quotes, commas and a newline must not break the row.
  assert.ok(csv.includes('""unmistakable""'), 'quotes are doubled');
  assert.ok(csv.includes('"Bright'), 'the field is quoted');

  // Split on newlines *outside* quotes, the way a CSV reader does — splitting
  // on raw newlines would be the very mistake this test exists to catch.
  const records = splitCsvRecords(csv);
  assert.equal(records.length, 2, 'header plus one row, with the note intact');
  assert.ok(records[1].includes('\n'), 'the embedded newline survives inside its field');
});

test('a valid entry is recognised and an invalid one is not', () => {
  assert.equal(isValidEntry(entry('ISS', '2026-08-04T21:00:00Z')), true);
  assert.equal(isValidEntry({ ...entry('ISS', '2026-08-04T21:00:00Z'), observedAt: 'never' }), false);
  assert.equal(isValidEntry({ ...entry('ISS', '2026-08-04T21:00:00Z'), subject: '' }), false);
  assert.equal(isValidEntry(undefined), false);
});


/** Newline splitting that respects quoted fields, as a CSV reader would. */
function splitCsvRecords(csv: string): string[] {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      // A doubled quote inside a quoted field is an escaped quote.
      if (inQuotes && csv[i + 1] === '"') {
        current += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      current += c;
    } else if (c === '\n' && !inQuotes) {
      records.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.length > 0) records.push(current);
  return records;
}
