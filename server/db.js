import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { config } from './config.js';

const SCHEMA = `
-- category groups lists in the picker ('canon', 'awards', 'family', ...) so
-- that selecting "all the awards lists" is one action rather than five. It is
-- deliberately a display grouping, not a taxonomy: a list may honestly belong
-- to two (the BFI list is both family and canon), but one category per list is
-- what keeps each list rendering exactly once in a grouped picker.
--
-- NULL means "not categorised yet" rather than defaulting to a lie — the
-- picker renders those under "Uncategorised", which is also where custom
-- lists land until the user files them.
--
-- is_active means "in play by default when the app opens", and is written
-- ONLY from the Lists tab. Draw/Explore hold their list selection in view
-- state instead, so choosing a vibe for tonight never silently rewrites
-- a stored preference or leaks across tabs.
-- query_json, when set, makes this a "dynamic" list: its membership comes from
-- a TMDB /discover query rather than a fixed set of titles, so "crowd-pleasers
-- of the last five years" stays current without re-seeding. It is stored as a
-- structured object ({kind, params, limit}) rather than a frozen URL so a
-- parameter can be injected later — that is what a future "director night"
-- or "theme night" needs, and retrofitting it onto a URL string would mean a
-- migration.
--
-- Dynamic lists are MATERIALISED into list_movies rather than resolved at draw
-- time: downstream, a dynamic list is indistinguishable from a hand-curated
-- one, so the pool query, the filters and the whole draw path stay untouched.
CREATE TABLE IF NOT EXISTS lists (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL UNIQUE,
  kind            TEXT    NOT NULL CHECK (kind IN ('seed', 'custom')),
  category        TEXT,
  is_active       INTEGER NOT NULL DEFAULT 0,
  source          TEXT,
  source_url      TEXT,
  query_json      TEXT,
  materialised_at TEXT,
  -- The compact form for a card's meta line and poster badge: "Oscar Intl."
  -- rather than "Oscar - Best International Feature". List metadata, so it
  -- belongs beside the rest of it and travels in the seed files, rather than
  -- living in a hardcoded map in the frontend that has to be edited by hand
  -- every time a list is added.
  --
  -- NULL is fine and common: only award lists need one, and the UI falls back
  -- to stripping the qualifier off the full name.
  short_name      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A movie's canonical identity is its TMDB id, never its title/year string, so
-- the same film appearing on several lists collapses to one row here.
--
-- A handful of entries (e.g. Godard's Histoire(s) du cinéma) are catalogued on
-- TMDB as a TV series rather than a movie, since that's how they actually
-- aired. Those are stored here too, keyed by the NEGATIVE of their TMDB TV id
-- — movie ids and TV ids are independent counters that can otherwise collide,
-- and tmdb_id has to stay a single global key across both.
--
-- Rarer still: a proposal that isn't on TMDB at all. Those get is_manual = 1
-- and a synthetic id at or below -1,000,000,000 — far below any real (or
-- negated TV) TMDB id, so it can never collide with either. They keep
-- media_type = 'movie' (the column's original two-value CHECK constraint is
-- deliberately left alone: widening it would require SQLite's full
-- table-rebuild dance under an already-populated production table, for a
-- rare feature that doesn't need it — is_manual is the real discriminator).
CREATE TABLE IF NOT EXISTS movies (
  tmdb_id           INTEGER PRIMARY KEY,
  media_type        TEXT    NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv')),
  is_manual         INTEGER NOT NULL DEFAULT 0,
  title             TEXT    NOT NULL,
  original_title    TEXT,
  year              INTEGER,
  poster_path       TEXT,
  director          TEXT,
  runtime           INTEGER,
  overview          TEXT,
  original_language TEXT,
  vote_average      REAL,
  countries         TEXT,
  languages         TEXT,
  trailer_key       TEXT,
  refreshed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  watched           INTEGER NOT NULL DEFAULT 0,
  watched_at        TEXT
);
CREATE INDEX IF NOT EXISTS movies_watched     ON movies(watched);
CREATE INDEX IF NOT EXISTS movies_year        ON movies(year);
CREATE INDEX IF NOT EXISTS movies_language    ON movies(original_language);
CREATE INDEX IF NOT EXISTS movies_refreshed   ON movies(refreshed_at);

CREATE TABLE IF NOT EXISTS genres (
  id   INTEGER PRIMARY KEY,
  name TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS movie_genres (
  tmdb_id  INTEGER NOT NULL REFERENCES movies(tmdb_id) ON DELETE CASCADE,
  genre_id INTEGER NOT NULL REFERENCES genres(id)      ON DELETE CASCADE,
  PRIMARY KEY (tmdb_id, genre_id)
);
CREATE INDEX IF NOT EXISTS movie_genres_genre ON movie_genres(genre_id);

-- The raw entered title/year is kept alongside each row for provenance and for
-- manual reconciliation of anything TMDB could not confidently match.
--
-- rank is the film's position on THIS list (TSPDT #1, Sight & Sound #12) and
-- is therefore per-membership, not per-film — the same movie can be #3 on one
-- list and unranked on another, which is why it lives here and not on movies.
-- NULL means the list simply isn't ranked (Criterion, Ghibli); a "top N" filter
-- must treat NULL as "always included" rather than excluding those lists
-- wholesale.
CREATE TABLE IF NOT EXISTS list_movies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  tmdb_id         INTEGER          REFERENCES movies(tmdb_id) ON DELETE SET NULL,
  raw_title       TEXT    NOT NULL,
  raw_year        INTEGER,
  rank            INTEGER,
  -- The ceremony year, for award lists. Stored rather than derived from the
  -- release year because the offset differs per award: Cannes awards a film in
  -- its own release year, while the Oscars and the national awards run in the
  -- February after. Deriving it would confidently print the wrong year for
  -- half the lists. NULL where the source doesn't record it.
  award_year      INTEGER,
  status          TEXT    NOT NULL CHECK (status IN ('resolved', 'needs_review', 'unmatched')),
  candidates_json TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS list_movies_unique
  ON list_movies(list_id, tmdb_id) WHERE tmdb_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS list_movies_list   ON list_movies(list_id);
CREATE INDEX IF NOT EXISTS list_movies_status ON list_movies(status);

-- The winner is resolved once, at close, and stored. Recomputing it per request
-- would re-roll the random tie-break on every poll and on every later visit to
-- the history tab, so the result would change each time you looked at it.
CREATE TABLE IF NOT EXISTS sessions (
  slug            TEXT    PRIMARY KEY,
  anonymous       INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  filter_summary  TEXT,
  winner_tmdb_id  INTEGER REFERENCES movies(tmdb_id),
  tiebreak_note   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT
);
CREATE INDEX IF NOT EXISTS sessions_created ON sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS session_movies (
  slug     TEXT    NOT NULL REFERENCES sessions(slug) ON DELETE CASCADE,
  tmdb_id  INTEGER NOT NULL REFERENCES movies(tmdb_id),
  position INTEGER NOT NULL,
  PRIMARY KEY (slug, tmdb_id)
);

-- voter_name and created_at are stored NULL for anonymous sessions. Anonymity
-- is enforced here at write time rather than filtered in the read path, so a
-- later API bug (or someone reading the .db file) cannot deanonymise a ballot.
CREATE TABLE IF NOT EXISTS ballots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL REFERENCES sessions(slug) ON DELETE CASCADE,
  voter_name TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS ballots_slug ON ballots(slug);

CREATE TABLE IF NOT EXISTS ballot_ranks (
  ballot_id INTEGER NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  tmdb_id   INTEGER NOT NULL,
  rank      INTEGER NOT NULL,
  PRIMARY KEY (ballot_id, tmdb_id)
);

-- Tags replace the single category column. A list genuinely belongs to more
-- than one bucket — Criterion is both a collection and part of the canon,
-- Ghibli is a collection AND family AND animation — and forcing a choice made
-- the "Cinephile" preset silently drop 1,227 Criterion films because it
-- resolved on category = 'canon' alone.
--
-- The vocabulary is fixed (see TAGS below) rather than free text: near
-- duplicates (comedy / comedies / funny) would degrade the grouped picker,
-- which is the exact thing tags are here to keep navigable.
CREATE TABLE IF NOT EXISTS list_tags (
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (list_id, tag)
);
CREATE INDEX IF NOT EXISTS list_tags_tag ON list_tags(tag);

-- A "vibe" is a saved starting point for a draw: which lists are in play plus
-- the filters that go with them. Stored as data rather than code so a new one
-- is a button rather than a redeploy — the whole point is that different
-- viewing companions want different nights.
--
-- Built-ins are seeded with is_builtin = 1 but are otherwise ordinary rows:
-- editable and deletable like any other, so there is one mechanism rather than
-- two kinds of vibe to explain.
CREATE TABLE IF NOT EXISTS vibes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  filters_json TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- A vibe draws on tags, on specific lists, or both, and resolves to the union.
-- Both exist because they answer different needs: "Awards night" should be
-- tag-based so a newly added award list joins it automatically, while
-- "Sunday with the kids" is three named lists that shouldn't drift when the
-- library grows.
CREATE TABLE IF NOT EXISTS vibe_tags (
  vibe_id INTEGER NOT NULL REFERENCES vibes(id) ON DELETE CASCADE,
  tag     TEXT    NOT NULL,
  PRIMARY KEY (vibe_id, tag)
);

CREATE TABLE IF NOT EXISTS vibe_lists (
  vibe_id INTEGER NOT NULL REFERENCES vibes(id) ON DELETE CASCADE,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  PRIMARY KEY (vibe_id, list_id)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * The tag vocabulary. Fixed on purpose — adding one is a deliberate edit here
 * rather than a side effect of a typo in a text field. Order is display order
 * in the picker.
 */
export const TAGS = [
  'canon',
  'awards',
  'festivals',
  'family',
  'animation',
  'comedy',
  'collection',
  'box-office',
  'dynamic',
];

export const TAG_LABELS = {
  canon: 'The canon',
  awards: 'Awards',
  festivals: 'Festivals',
  family: 'Family',
  animation: 'Animation',
  comedy: 'Comedy',
  collection: 'Collections',
  'box-office': 'Box office',
  dynamic: 'Auto-updating',
};

// `CREATE TABLE IF NOT EXISTS` covers fresh installs, but a column added to an
// existing table needs an explicit ALTER TABLE — this runs it once, only when
// the column is actually missing, so it's safe to call on every boot.
function ensureColumn(target, table, column, definition) {
  const columns = target.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    target.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate(target) {
  ensureColumn(target, 'movies', 'vote_average', 'REAL');
  ensureColumn(target, 'movies', 'countries', 'TEXT');
  ensureColumn(target, 'movies', 'languages', 'TEXT');
  ensureColumn(target, 'movies', 'trailer_key', 'TEXT');
  ensureColumn(target, 'movies', 'original_title', 'TEXT');
  ensureColumn(target, 'movies', 'media_type', `TEXT NOT NULL DEFAULT 'movie' CHECK (media_type IN ('movie', 'tv'))`);
  ensureColumn(target, 'movies', 'is_manual', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(target, 'lists', 'source', 'TEXT');
  ensureColumn(target, 'lists', 'source_url', 'TEXT');
  ensureColumn(target, 'lists', 'category', 'TEXT');
  ensureColumn(target, 'lists', 'query_json', 'TEXT');
  ensureColumn(target, 'lists', 'materialised_at', 'TEXT');
  ensureColumn(target, 'lists', 'short_name', 'TEXT');
  // Populated from the seed files by scripts/backfill-ranks.mjs, NOT by a
  // re-run of the seeder: seed.mjs deliberately skips entries that already
  // landed, so rows seeded before this column existed would stay NULL forever.
  ensureColumn(target, 'list_movies', 'rank', 'INTEGER');
  ensureColumn(target, 'list_movies', 'award_year', 'INTEGER');
  migrateCategoriesToTags(target);
  renameCrowdPleasers(target);
}

/**
 * The list sorts by rating, so it returns acclaim rather than crowd-pleasing:
 * its lowest entry rates 8.2 and it contains Parasite, a film already on the
 * canon lists it was meant to counterbalance. "Modern Classics" is honest, and
 * it frees the "Crowd-pleasers" name for a genuinely reach-sorted list later.
 *
 * Done as a rename rather than by editing the seed file alone: seed.mjs matches
 * lists by NAME, so changing the JSON on its own would create a second list
 * beside the old one rather than renaming it. Guarded both ways so it runs
 * once and never clobbers a list the user has since made themselves.
 */
function renameCrowdPleasers(target) {
  const OLD = 'Crowd-Pleasers (last 10 years)';
  const NEW = 'Modern Classics (last 10 years)';
  const hasOld = target.prepare('SELECT id FROM lists WHERE name = ?').get(OLD);
  const hasNew = target.prepare('SELECT 1 FROM lists WHERE name = ?').get(NEW);
  if (hasOld && !hasNew) {
    target.prepare('UPDATE lists SET name = ? WHERE id = ?').run(NEW, hasOld.id);
  }

  const oldVibe = target.prepare("SELECT id FROM vibes WHERE name = 'Crowd-pleasers'").get();
  const newVibe = target.prepare("SELECT 1 FROM vibes WHERE name = 'Modern Classics'").get();
  if (oldVibe && !newVibe) {
    target.prepare('UPDATE vibes SET name = ? WHERE id = ?').run('Modern Classics', oldVibe.id);
  }
}

/**
 * Bootstraps list_tags from the old single `category` column.
 *
 * Only fills in lists that have NO tags at all, so it can run on every boot
 * without ever undoing a retag. `lists.category` is deliberately left in place
 * but is no longer read anywhere — dropping it would rewrite the table for no
 * benefit, and keeping it as a "primary tag" would quietly reintroduce exactly
 * the single-category problem tags exist to solve.
 */
function migrateCategoriesToTags(target) {
  const untagged = target
    .prepare(
      `SELECT id, category FROM lists
       WHERE category IS NOT NULL
         AND id NOT IN (SELECT list_id FROM list_tags)`,
    )
    .all();

  const insert = target.prepare(
    'INSERT INTO list_tags (list_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING',
  );
  for (const list of untagged) insert.run(list.id, list.category);
}

// The presets that used to be hardcoded in the frontend. Seeded as ordinary
// rows so there is one mechanism for built-in and user-created alike.
const BUILTIN_VIBES = [
  { name: 'Cinephile', tags: ['canon'], position: 1 },
  { name: 'Awards', tags: ['awards'], position: 2 },
  { name: 'Modern Classics', tags: ['dynamic'], position: 3 },
  // The one built-in carrying a filter as well as a selection — which is what
  // makes it a vibe rather than just a tag shortcut.
  { name: 'Family', tags: ['family'], position: 4, excludeGenreNames: ['Horror'] },
];

/**
 * Inserts the built-in vibes if they're absent. Idempotent, and never touches
 * a vibe that already exists — so editing or deleting one sticks.
 */
export function ensureBuiltinVibes(target) {
  const genreId = (name) =>
    target.prepare('SELECT id FROM genres WHERE name = ? COLLATE NOCASE').get(name)?.id ?? null;

  for (const vibe of BUILTIN_VIBES) {
    if (target.prepare('SELECT 1 FROM vibes WHERE name = ?').get(vibe.name)) continue;

    // Resolved from the genres table rather than hardcoded, with TMDB's real
    // id as a fallback for a database seeded before the genre list landed.
    const excluded = (vibe.excludeGenreNames ?? [])
      .map((name) => genreId(name) ?? (name === 'Horror' ? 27 : null))
      .filter((id) => id !== null);

    const filters = excluded.length
      ? JSON.stringify({ genres: { include: [], exclude: excluded } })
      : null;

    const { lastInsertRowid } = target
      .prepare('INSERT INTO vibes (name, is_builtin, filters_json, position) VALUES (?, 1, ?, ?)')
      .run(vibe.name, filters, vibe.position);

    for (const tag of vibe.tags) {
      target
        .prepare('INSERT INTO vibe_tags (vibe_id, tag) VALUES (?, ?)')
        .run(Number(lastInsertRowid), tag);
    }
  }
}

let db;

export function getDb() {
  if (db) return db;

  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  ensureBuiltinVibes(db);
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', '1')
     ON CONFLICT(key) DO NOTHING`,
  ).run();
  return db;
}

/** Opens a throwaway in-memory database with the same schema, for tests. */
export function createTestDb() {
  const testDb = new DatabaseSync(':memory:');
  testDb.exec('PRAGMA foreign_keys = ON');
  testDb.exec(SCHEMA);
  return testDb;
}

export function closeDb() {
  db?.close();
  db = undefined;
}
