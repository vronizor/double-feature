#!/usr/bin/env node
/**
 * Re-fetches every cached movie missing a field added after it was first
 * resolved (vote_average, countries, spoken languages), ignoring the usual
 * six-month refresh age. The daily refresh job does this gradually too
 * (250/run), but that would take days to reach a library already fully
 * seeded — this does it all in one pass. Safe to re-run: each schema addition
 * just widens what counts as "incomplete", so running it again after adding a
 * new cached field only re-fetches the movies actually missing that field.
 *
 *   npm run backfill
 */

import { hasTmdbCredentials } from '../server/config.js';
import { getDb, closeDb } from '../server/db.js';
import { upsertMovie } from '../server/movies.js';
import { findIncompleteMovies, refetch } from '../server/refresh.js';

const WORKERS = 8;

async function main() {
  if (!hasTmdbCredentials()) {
    console.error('No TMDB credentials found — set TMDB_API_KEY or TMDB_ACCESS_TOKEN in .env first.');
    process.exit(1);
  }

  const db = getDb();
  const missing = findIncompleteMovies(db);

  if (missing.length === 0) {
    console.log('Nothing to backfill — every cached movie already has its rating, country and language data.');
    closeDb();
    return;
  }

  console.log(`Backfilling ${missing.length} movie(s) missing rating/country/language data…`);
  let done = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < missing.length) {
      const row = missing[cursor++];
      try {
        const movie = await refetch(row);
        if (movie) upsertMovie(db, movie);
        else failed += 1;
      } catch (error) {
        failed += 1;
        if (process.env.DEBUG) console.error(`\n  ${row.tmdb_id}: ${error.message}`);
      }
      done += 1;
      if (done % 25 === 0 || done === missing.length) {
        process.stdout.write(`\r  ${done}/${missing.length}${failed ? ` (${failed} failed)` : ''}`);
      }
    }
  };

  await Promise.all(Array.from({ length: WORKERS }, worker));
  console.log(`\nDone — ${done - failed} updated, ${failed} failed.`);
  closeDb();
}

main();
