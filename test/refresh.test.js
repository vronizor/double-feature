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
