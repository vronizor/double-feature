#!/usr/bin/env node
/**
 * Populates list_movies.rank from the seed files.
 *
 *   npm run backfill-ranks           # every ranked seed list
 *   npm run backfill-ranks -- tspdt  # just the ones whose filename matches
 *
 * Why this exists rather than just re-running the seeder: seed.mjs skips any
 * entry that already landed (keyed on raw_title + raw_year) so that a re-run
 * doesn't re-spend TMDB calls. That skip is per-ENTRY, so rows written before
 * the rank column existed would keep rank = NULL forever no matter how many
 * times you re-seed. This walks those existing rows instead of creating them.
 *
 * Makes no TMDB calls at all — rank comes from the committed seed JSON, not
 * from the API — and is safely re-runnable: it only writes rows whose rank
 * actually differs from the file.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROOT } from '../server/config.js';
import { getDb, closeDb } from '../server/db.js';

const SEEDS = join(ROOT, 'seeds');

async function backfillList(db, file) {
  const payload = JSON.parse(await readFile(join(SEEDS, file), 'utf8'));
  const ranked = (payload.entries ?? []).filter((e) => Number.isInteger(e.rank));
  if (ranked.length === 0) return null;

  const name = payload.name;
  const list = db.prepare('SELECT id FROM lists WHERE name = ?').get(name);
  if (!list) return { name, missing: true };

  // Same identity the seeder writes rows under. raw_year needs the IS NULL
  // branch because `raw_year = NULL` is never true in SQL, so an entry with no
  // year would silently match nothing.
  const withYear = db.prepare(
    'SELECT id, rank FROM list_movies WHERE list_id = ? AND raw_title = ? AND raw_year = ?',
  );
  const withoutYear = db.prepare(
    'SELECT id, rank FROM list_movies WHERE list_id = ? AND raw_title = ? AND raw_year IS NULL',
  );
  const update = db.prepare('UPDATE list_movies SET rank = ? WHERE id = ?');

  let updated = 0;
  let alreadyCorrect = 0;
  let notFound = 0;

  for (const entry of ranked) {
    const row =
      entry.year === undefined || entry.year === null
        ? withoutYear.get(list.id, entry.title)
        : withYear.get(list.id, entry.title, entry.year);

    if (!row) {
      notFound += 1;
      continue;
    }
    if (row.rank === entry.rank) {
      alreadyCorrect += 1;
      continue;
    }
    update.run(entry.rank, row.id);
    updated += 1;
  }

  return { name, total: ranked.length, updated, alreadyCorrect, notFound };
}

async function main() {
  const filters = process.argv.slice(2).map((a) => a.toLowerCase());
  const files = (await readdir(SEEDS))
    .filter((f) => f.endsWith('.json'))
    .filter((f) => filters.length === 0 || filters.some((x) => f.toLowerCase().includes(x)))
    .sort();

  const db = getDb();
  let anyRanked = false;

  for (const file of files) {
    const result = await backfillList(db, file);
    if (!result) continue; // unranked list (Criterion, Ghibli) — nothing to do
    anyRanked = true;

    if (result.missing) {
      console.log(`${result.name.slice(0, 34).padEnd(35)} not seeded yet — skipped`);
      continue;
    }
    console.log(
      `${result.name.slice(0, 34).padEnd(35)} ${String(result.updated).padStart(5)} updated  ` +
        `${String(result.alreadyCorrect).padStart(5)} already correct  ` +
        `${String(result.notFound).padStart(4)} not in db`,
    );
  }

  if (!anyRanked) {
    console.log('No ranked seed lists matched. (Only TSPDT and Sight & Sound carry ranks.)');
  }

  const stat = db
    .prepare(
      `SELECT l.name, COUNT(lm.rank) AS ranked, COUNT(*) AS total
       FROM lists l JOIN list_movies lm ON lm.list_id = l.id
       GROUP BY l.id HAVING ranked > 0 ORDER BY l.name`,
    )
    .all();
  if (stat.length) {
    console.log('\nRanked rows now in the database:');
    for (const row of stat) {
      console.log(`  ${row.name.slice(0, 40).padEnd(41)} ${row.ranked}/${row.total}`);
    }
  }

  closeDb();
}

main();
