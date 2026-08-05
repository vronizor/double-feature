import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb, migrate } from '../server/db.js';
import { upsertList } from '../scripts/seed.mjs';

/**
 * A seed list's identity.
 *
 * It was the NAME until v8, and `DECISIONS.md` had already recorded the
 * consequence as a trap: renaming a list in its seed file created a *second*
 * list beside the old one rather than renaming it, so every rename of a
 * shipped list needed a hand-written migration. These are the tests that make
 * `seed_key` the identity instead — the same fix `builtin_key` was for vibes,
 * and deliberately the same shape, so the two can be read together.
 *
 * None of this touches TMDB: `upsertList` is the list-level half of `seedList`
 * and is exported precisely so the duplicate-a-whole-list decision can be
 * tested without spending a network call.
 */
const GHIBLI = {
  name: 'Studio Ghibli',
  category: 'collection',
  source: 'a source',
  source_url: 'https://example.invalid/ghibli',
  short_name: 'Ghibli',
};

test('a seed list is created carrying its key', () => {
  const db = createTestDb();
  const list = upsertList(db, 'studio-ghibli', GHIBLI);

  assert.equal(list.seed_key, 'studio-ghibli');
  assert.equal(list.name, 'Studio Ghibli');
  assert.equal(list.name_custom, 0);
  // Active on arrival, so a fresh install can draw immediately.
  assert.equal(list.is_active, 1);
});

test('a re-seed finds the same list rather than making a second one', () => {
  const db = createTestDb();
  upsertList(db, 'studio-ghibli', GHIBLI);
  upsertList(db, 'studio-ghibli', GHIBLI);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lists').get().n, 1);
});

test('a rename in the seed file reaches a database that has already been seeded', () => {
  // The whole point. Before the key this produced two lists, and the fix was a
  // migration per rename.
  const db = createTestDb();
  const first = upsertList(db, 'studio-ghibli', GHIBLI);
  const second = upsertList(db, 'studio-ghibli', { ...GHIBLI, name: 'Ghibli' });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lists').get().n, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.name, 'Ghibli');
});

test('but a host who renamed it keeps their name for good', () => {
  const db = createTestDb();
  const list = upsertList(db, 'studio-ghibli', GHIBLI);
  // What the PATCH route does when a host renames a keyed list.
  db.prepare('UPDATE lists SET name = ?, name_custom = 1 WHERE id = ?').run('Miyazaki', list.id);

  const after = upsertList(db, 'studio-ghibli', { ...GHIBLI, name: 'Ghibli' });
  assert.equal(after.name, 'Miyazaki');
});

test('a name already taken by another list leaves the name alone and syncs the rest', () => {
  // `lists.name` is UNIQUE, so the alternative is aborting a seed run halfway.
  const db = createTestDb();
  const list = upsertList(db, 'studio-ghibli', GHIBLI);
  db.exec(`INSERT INTO lists (name, origin, is_active) VALUES ('Ghibli', 'custom', 0)`);

  const after = upsertList(db, 'studio-ghibli', {
    ...GHIBLI,
    name: 'Ghibli',
    short_name: 'SG',
  });
  assert.equal(after.id, list.id);
  assert.equal(after.name, 'Studio Ghibli');
  assert.equal(after.short_name, 'SG');
});

test('two different seed files never collapse into one list', () => {
  const db = createTestDb();
  upsertList(db, 'award-oscar-best-picture', { name: 'Oscar — Best Picture', short_name: 'Oscar' });
  upsertList(db, 'award-oscar-international', {
    name: 'Oscar — Best International Feature',
    short_name: 'Oscar Intl.',
  });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lists').get().n, 2);
});

/**
 * The one-time backfill. It is matched on the name each list has TODAY, which
 * is the only handle an already-seeded database offers — and the last time a
 * name is ever used as identity here.
 */
test('the migration keys the lists that are already on disk', () => {
  const db = createTestDb();
  // A database seeded before the column existed: real names, no keys.
  db.exec(`INSERT INTO lists (name, origin, is_active) VALUES
    ('Studio Ghibli', 'seed', 1),
    ('Oscar — Best Picture', 'seed', 1),
    ('Palme d’Or (Cannes)', 'seed', 1),
    ('My own list', 'custom', 0)`);

  migrate(db);

  const keyOf = (name) => db.prepare('SELECT seed_key FROM lists WHERE name = ?').get(name).seed_key;
  assert.equal(keyOf('Studio Ghibli'), 'studio-ghibli');
  assert.equal(keyOf('Oscar — Best Picture'), 'award-oscar-best-picture');
  assert.equal(keyOf('Palme d’Or (Cannes)'), 'award-palme-dor');
  // A custom list has no seed file and must stay unkeyed, or the partial
  // unique index is the only thing standing between it and a collision.
  assert.equal(keyOf('My own list'), null);
});

test('the migration does not touch a list a host had already renamed', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (name, origin, is_active) VALUES ('Ghibli', 'seed', 1)`);

  migrate(db);

  assert.equal(db.prepare(`SELECT seed_key FROM lists WHERE name = 'Ghibli'`).get().seed_key, null);
});

test('the migration is idempotent and never re-claims a key', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (name, origin, is_active, seed_key) VALUES
    ('Something Else Entirely', 'seed', 1, 'studio-ghibli'),
    ('Studio Ghibli', 'seed', 1, NULL)`);

  migrate(db);
  migrate(db);

  // The key is spoken for, so the second row stays unkeyed rather than the
  // migration crashing on the unique index.
  const rows = db.prepare('SELECT name, seed_key FROM lists ORDER BY name').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].seed_key, 'studio-ghibli');
  assert.equal(rows[1].seed_key, null);
});
