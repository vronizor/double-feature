import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { migrate, SCHEMA } from '../server/db.js';

/**
 * The upgrade path, which is the one path that had no coverage at all.
 *
 * `createTestDb()` execs SCHEMA and stops, and the API tests run against an
 * empty temp file — so in both cases every column already exists and every data
 * migration finds nothing to do. The code that actually runs in production,
 * against a database with the OLD shape and real rows in it, was never
 * executed by a test. It is also the only code here that can destroy something
 * unrecoverable: it now contains ALTER TABLE ... RENAME COLUMN and DELETE FROM.
 *
 * So these tests do the one thing the others cannot: build a v2/v3-shaped
 * database by hand and upgrade it.
 */
function oldShapedDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');

  // Deliberately hand-written rather than derived from SCHEMA: the point is to
  // reproduce what is actually on disk on an older install. Note `kind` rather
  // than `origin`, and no rank / award_year / short_name / query_json columns.
  db.exec(`
    CREATE TABLE lists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL UNIQUE,
      kind       TEXT    NOT NULL CHECK (kind IN ('seed', 'custom')),
      category   TEXT,
      is_active  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE movies (
      tmdb_id      INTEGER PRIMARY KEY,
      title        TEXT    NOT NULL,
      year         INTEGER,
      -- Present since v1, so every real database has it. Omitting it made the
      -- fixture older than any database that has ever existed, and SCHEMA's
      -- index over it failed for a reason no user could hit.
      original_language TEXT,
      refreshed_at TEXT    NOT NULL DEFAULT (datetime('now')),
      watched      INTEGER NOT NULL DEFAULT 0,
      watched_at   TEXT
    );
    CREATE TABLE list_movies (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id   INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      tmdb_id   INTEGER          REFERENCES movies(tmdb_id) ON DELETE SET NULL,
      raw_title TEXT    NOT NULL,
      raw_year  INTEGER,
      status    TEXT    NOT NULL CHECK (status IN ('resolved', 'needs_review', 'unmatched'))
    );
    CREATE TABLE list_tags (
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      tag     TEXT    NOT NULL,
      PRIMARY KEY (list_id, tag)
    );
    CREATE TABLE vibes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL UNIQUE,
      is_builtin   INTEGER NOT NULL DEFAULT 0,
      filters_json TEXT,
      position     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE vibe_tags (
      vibe_id INTEGER NOT NULL REFERENCES vibes(id) ON DELETE CASCADE,
      tag     TEXT    NOT NULL,
      PRIMARY KEY (vibe_id, tag)
    );
    CREATE TABLE vibe_lists (
      vibe_id INTEGER NOT NULL REFERENCES vibes(id) ON DELETE CASCADE,
      list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      PRIMARY KEY (vibe_id, list_id)
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  db.exec(`
    INSERT INTO lists (id, name, kind, category, is_active) VALUES
      (1, 'The Criterion Collection',        'seed',   'canon',   1),
      (2, 'Crowd-Pleasers (last 10 years)',  'seed',   'dynamic', 1),
      (3, 'My Shortlist',                    'custom', NULL,      0);
    INSERT INTO movies (tmdb_id, title, year, watched) VALUES (346, 'Seven Samurai', 1954, 1);
    INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
      VALUES (1, 346, 'Seven Samurai', 1954, 'resolved');
    INSERT INTO list_tags (list_id, tag) VALUES (2, 'dynamic');
    INSERT INTO vibes (id, name, is_builtin, position) VALUES (1, 'Crowd-pleasers', 1, 3);
    INSERT INTO vibe_tags (vibe_id, tag) VALUES (1, 'dynamic');
  `);
  return db;
}

const columns = (db, table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);

// node:sqlite returns rows with a null prototype, which deepEqual from
// assert/strict refuses to match against an object literal. Spreading gives a
// plain object so the assertions read as the data they are checking.
const rows = (db, sql, ...params) => db.prepare(sql).all(...params).map((row) => ({ ...row }));

test('an old-shaped database upgrades without losing anything', () => {
  const db = oldShapedDb();
  migrate(db);

  // The rename, and the values that had to survive it.
  assert.ok(columns(db, 'lists').includes('origin'), 'origin column exists');
  assert.ok(!columns(db, 'lists').includes('kind'), 'kind column is gone');
  assert.deepEqual(
    rows(db, 'SELECT id, origin FROM lists ORDER BY id'),
    [{ id: 1, origin: 'seed' }, { id: 2, origin: 'seed' }, { id: 3, origin: 'custom' }],
  );

  // Columns added since v2. Their absence is what made a fresh install and an
  // upgraded one diverge silently.
  for (const column of ['rank', 'award_year']) {
    assert.ok(columns(db, 'list_movies').includes(column), `list_movies.${column}`);
  }
  for (const column of ['query_json', 'short_name', 'source', 'materialised_at']) {
    assert.ok(columns(db, 'lists').includes(column), `lists.${column}`);
  }

  // The user's data is still there. This is the whole point of the test.
  assert.equal(db.prepare('SELECT watched FROM movies WHERE tmdb_id = 346').get().watched, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM list_movies').get().n, 1);
});

test('the dynamic tag becomes modern, on lists and on vibes alike', () => {
  const db = oldShapedDb();
  migrate(db);

  assert.deepEqual(
    rows(db, 'SELECT list_id, tag FROM list_tags WHERE tag IN (?, ?)', 'dynamic', 'modern'),
    [{ list_id: 2, tag: 'modern' }],
  );
  assert.deepEqual(
    rows(db, 'SELECT tag FROM vibe_tags'),
    [{ tag: 'modern' }],
    'the vibe must move too, or it resolves against a tag nothing carries',
  );
});

test('an untagged list inherits its old category as a tag', () => {
  const db = oldShapedDb();
  migrate(db);

  // List 1 had category='canon' and no tags; list 3 had neither and must stay
  // untagged rather than acquiring a meaningless one.
  assert.deepEqual(rows(db, 'SELECT tag FROM list_tags WHERE list_id = 1'), [{ tag: 'canon' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM list_tags WHERE list_id = 3').get().n, 0);
});

test('Crowd-Pleasers is renamed, list and vibe together', () => {
  const db = oldShapedDb();
  migrate(db);

  assert.equal(db.prepare('SELECT name FROM lists WHERE id = 2').get().name, 'Modern Classics (last 10 years)');
  assert.equal(db.prepare('SELECT name FROM vibes WHERE id = 1').get().name, 'Modern Classics');
});

test('migrating twice changes nothing the second time', () => {
  const db = oldShapedDb();
  migrate(db);
  const after = {
    lists: rows(db, 'SELECT id, name, origin, category FROM lists ORDER BY id'),
    tags: rows(db, 'SELECT list_id, tag FROM list_tags ORDER BY list_id, tag'),
    vibeTags: rows(db, 'SELECT vibe_id, tag FROM vibe_tags ORDER BY vibe_id'),
  };

  // It runs on every boot, so "idempotent" is not a nicety — a second start
  // must not retag, rename, or re-backfill anything.
  migrate(db);

  assert.deepEqual(rows(db, 'SELECT id, name, origin, category FROM lists ORDER BY id'), after.lists);
  assert.deepEqual(rows(db, 'SELECT list_id, tag FROM list_tags ORDER BY list_id, tag'), after.tags);
  assert.deepEqual(rows(db, 'SELECT vibe_id, tag FROM vibe_tags ORDER BY vibe_id'), after.vibeTags);
});

test('a rename already done is left alone rather than retried', () => {
  const db = oldShapedDb();
  migrate(db);

  // A user who renamed their own list back must not have it renamed again, and
  // a second Crowd-Pleasers must not collide with the existing Modern Classics.
  db.prepare('INSERT INTO lists (name, origin, is_active) VALUES (?, ?, 0)').run(
    'Crowd-Pleasers (last 10 years)',
    'custom',
  );
  migrate(db);

  const names = db.prepare('SELECT name FROM lists ORDER BY id').all().map((row) => row.name);
  assert.ok(names.includes('Modern Classics (last 10 years)'));
  assert.ok(
    names.includes('Crowd-Pleasers (last 10 years)'),
    'the guard is both ways: it must not clobber a list the user made themselves',
  );
});

test('the National cinema vibe is removed, but not one the user made their own', () => {
  const db = oldShapedDb();
  db.exec(`INSERT INTO vibes (id, name, is_builtin, position) VALUES
    (10, 'National cinema', 1, 6),
    (11, 'Nordic noir',     0, 7)`);

  migrate(db);
  let names = rows(db, 'SELECT name FROM vibes ORDER BY id').map((r) => r.name);
  assert.equal(names.includes('National cinema'), false, 'the built-in wrapper is gone');
  assert.equal(names.includes('Nordic noir'), true, "a user's own vibe is untouched");
});

test('a National cinema vibe the user has pinned lists onto is kept', () => {
  const db = oldShapedDb();
  db.exec(`INSERT INTO vibes (id, name, is_builtin, position) VALUES (10, 'National cinema', 1, 6)`);
  // Pinning a list onto it makes it theirs, whatever it is called. Deleting
  // that would throw away work, so the guard checks for it.
  db.exec(`INSERT INTO vibe_lists (vibe_id, list_id) VALUES (10, 1)`);

  migrate(db);
  assert.equal(
    rows(db, "SELECT COUNT(*) AS n FROM vibes WHERE name = 'National cinema'")[0].n,
    1,
  );
});

test('an old-shaped database survives the REAL boot sequence, not just migrate()', () => {
  const db = oldShapedDb();

  // getDb() execs SCHEMA and THEN migrates, and that order matters. CREATE
  // TABLE IF NOT EXISTS does nothing to a table that already exists, so
  // anything in SCHEMA that depends on a column migrate() has not added yet
  // -- an index, a view, a trigger -- throws, and the app cannot boot on any
  // database older than that column. A fresh install never sees it.
  //
  // This is not hypothetical: an index on movies(imdb_id) was written into
  // SCHEMA and broke every existing database while passing every test,
  // because the tests called migrate() on its own.
  assert.doesNotThrow(() => {
    db.exec(SCHEMA);
    migrate(db);
  });

  assert.ok(columns(db, 'movies').includes('imdb_id'));
  assert.ok(columns(db, 'movies').includes('imdb_rating'));
  assert.equal(db.prepare('SELECT watched FROM movies WHERE tmdb_id = 346').get().watched, 1);
});

/**
 * The two box-office rank migrations.
 *
 * These matter more than their size suggests, because both failure modes are
 * silent: a rank that is wrong still counts, still sorts, and still renders.
 * The defect these cover shipped fully populated and densely numbered, and was
 * found only by reading the values.
 */
function boxOfficeDb(name, rows) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO lists (id, name, origin) VALUES (1, ?, 'seed')").run(name);
  const insert = db.prepare(
    `INSERT INTO list_movies (list_id, raw_title, raw_year, rank, overall_rank, status)
     VALUES (1, ?, ?, ?, ?, 'resolved')`,
  );
  rows.forEach(([year, rank, overall], i) => insert.run(`Film ${i + 1}`, year, rank, overall));
  return db;
}

const ranksOf = (db) =>
  db
    .prepare('SELECT raw_year, rank, overall_rank FROM list_movies ORDER BY id')
    .all()
    .map((r) => [r.raw_year, r.rank, r.overall_rank]);

test('a globally ranked box-office list is split into per-year rank and overall rank', () => {
  // Rank is the all-time position, which is how France was stored. Three years
  // rather than two, deliberately: with exactly two years alternating, the
  // correct answer is byte-identical to a generated sequence and nothing could
  // tell them apart. Real data is not that tidy -- France steps down 617 times.
  const db = boxOfficeDb('Box-office France', [
    [1994, 1, null],
    [1962, 2, null],
    [1994, 3, null],
    [1979, 4, null],
  ]);
  migrate(db);

  // rank becomes the position WITHIN the year; the all-time order survives in
  // overall_rank rather than being thrown away.
  assert.deepEqual(ranksOf(db), [
    [1994, 1, 1],
    [1962, 1, 2],
    [1994, 2, 3],
    [1979, 1, 4],
  ]);
});

test('a list already stored per-year keeps a NULL overall rank rather than an invented one', () => {
  // The US shape: an annual top three, with nothing ranking 1962 against 1994.
  const db = boxOfficeDb('Box-office US', [
    [1994, 1, null],
    [1962, 1, null],
    [1994, 2, null],
    [1962, 2, null],
  ]);
  migrate(db);

  assert.deepEqual(ranksOf(db), [
    [1994, 1, null],
    [1962, 1, null],
    [1994, 2, null],
    [1962, 2, null],
  ]);
});

test('an already-written invented overall rank is cleared', () => {
  // What the old migration left behind: overall_rank is row position under an
  // ORDER BY rank, so it steps 1,1,2,2 -- every year's #1, then every year's
  // #2. Fully populated, densely numbered, and meaningless.
  const db = boxOfficeDb('Box-office US', [
    [1994, 1, 1],
    [1962, 1, 2],
    [1994, 2, 3],
    [1962, 2, 4],
  ]);
  migrate(db);

  assert.deepEqual(
    ranksOf(db).map((r) => r[2]),
    [null, null, null, null],
    'overall_rank is cleared where it was generated from the per-year ordering',
  );
  assert.deepEqual(ranksOf(db).map((r) => r[1]), [1, 1, 2, 2], 'the per-year rank is untouched');
});

test('a genuine overall rank beside a per-year rank is left alone', () => {
  // France after the split: reading rank in overall_rank order steps DOWN --
  // the third-biggest film of all time is its year's #2, the fourth is another
  // year's #1 -- which a generated sequence never does.
  const db = boxOfficeDb('Box-office France', [
    [1994, 1, 1],
    [1962, 1, 2],
    [1994, 2, 3],
    [1979, 1, 4],
  ]);
  migrate(db);

  assert.deepEqual(
    ranksOf(db).map((r) => r[2]),
    [1, 2, 3, 4],
    'a real all-time ordering survives the repair',
  );
});

test('label rows whose parent is gone are swept', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  // Foreign keys OFF while the orphans are planted, which is exactly how the
  // real ones got there: SQLite enforces them only when a connection asks it
  // to, so anything that opened the database without the pragma could delete a
  // list and leave its labels behind. With them on, these inserts are rejected
  // — which is worth knowing, because it means the app itself never creates
  // this state.
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare("INSERT INTO lists (id, name, origin) VALUES (1, 'Kept', 'seed')").run();
  db.prepare("INSERT INTO list_tags (list_id, tag) VALUES (1, 'canon')").run();
  db.prepare("INSERT INTO list_tags (list_id, tag) VALUES (99, 'box-office')").run();
  db.prepare("INSERT INTO vibes (id, name) VALUES (1, 'Kept vibe')").run();
  db.prepare("INSERT INTO vibe_tags (vibe_id, tag) VALUES (1, 'canon')").run();
  db.prepare("INSERT INTO vibe_tags (vibe_id, tag) VALUES (98, 'canon')").run();
  db.prepare('INSERT INTO vibe_lists (vibe_id, list_id) VALUES (1, 1)').run();
  db.prepare('INSERT INTO vibe_lists (vibe_id, list_id) VALUES (1, 97)').run();

  migrate(db);

  assert.deepEqual(
    db.prepare('SELECT list_id FROM list_tags ORDER BY list_id').all().map((r) => r.list_id),
    [1],
    'the tag on a list that no longer exists is gone',
  );
  assert.deepEqual(
    db.prepare('SELECT vibe_id FROM vibe_tags').all().map((r) => r.vibe_id),
    [1],
  );
  assert.deepEqual(
    db.prepare('SELECT list_id FROM vibe_lists').all().map((r) => r.list_id),
    [1],
    'a pinned list that was deleted is unpinned rather than left dangling',
  );
});
