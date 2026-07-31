#!/usr/bin/env node
/**
 * Fills in `movies.imdb_id` for films cached before that column existed.
 *
 *   npm run backfill-imdb-ids
 *
 * New films get it for free -- `toMovie` carries it and `upsertMovie` stores
 * it -- so this is a one-off for the existing library, not something that
 * needs to keep running.
 *
 * Deliberately NOT done by adding imdb_id to the refresh job's INCOMPLETE
 * predicate, which would have been the tempting one-liner. That predicate
 * decides what looks broken enough to re-fetch daily, and a legitimately empty
 * field there is exactly the bug that made five films re-fetch forever and
 * permanently head the queue. Some films genuinely have no IMDb id: shorts,
 * and a few TV-sourced entries. They would never converge.
 *
 * So this runs once, records what it found, and stops. A film with no id after
 * a successful fetch is left alone -- it has no IMDb entry, which is an answer
 * rather than a failure.
 */

import { getDb, closeDb } from '../server/db.js';
import { getMovie } from '../server/tmdb.js';

const BATCH = 8; // matches the TMDB semaphore; more just queues behind it

async function main() {
  const db = getDb();
  // Manual entries have no TMDB page at all, so there is nothing to ask for.
  const pending = db
    .prepare('SELECT tmdb_id, title FROM movies WHERE imdb_id IS NULL AND is_manual = 0 AND tmdb_id > 0')
    .all();

  console.log(`${pending.length} films need an IMDb id`);
  if (pending.length === 0) return;

  const update = db.prepare('UPDATE movies SET imdb_id = ? WHERE tmdb_id = ?');
  let filled = 0;
  let none = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (row) => {
        try {
          return { row, movie: await getMovie(row.tmdb_id) };
        } catch (error) {
          return { row, error };
        }
      }),
    );
    for (const { row, movie, error } of results) {
      if (error) {
        failed += 1;
        console.warn(`  ${row.title}: ${error.message}`);
      } else if (movie?.imdb_id) {
        update.run(movie.imdb_id, row.tmdb_id);
        filled += 1;
      } else {
        // A real answer, not a failure: this film has no IMDb entry.
        none += 1;
      }
    }
    process.stdout.write(`\r  ${Math.min(i + BATCH, pending.length)}/${pending.length}`);
  }

  console.log(`\nfilled ${filled}, no IMDb entry ${none}, failed ${failed}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
