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

  // Full records are needed because discover's summaries carry no runtime,
  // director or genres, and those drive the filters. But most of them are
  // already in `movies` — this job ran yesterday, and the films in a
  // "last ten years, highly rated" list barely move.
  //
  // Before this check the loop fetched EVERY member EVERY run: ~120 TMDB
  // detail calls a day, ~44k a year, for rows the app already held and its own
  // policy considers good for 150 days. It also awaited them one at a time,
  // which bypassed the 8-way semaphore in tmdb.js entirely — 120 sequential
  // round trips rather than 15 concurrent batches.
  //
  // Freshness is not lost, it is handed back to `refreshStaleMovies`, which
  // already owns it for every other film in the library on the same cycle.
  // One visible consequence, and it is the correct one: these rows stop having
  // `refreshed_at` bumped daily, so they start appearing in the normal
  // 250-row refresh queue like everything else.
  const cached = new Map();
  const ids = found.map((summary) => summary.id);
  if (ids.length) {
    const rows = db
      .prepare(`SELECT tmdb_id FROM movies WHERE tmdb_id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids);
    for (const row of rows) cached.set(row.tmdb_id, true);
  }

  const toFetch = found.filter((summary) => !cached.has(summary.id));
  const fetched = await Promise.all(
    toFetch.map(async (summary) => {
      try {
        // Through getMovie, so the semaphore caps concurrency at 8.
        return await getMovie(summary.id);
      } catch (error) {
        log(`[dynamic] ${list.name}: ${summary.id} failed — ${error.message}`);
        return null;
      }
    }),
  );

  const wanted = new Map();
  for (const movie of fetched) if (movie) wanted.set(movie.tmdb_id, movie);
  // A cached row is always a complete toMovie() record — nothing writes a
  // discover summary into `movies` — so reusing it loses no fields. Held as
  // null to mean "already correct in the database, do not upsert".
  for (const summary of found) if (cached.has(summary.id)) wanted.set(summary.id, null);

  if (wanted.size === 0) return { added: 0, removed: 0, kept: 0, emptyResult: true };
  if (toFetch.length) log(`[dynamic] ${list.name}: ${cached.size} cached, ${toFetch.length} fetched`);

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

  for (const [tmdbId, movie] of wanted) {
    // null means the row was already cached and complete — see above.
    if (movie) upsertMovie(db, movie);
    if (existingIds.has(tmdbId)) continue;
    const row = movie ?? db.prepare('SELECT title, year FROM movies WHERE tmdb_id = ?').get(tmdbId);
    insert.run(list.id, tmdbId, row?.title ?? String(tmdbId), row?.year ?? null);
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
