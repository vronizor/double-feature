import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb, migrate } from '../server/db.js';
import { candidateRows, parseArgs } from '../scripts/audit-matches.mjs';

/**
 * The read-only audit for rows the dead ambiguity guard let through.
 *
 * `inspect()` is not tested here: it is a thin wrapper over the matcher's own
 * `searchMovie` and `scoreCandidate`, both already covered, and testing it
 * would mean stubbing the network to re-assert what `tmdb.test.js` asserts.
 * What IS worth pinning is which rows the audit asks about, because every
 * mistake there is silent — too few and it reports good news it did not earn.
 */
function seed(db) {
  db.exec(`
    INSERT INTO lists (id, name, origin) VALUES
      (1, 'España', 'seed'), (2, 'Criterion', 'seed');
    INSERT INTO movies (tmdb_id, title, year, is_manual) VALUES
      (101, 'Vertigo', 1958, 0), (102, 'Psycho', 1960, 0), (103, 'Typed By Hand', 1999, 0);
    INSERT INTO movies (tmdb_id, title, year, is_manual) VALUES
      (-1000000001, 'Not On TMDB', 1980, 1);
    INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status) VALUES
      (1, 101, 'Vertigo', 1958, 'resolved'),
      (1, 102, 'Psycho', 1960, 'resolved'),
      (2, 103, 'Typed By Hand', 1999, 'resolved'),
      (1, -1000000001, 'Not On TMDB', 1980, 'resolved'),
      (2, NULL, 'Never Matched', 1970, 'unmatched'),
      (2, NULL, 'Half Matched', 1971, 'needs_review');
  `);
}

test('only resolved rows attached to a film are audited', () => {
  const db = createTestDb();
  migrate(db);
  seed(db);

  const rows = candidateRows(db, {});
  const titles = rows.map((row) => row.raw_title).sort();

  // `unmatched` and `needs_review` rows are already visible on the
  // reconciliation screen — they are not the failure this audit hunts.
  assert.ok(!titles.includes('Never Matched'));
  assert.ok(!titles.includes('Half Matched'));
});

test('manual entries are excluded, because nothing matched them', () => {
  const db = createTestDb();
  migrate(db);
  seed(db);

  const titles = candidateRows(db, {}).map((row) => row.raw_title);
  // Somebody typed it, so there was never a second candidate to miss. Asking
  // TMDB about it would spend a call to learn nothing.
  assert.ok(!titles.includes('Not On TMDB'));
  assert.deepEqual(titles.sort(), ['Psycho', 'Typed By Hand', 'Vertigo']);
});

test('a list filter narrows the audit', () => {
  const db = createTestDb();
  migrate(db);
  seed(db);

  const rows = candidateRows(db, { list: 'españa' });
  assert.deepEqual(rows.map((row) => row.raw_title).sort(), ['Psycho', 'Vertigo']);
});

test('the audit defaults to a sample, not to every row', () => {
  // A full pass is one TMDB search per row across thousands of rows. The
  // default must be the cheap question, with the expensive one opt-in.
  assert.deepEqual(parseArgs([]), { all: false, sample: 300, list: null });
  assert.equal(parseArgs(['--all']).all, true);
  assert.equal(parseArgs(['--sample', '50']).sample, 50);
  assert.equal(parseArgs(['--list', 'España']).list, 'españa');
  // A junk sample size falls back rather than auditing zero rows and
  // reporting that nothing is wrong.
  assert.equal(parseArgs(['--sample', 'lots']).sample, 300);
});
