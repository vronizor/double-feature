import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../server/db.js';
import { hydrateMovies, createManualMovie } from '../server/movies.js';

function seed() {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, kind, is_active) VALUES
    (1, 'Criterion', 'seed', 1),
    (2, 'Sight and Sound', 'seed', 1)`);
  db.prepare(
    `INSERT INTO movies (tmdb_id, title, year) VALUES (?, ?, ?)`,
  ).run(1, 'On Two Lists', 1960);
  db.prepare(
    `INSERT INTO movies (tmdb_id, title, year) VALUES (?, ?, ?)`,
  ).run(2, 'On One List', 1970);
  db.prepare(
    `INSERT INTO movies (tmdb_id, title, year) VALUES (?, ?, ?)`,
  ).run(3, 'Needs Review Only', 1980);

  const link = (listId, tmdbId, status) =>
    db
      .prepare(
        `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(listId, tmdbId, 'x', 2000, status);

  link(1, 1, 'resolved');
  link(2, 1, 'resolved');
  link(1, 2, 'resolved');
  // A needs_review row pointing at a real tmdb_id shouldn't happen in practice
  // (tmdb_id is only set once resolved), but the "lists" subquery should
  // still only ever count resolved rows, defensively.
  link(2, 3, 'needs_review');

  return db;
}

test('hydrateMovies reports every list a film resolves on, alphabetically', () => {
  const db = seed();
  const [movie] = hydrateMovies(db, [1]);
  assert.equal(movie.lists, 'Criterion, Sight and Sound');
});

test('list ordering is case-insensitive, not SQLite\'s default byte-wise order', () => {
  // Default BINARY collation would sort "TSPDT" before "The Criterion
  // Collection" (uppercase 'S' < lowercase 'h'), which isn't alphabetical in
  // any human sense — COLLATE NOCASE fixes that.
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, kind, is_active) VALUES
    (1, 'TSPDT 1,000 Greatest Films', 'seed', 1),
    (2, 'The Criterion Collection', 'seed', 1)`);
  db.prepare(`INSERT INTO movies (tmdb_id, title, year) VALUES (1, 'A Film', 1960)`).run();
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status) VALUES (1, 1, 'x', 1960, 'resolved')`,
  ).run();
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status) VALUES (2, 1, 'x', 1960, 'resolved')`,
  ).run();

  const [movie] = hydrateMovies(db, [1]);
  assert.equal(movie.lists, 'The Criterion Collection, TSPDT 1,000 Greatest Films');
});

test('hydrateMovies reports a single list plainly', () => {
  const db = seed();
  const [movie] = hydrateMovies(db, [2]);
  assert.equal(movie.lists, 'Criterion');
});

test('hydrateMovies only counts resolved list_movies rows', () => {
  const db = seed();
  const [movie] = hydrateMovies(db, [3]);
  assert.equal(movie.lists, null);
});

test('hydrateMovies preserves request order and drops unknown ids', () => {
  const db = seed();
  const movies = hydrateMovies(db, [2, 999, 1]);
  assert.deepEqual(movies.map((m) => m.tmdb_id), [2, 1]);
});

// --- createManualMovie: proposals that aren't on TMDB at all ---------------

test('createManualMovie mints an id far below any real TMDB id', () => {
  const db = createTestDb();
  const tmdbId = createManualMovie(db, { title: 'A Home Movie', year: 2019 });
  assert.ok(tmdbId <= -1_000_000_000);

  const [movie] = hydrateMovies(db, [tmdbId]);
  assert.equal(movie.title, 'A Home Movie');
  assert.equal(movie.year, 2019);
  assert.equal(movie.media_type, 'movie');
  assert.equal(movie.is_manual, 1);
  // Nothing TMDB-derived exists for it.
  assert.equal(movie.poster_path, null);
  assert.equal(movie.vote_average, null);
});

test('createManualMovie never collides across repeated calls', () => {
  const db = createTestDb();
  const ids = new Set();
  for (let i = 0; i < 10; i += 1) {
    ids.add(createManualMovie(db, { title: `Entry ${i}`, year: null }));
  }
  assert.equal(ids.size, 10, 'every call minted a distinct id');
});

test('createManualMovie rejects a blank title', () => {
  const db = createTestDb();
  assert.throws(() => createManualMovie(db, { title: '   ', year: null }));
  assert.throws(() => createManualMovie(db, { title: undefined, year: null }));
});

test('createManualMovie tolerates a missing or non-integer year', () => {
  const db = createTestDb();
  const id1 = createManualMovie(db, { title: 'No Year', year: null });
  const id2 = createManualMovie(db, { title: 'Bad Year', year: 'not-a-year' });
  assert.equal(hydrateMovies(db, [id1])[0].year, null);
  assert.equal(hydrateMovies(db, [id2])[0].year, null);
});
