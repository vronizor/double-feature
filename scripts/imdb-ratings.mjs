#!/usr/bin/env node
/**
 * Pulls IMDb's public ratings dataset and stores the two numbers we want.
 *
 *   npm run imdb-ratings
 *
 * Why this exists: TMDB's score and IMDb's disagree, and often interestingly.
 * A second opinion beside the first is worth more than either alone when the
 * question is "will we enjoy this tonight".
 *
 * THE LICENCE RULE, AND IT IS NOT NEGOTIABLE. The dataset is licensed for
 * personal and non-commercial use, which this app is. It must never be
 * committed to this repo. So it is downloaded at run time, streamed, and
 * thrown away: only the derived numbers for films already in the library are
 * kept. That is the same distinction .gitignore already enforces for the
 * database itself.
 *
 * The join is EXACT. `movies.imdb_id` comes from TMDB's own detail response,
 * so there is no title matching here and no fuzzy anything -- which is the
 * whole reason IMDb was chosen over Letterboxd and SensCritique.
 *
 * The file is ~8 MB gzipped and 1.7 million rows. It is streamed rather than
 * read into memory, and every row is discarded unless its id is one we hold:
 * a Map of the library's ids is a few thousand entries, against 1.7 million we
 * would otherwise be sorting through.
 */

import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

import { getDb, closeDb, inTransaction } from '../server/db.js';

const DATASET = 'https://datasets.imdbws.com/title.ratings.tsv.gz';

// Below this, a rating is noise rather than a second opinion -- the same
// reasoning that put a vote floor on the Modern Classics query, where 1,000
// votes still returned Gabriel's Inferno. Stored anyway, so the floor can be
// changed without re-downloading; this only decides what gets reported.
const MEANINGFUL_VOTES = 1000;

async function main() {
  const db = getDb();

  // Only films we actually hold, and only those with an id to join on.
  const wanted = new Map(
    db
      .prepare('SELECT imdb_id, tmdb_id FROM movies WHERE imdb_id IS NOT NULL')
      .all()
      .map((row) => [row.imdb_id, row.tmdb_id]),
  );
  const total = db.prepare('SELECT COUNT(*) AS n FROM movies').get().n;
  console.log(`${wanted.size} of ${total} films carry an IMDb id`);
  if (wanted.size === 0) {
    console.log('Nothing to join on. Run `npm run backfill-imdb-ids` first.');
    return;
  }

  const response = await fetch(DATASET);
  if (!response.ok) throw new Error(`IMDb dataset responded ${response.status}`);

  const lines = createInterface({
    input: Readable.fromWeb(response.body).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  const found = [];
  let scanned = 0;
  for await (const line of lines) {
    scanned += 1;
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const id = line.slice(0, tab);
    const tmdbId = wanted.get(id);
    if (tmdbId === undefined) continue;

    const [, rating, votes] = line.split('\t');
    const score = Number(rating);
    const count = Number(votes);
    // A malformed row is skipped rather than written as null: overwriting a
    // good rating with nothing because one line was odd is the wrong trade.
    if (!Number.isFinite(score) || !Number.isInteger(count)) continue;
    found.push({ tmdbId, score, count });
  }

  const update = db.prepare('UPDATE movies SET imdb_rating = ?, imdb_votes = ? WHERE tmdb_id = ?');
  inTransaction(db, () => {
    for (const row of found) update.run(row.score, row.count, row.tmdbId);
  });

  const meaningful = found.filter((row) => row.count >= MEANINGFUL_VOTES).length;
  console.log(`scanned ${scanned.toLocaleString()} rows, matched ${found.length}`);
  console.log(`${meaningful} have at least ${MEANINGFUL_VOTES} votes`);
  console.log(`${wanted.size - found.length} carried an id with no rating in the dataset`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeDb);
