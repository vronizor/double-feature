import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  kind        TEXT    NOT NULL CHECK (kind IN ('seed', 'custom')),
  is_active   INTEGER NOT NULL DEFAULT 0,
  source      TEXT,
  source_url  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
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
CREATE TABLE IF NOT EXISTS list_movies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id         INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  tmdb_id         INTEGER          REFERENCES movies(tmdb_id) ON DELETE SET NULL,
  raw_title       TEXT    NOT NULL,
  raw_year        INTEGER,
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

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

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
