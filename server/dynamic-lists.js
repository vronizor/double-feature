/**
 * Query-backed ("dynamic") lists.
 *
 * A normal list is a fixed set of titles someone curated. A dynamic list is
 * defined by a TMDB /discover query instead, so it stays current on its own —
 * "crowd-pleasers of the last five years" shouldn't need re-seeding every
 * January.
 *
 * The membership is MATERIALISED into `list_movies` rather than resolved when
 * a draw happens. That means everything downstream — buildPoolQuery, the
 * filters, Top-N, the vibe presets, the picker — treats a dynamic list
 * exactly like any other, with no second code path. The alternative (teaching
 * the pool query to union in a live API call) would have touched every one of
 * those and made a draw depend on the network.
 */

import { discoverMovies, getMovie } from './tmdb.js';
import { upsertMovie } from './movies.js';

/**
 * Validates and normalises a stored query.
 *
 * Structured, not a URL string: `{ kind, params, limit }`. The extra shape
 * looks like ceremony now, when `kind` is always 'discover', but it is the
 * hook that lets a parametric vibe (director night, theme night) inject a
 * value later without a schema migration — see ROADMAP §5.
 */
export function parseListQuery(raw) {
  if (!raw) return null;
  let query;
  try {
    query = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('query_json is not valid JSON');
  }
  if (!query || typeof query !== 'object') throw new Error('query_json must be an object');
  if (query.kind !== 'discover') throw new Error(`unsupported query kind: ${query.kind}`);
  if (!query.params || typeof query.params !== 'object') {
    throw new Error('query.params must be an object');
  }
  // Cap the limit: a dynamic list is meant to be a curated-size slice, and
  // discover will happily hand back tens of thousands of films.
  const limit = Number.isInteger(query.limit) ? Math.min(Math.max(query.limit, 1), 500) : 100;
  return { kind: query.kind, params: query.params, limit };
}

export function findDynamicLists(db) {
  return db.prepare('SELECT * FROM lists WHERE query_json IS NOT NULL ORDER BY name').all();
}

/**
 * Re-runs a dynamic list's query and syncs `list_movies` to the result.
 *
 * Rows are reconciled rather than wiped and rebuilt: a film that still matches
 * keeps its existing row (and its created_at), one that no longer matches is
 * removed, and only genuinely new ones are inserted. Blowing the list away and
 * re-inserting would churn every id on every refresh for no benefit.
 *
 * A film dropping out only leaves the *pool*; nothing already published is
 * touched, because a session stores its own copy of the films in
 * `session_movies`.
 */
export async function materialiseList(db, list, { log = () => {} } = {}) {
  const query = parseListQuery(list.query_json);
  if (!query) return { skipped: true };

  const found = await discoverMovies(query.params, { limit: query.limit });
  if (found.length === 0) {
    // Refuse to interpret "the query returned nothing" as "delete the list".
    // A transient API hiccup or a typo'd parameter would otherwise silently
    // empty a list the host is actively drawing from.
    log(`[dynamic] ${list.name}: query returned no films — leaving existing rows alone`);
    return { added: 0, removed: 0, kept: 0, emptyResult: true };
  }

  // Fetch full records: discover's summaries carry no runtime, director or
  // genres, and those drive the filters.
  const detailed = [];
  for (const summary of found) {
    try {
      const movie = await getMovie(summary.id);
      if (movie) detailed.push(movie);
    } catch (error) {
      log(`[dynamic] ${list.name}: ${summary.id} failed — ${error.message}`);
    }
  }
  if (detailed.length === 0) return { added: 0, removed: 0, kept: 0, emptyResult: true };

  const wanted = new Map(detailed.map((movie) => [movie.tmdb_id, movie]));

  const existing = db
    .prepare('SELECT id, tmdb_id FROM list_movies WHERE list_id = ?')
    .all(list.id);
  const existingIds = new Set(existing.map((row) => row.tmdb_id));

  let added = 0;
  let removed = 0;

  const insert = db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
     VALUES (?, ?, ?, ?, 'resolved')`,
  );
  const drop = db.prepare('DELETE FROM list_movies WHERE id = ?');

  for (const movie of wanted.values()) {
    upsertMovie(db, movie);
    if (existingIds.has(movie.tmdb_id)) continue;
    insert.run(list.id, movie.tmdb_id, movie.title, movie.year ?? null);
    added += 1;
  }

  for (const row of existing) {
    if (!wanted.has(row.tmdb_id)) {
      drop.run(row.id);
      removed += 1;
    }
  }

  db.prepare("UPDATE lists SET materialised_at = datetime('now') WHERE id = ?").run(list.id);
  return { added, removed, kept: wanted.size - added, total: wanted.size };
}

export async function materialiseAll(db, { log = console.log } = {}) {
  const lists = findDynamicLists(db);
  const results = [];
  for (const list of lists) {
    try {
      const result = await materialiseList(db, list, { log });
      results.push({ name: list.name, ...result });
    } catch (error) {
      log(`[dynamic] ${list.name} failed: ${error.message}`);
      results.push({ name: list.name, error: error.message });
    }
  }
  return results;
}
