#!/usr/bin/env node
/**
 * Populates the per-membership columns on list_movies from the seed files:
 *
 *   rank        a film's position on a ranked list (TSPDT #1, Sight & Sound #12)
 *   award_year  the ceremony year, for award lists
 *
 *   npm run backfill-lists            # every seed list that carries either
 *   npm run backfill-lists -- tspdt   # just the ones whose filename matches
 *
 * Why this exists rather than just re-running the seeder: seed.mjs skips any
 * entry that already landed (keyed on raw_title + raw_year) so that a re-run
 * doesn't re-spend TMDB calls. That skip is per-ENTRY, so rows written before
 * one of these columns existed would keep it NULL forever no matter how many
 * times you re-seed. This walks those existing rows instead of creating them.
 *
 * Makes no TMDB calls at all — both values come from the committed seed JSON,
 * not from the API — and is safely re-runnable: it only writes rows whose value
 * actually differs from the file.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { ROOT } from '../server/config.js';
import { getDb, closeDb } from '../server/db.js';

const SEEDS = join(ROOT, 'seeds');

// Seed-file key -> list_movies column. Both are per-membership rather than
// per-film: a movie can be #3 on one list and unranked on another, and can win
// two different awards in two different years.
const FIELDS = [
  { key: 'rank', column: 'rank' },
  { key: 'award_year', column: 'award_year' },
];

async function backfillList(db, file) {
  const payload = JSON.parse(await readFile(join(SEEDS, file), 'utf8'));
  const entries = payload.entries ?? [];
  const present = FIELDS.filter((f) => entries.some((e) => Number.isInteger(e[f.key])));
  if (present.length === 0) return null;

  const list = db.prepare('SELECT id FROM lists WHERE name = ?').get(payload.name);
  if (!list) return { name: payload.name, missing: true };

  // Same identity the seeder writes rows under. raw_year needs the IS NULL
  // branch because `raw_year = NULL` is never true in SQL, so an entry with no
  // year would silently match nothing.
  const withYear = db.prepare(
    'SELECT * FROM list_movies WHERE list_id = ? AND raw_title = ? AND raw_year = ?',
  );
  const withoutYear = db.prepare(
    'SELECT * FROM list_movies WHERE list_id = ? AND raw_title = ? AND raw_year IS NULL',
  );

  const stats = {};
  for (const field of present) stats[field.key] = { updated: 0, same: 0, notFound: 0 };

  for (const entry of entries) {
    const row =
      entry.year === undefined || entry.year === null
        ? withoutYear.get(list.id, entry.title)
        : withYear.get(list.id, entry.title, entry.year);

    for (const field of present) {
      const value = entry[field.key];
      if (!Number.isInteger(value)) continue;
      if (!row) {
        stats[field.key].notFound += 1;
        continue;
      }
      if (row[field.column] === value) {
        stats[field.key].same += 1;
        continue;
      }
      db.prepare(`UPDATE list_movies SET ${field.column} = ? WHERE id = ?`).run(value, row.id);
      stats[field.key].updated += 1;
    }
  }

  return { name: payload.name, stats };
}

async function main() {
  const filters = process.argv.slice(2).map((a) => a.toLowerCase());
  const files = (await readdir(SEEDS))
    .filter((f) => f.endsWith('.json'))
    .filter((f) => filters.length === 0 || filters.some((x) => f.toLowerCase().includes(x)))
    .sort();

  const db = getDb();
  let touched = 0;

  for (const file of files) {
    const result = await backfillList(db, file);
    if (!result) continue;
    touched += 1;

    if (result.missing) {
      console.log(`${result.name.slice(0, 34).padEnd(35)} not seeded yet — skipped`);
      continue;
    }
    const parts = Object.entries(result.stats).map(
      ([key, s]) => `${key}: ${s.updated} updated, ${s.same} already correct` +
        (s.notFound ? `, ${s.notFound} not in db` : ''),
    );
    console.log(`${result.name.slice(0, 34).padEnd(35)} ${parts.join('  |  ')}`);
  }

  if (touched === 0) console.log('No seed lists matched that carry rank or award_year.');

  const stat = db
    .prepare(
      `SELECT l.name,
              COUNT(lm.rank)       AS ranked,
              COUNT(lm.award_year) AS awarded,
              COUNT(*)             AS total
       FROM lists l JOIN list_movies lm ON lm.list_id = l.id
       GROUP BY l.id HAVING ranked > 0 OR awarded > 0 ORDER BY l.name`,
    )
    .all();
  if (stat.length) {
    console.log('\nPer-membership data now in the database:');
    for (const row of stat) {
      const bits = [];
      if (row.ranked) bits.push(`${row.ranked}/${row.total} ranked`);
      if (row.awarded) bits.push(`${row.awarded}/${row.total} with award year`);
      console.log(`  ${row.name.slice(0, 38).padEnd(39)} ${bits.join(', ')}`);
    }
  }

  closeDb();
}

main();
