import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../server/db.js';
import { awardsByTmdbId } from '../server/movies.js';
import { awardLabel, shortAwardName } from '../public/dom.js';

function seed() {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, kind, category, is_active) VALUES
    (1, 'Palme d’Or (Cannes)', 'seed', 'awards', 1),
    (2, 'Oscar — Best Picture', 'seed', 'awards', 1),
    (3, 'BAFTA — Best Film', 'seed', 'awards', 1),
    (4, 'TSPDT 1,000 Greatest Films', 'seed', 'canon', 1)`);

  const add = (tmdbId, title) =>
    db.prepare('INSERT INTO movies (tmdb_id, title, year) VALUES (?, ?, 2019)').run(tmdbId, title);
  add(1, 'Parasite');
  add(2, 'Unawarded Film');

  const link = (listId, tmdbId, awardYear, status = 'resolved') =>
    db
      .prepare(
        `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, award_year, status)
         VALUES (?, ?, 'x', 2019, ?, ?)`,
      )
      .run(listId, tmdbId, awardYear, status);

  link(1, 1, 2019); // Palme d'Or 2019
  link(2, 1, 2020); // Oscar 2020
  link(3, 1, null); // BAFTA, year unknown
  link(4, 1, null); // canon list — must NOT appear as an award
  link(4, 2, null);
  return db;
}

test('awards are limited to award-category lists', () => {
  const db = seed();
  const awards = awardsByTmdbId(db, [1]).get(1);
  assert.equal(awards.length, 3, 'the canon list is not an award');
  assert.ok(!awards.some((a) => a.name.includes('TSPDT')));
});

test('awards read as a chronology, with unknown years last', () => {
  // SQLite sorts NULL lowest, so without the explicit `award_year IS NULL`
  // ordering the undated BAFTA would lead rather than trail.
  const db = seed();
  const awards = awardsByTmdbId(db, [1]).get(1);
  assert.deepEqual(
    awards.map((a) => a.year),
    [2019, 2020, null],
  );
});

test('a film with no awards is absent from the map rather than present and empty', () => {
  const db = seed();
  const map = awardsByTmdbId(db, [1, 2]);
  assert.ok(map.has(1));
  assert.ok(!map.has(2));
});

test('awardsByTmdbId tolerates an empty id list', () => {
  const db = seed();
  assert.equal(awardsByTmdbId(db, []).size, 0);
});

test('unresolved memberships never count as awards', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, kind, category, is_active)
           VALUES (1, 'Palme d’Or (Cannes)', 'seed', 'awards', 1)`);
  db.prepare('INSERT INTO movies (tmdb_id, title, year) VALUES (7, ?, 2000)').run('Pending');
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, award_year, status)
     VALUES (1, 7, 'Pending', 2000, 2000, 'needs_review')`,
  ).run();
  assert.equal(awardsByTmdbId(db, [7]).size, 0);
});

// --- Display helpers (dom.js is DOM-free at module scope) -------------------

test('the two Oscars shorten to distinguishable labels', () => {
  // Both would collapse to "Oscar" under naive parsing, and a film that won
  // both would read "Oscar 2020 · Oscar 2020".
  assert.equal(shortAwardName('Oscar — Best Picture'), 'Oscar');
  assert.equal(shortAwardName('Oscar — Best International Feature'), 'Oscar Intl.');
});

test('an unknown award name still shortens sensibly', () => {
  assert.equal(shortAwardName('Golden Frog (Camerimage)'), 'Golden Frog');
  assert.equal(shortAwardName('Some Award — Best Thing'), 'Some Award');
  assert.equal(shortAwardName('Bare Name'), 'Bare Name');
});

test('awardLabel omits the year entirely when it is unknown', () => {
  assert.equal(awardLabel({ name: 'Palme d’Or (Cannes)', year: 2019 }), 'Palme d’Or 2019');
  assert.equal(awardLabel({ name: 'César — Meilleur Film', year: null }), 'César');
  assert.equal(
    awardLabel({ name: 'Oscar — Best Picture', year: 2020 }, { short: false }),
    'Oscar — Best Picture 2020',
  );
});
