import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../server/db.js';
import { createManualMovie } from '../server/movies.js';
import { findStaleMovies, findIncompleteMovies } from '../server/refresh.js';

test('a manual entry is never treated as incomplete — it has no TMDB source to fetch', () => {
  const db = createTestDb();
  createManualMovie(db, { title: 'A Home Movie', year: 2019 });

  // Missing vote_average/countries/languages/original_title would otherwise
  // flag it "incomplete" forever, since refetch() has nothing to fetch it
  // from — findIncompleteMovies must exclude it regardless.
  assert.deepEqual(findIncompleteMovies(db), []);
});

test('a manual entry is never picked up by the staleness sweep either', () => {
  const db = createTestDb();
  const manualId = createManualMovie(db, { title: 'A Home Movie', year: 2019 });
  // Force it to look "aged out" the way a real stale row would.
  db.prepare(`UPDATE movies SET refreshed_at = datetime('now', '-1 year') WHERE tmdb_id = ?`).run(manualId);

  assert.deepEqual(findStaleMovies(db), []);
});

test('an ordinary incomplete movie is still caught normally', () => {
  const db = createTestDb();
  db.prepare(
    `INSERT INTO movies (tmdb_id, title, year, media_type, is_manual) VALUES (1, 'Real Film', 1990, 'movie', 0)`,
  ).run();

  const incomplete = findIncompleteMovies(db);
  assert.equal(incomplete.length, 1);
  assert.equal(incomplete[0].tmdb_id, 1);
});

test('a film TMDB has no spoken languages for is not incomplete forever', () => {
  // Measured against the live API: /movie/1578 (Raging Bull) and /movie/637
  // (Life Is Beautiful) both return an empty spoken_languages, so `languages`
  // stays NULL however many times the row is re-fetched. While the INCOMPLETE
  // predicate included that column, five rows in a 2,460-film library were
  // re-fetched every single day — and, because incomplete rows sort first,
  // permanently occupied the head of the 250-row daily queue.
  const db = createTestDb();
  db.prepare(
    `INSERT INTO movies (tmdb_id, title, year, media_type, is_manual, vote_average,
                         original_title, countries, languages, refreshed_at)
     VALUES (1578, 'Raging Bull', 1980, 'movie', 0, 8.1, 'Raging Bull',
             'United States of America', NULL, datetime('now'))`,
  ).run();

  assert.deepEqual(findIncompleteMovies(db), [], 'an empty languages list is data, not damage');
  assert.deepEqual(findStaleMovies(db), [], 'and it must not head the daily queue either');
});

test('a row that has never been fetched at all is still caught', () => {
  // The other side of narrowing INCOMPLETE: a row that never went through
  // toMovie() has no vote_average, and must still be picked up.
  const db = createTestDb();
  db.prepare(
    `INSERT INTO movies (tmdb_id, title, media_type, is_manual, refreshed_at)
     VALUES (99, 'Never Fetched', 'movie', 0, datetime('now'))`,
  ).run();

  assert.equal(findIncompleteMovies(db).length, 1);
});
