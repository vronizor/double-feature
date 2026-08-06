import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb, migrate } from '../server/db.js';
import { upsertList } from '../scripts/seed.mjs';
import { findSeededList } from '../scripts/backfill-list-fields.mjs';

/**
 * How the backfill script finds the list a seed file describes.
 *
 * It looked it up by NAME, which was correct until v8 gave seed lists a
 * `seed_key` and let a host rename one from the Lists tab. After that the two
 * halves disagreed: the seeder found the list by key and left the host's name
 * alone, while the backfill asked for the seed file's name, found nothing, and
 * printed "not seeded yet" for a list sitting right there fully populated.
 *
 * Nothing failed, no row was wrong, and the repair this script exists to do
 * simply did not happen — which is the shape of every trap in `DECISIONS.md`
 * §3. So the test that matters is the RENAMED case, not the happy one.
 */
const CESAR = {
  name: 'César — Meilleur Film',
  category: 'awards',
  short_name: 'César',
  source: 'fr.wikipedia',
  source_url: 'https://example.invalid/cesar',
};

test('a seed list is found by its key', () => {
  const db = createTestDb();
  migrate(db);
  upsertList(db, 'award-cesar-best-film', CESAR);

  assert.equal(findSeededList(db, 'award-cesar-best-film').name, 'César — Meilleur Film');
});

test('and is STILL found after the host renames it', () => {
  const db = createTestDb();
  migrate(db);
  const list = upsertList(db, 'award-cesar-best-film', CESAR);

  // Exactly what PATCH /api/lists/:id does when the name actually changes.
  db.prepare('UPDATE lists SET name = ?, name_custom = 1 WHERE id = ?').run('Les César', list.id);

  const found = findSeededList(db, 'award-cesar-best-film');
  assert.ok(found, 'a renamed list must not read as "not seeded yet"');
  // The host's name, not the seed file's — the report should say what they see.
  assert.equal(found.name, 'Les César');
});

test('a key that was never seeded is null, not a throw', () => {
  const db = createTestDb();
  migrate(db);

  assert.equal(findSeededList(db, 'award-locarno-pardo-doro'), null);
});
