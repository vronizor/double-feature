/** Persistence helpers shared by the import routes, the seeder and the refresh job. */

export function upsertGenres(db, genres) {
  const stmt = db.prepare(
    `INSERT INTO genres (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  );
  for (const genre of genres) stmt.run(genre.id, genre.name);
}

/**
 * Writes a resolved TMDB movie. Deliberately leaves `watched` alone so a cache
 * refresh never resurrects a film the host already crossed off.
 */
export function upsertMovie(db, movie) {
  db.prepare(
    `INSERT INTO movies
       (tmdb_id, media_type, title, original_title, year, poster_path, director, runtime, overview,
        original_language, vote_average, imdb_id, countries, languages, trailer_key, refreshed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(tmdb_id) DO UPDATE SET
       media_type        = excluded.media_type,
       title             = excluded.title,
       original_title    = excluded.original_title,
       year              = excluded.year,
       poster_path       = excluded.poster_path,
       director          = excluded.director,
       runtime           = excluded.runtime,
       overview          = excluded.overview,
       -- Never overwrite a known id with NULL: a partial payload would
       -- silently unlink the film from its IMDb rating.
       imdb_id           = COALESCE(excluded.imdb_id, movies.imdb_id),
       original_language = excluded.original_language,
       vote_average      = excluded.vote_average,
       countries         = excluded.countries,
       languages         = excluded.languages,
       trailer_key       = excluded.trailer_key,
       refreshed_at      = excluded.refreshed_at`,
  ).run(
    movie.tmdb_id,
    movie.media_type ?? 'movie',
    movie.title,
    movie.original_title ?? null,
    movie.year ?? null,
    movie.poster_path ?? null,
    movie.director ?? null,
    movie.runtime ?? null,
    movie.overview ?? null,
    movie.original_language ?? null,
    movie.vote_average ?? null,
    movie.imdb_id ?? null,
    movie.countries ?? null,
    movie.languages ?? null,
    movie.trailer_key ?? null,
  );

  if (movie.genres) {
    upsertGenres(db, movie.genres);
    db.prepare('DELETE FROM movie_genres WHERE tmdb_id = ?').run(movie.tmdb_id);
    const link = db.prepare(
      'INSERT OR IGNORE INTO movie_genres (tmdb_id, genre_id) VALUES (?, ?)',
    );
    for (const genre of movie.genres) link.run(movie.tmdb_id, genre.id);
  }

  return movie.tmdb_id;
}

// Reserved floor for synthetic manual-entry ids — far below any real TMDB
// movie id or negated TV id, so it can never collide with either.
const MANUAL_ID_FLOOR = -1_000_000_000;

/**
 * Creates a movie that doesn't exist on TMDB at all — the rare "this proposal
 * isn't findable, add it manually" case in the Draw tab's lineup. Mints a
 * synthetic id one lower than the current lowest manual entry (or the floor,
 * if this is the first), so it's always unique without needing a sequence
 * table. No TMDB-derived fields are set: no poster, rating, genres, etc. —
 * just what the host actually typed.
 */
export function createManualMovie(db, { title, year }) {
  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) throw Object.assign(new Error('A title is required'), { status: 400 });
  const cleanYear = Number.isInteger(year) ? year : null;

  const { min } = db
    .prepare('SELECT MIN(tmdb_id) AS min FROM movies WHERE tmdb_id <= ?')
    .get(MANUAL_ID_FLOOR);
  const tmdbId = (min ?? MANUAL_ID_FLOOR) - 1;

  db.prepare(
    `INSERT INTO movies (tmdb_id, media_type, is_manual, title, year, refreshed_at)
     VALUES (?, 'movie', 1, ?, ?, datetime('now'))`,
  ).run(tmdbId, cleanTitle, cleanYear);

  return tmdbId;
}

/**
 * Attaches one raw list entry to a list, storing the outcome of resolution.
 * Unresolved entries are kept (not dropped) so they show up for manual review.
 */
export function recordEntry(db, { listId, rawTitle, rawYear, rank, overallRank, awardYear, result }) {
  // Per-membership facts from the seed file. These MUST be written here: the
  // seeder skips entries that already landed, so anything not persisted on the
  // first insert would never be filled in by a re-run. A fresh install used to
  // end up with rank = NULL everywhere, which silently removed the Top-N
  // control entirely (it only renders for lists whose ranked_count > 0).
  const cleanRank = Number.isInteger(rank) ? rank : null;
  const cleanOverall = Number.isInteger(overallRank) ? overallRank : null;
  const cleanAwardYear = Number.isInteger(awardYear) ? awardYear : null;

  if (result.status === 'resolved') {
    upsertMovie(db, result.movie);

    const existing = db
      .prepare('SELECT id FROM list_movies WHERE list_id = ? AND tmdb_id = ?')
      .get(listId, result.movie.tmdb_id);
    if (existing) return { status: 'duplicate', tmdb_id: result.movie.tmdb_id };

    db.prepare(
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, rank, overall_rank, award_year, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'resolved')`,
    ).run(listId, result.movie.tmdb_id, rawTitle, rawYear ?? null, cleanRank, cleanOverall, cleanAwardYear);

    return { status: 'resolved', tmdb_id: result.movie.tmdb_id };
  }

  // Rank is carried here too, and that is not cosmetic. These are exactly the
  // rows a human will reconcile later, and a row fixed on the Lists tab that
  // came back with rank = NULL would silently drop out of every Top-N cut --
  // "the top 10 of 1946" would quietly become nine films, with nothing saying
  // why. The seed file knew the rank; the insert simply was not carrying it.
  db.prepare(
    `INSERT INTO list_movies
       (list_id, tmdb_id, raw_title, raw_year, rank, overall_rank, status, candidates_json)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
  ).run(
    listId,
    rawTitle,
    rawYear ?? null,
    cleanRank,
    cleanOverall,
    result.status,
    result.candidates?.length ? JSON.stringify(result.candidates) : null,
  );

  return { status: result.status };
}

export function getMovieRow(db, tmdbId) {
  return db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdbId);
}

/**
 * Which awards each of these films won, with the ceremony year where the
 * source recorded one.
 *
 * A separate query rather than another correlated subquery because this is the
 * one piece of list data with real structure — name plus year, several per film
 * — and flattening it into a delimited string the way `lists` does would just
 * mean parsing it apart again in the browser.
 *
 * "Is this an award list" resolves on the `awards` TAG, not on the legacy
 * `lists.category` column. Category was superseded by list_tags in v2 and is
 * no longer written by anything but the seeder; this query was the last reader
 * of it, so a list tagged awards but never given a category — which is what any
 * list added from now on looks like — silently rendered no badges at all.
 */
export function awardsByTmdbId(db, tmdbIds) {
  if (tmdbIds.length === 0) return new Map();
  const placeholders = tmdbIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT lm.tmdb_id, l.name, l.short_name, lm.award_year
       FROM list_movies lm JOIN lists l ON l.id = lm.list_id
       WHERE lm.tmdb_id IN (${placeholders})
         AND lm.status = 'resolved'
         AND EXISTS (SELECT 1 FROM list_tags lt WHERE lt.list_id = l.id AND lt.tag = 'awards')
       -- Oldest first, and unknown years last rather than first (SQLite sorts
       -- NULL lowest), so a film's awards read as a chronology.
       ORDER BY lm.tmdb_id, lm.award_year IS NULL, lm.award_year, l.name COLLATE NOCASE`,
    )
    .all(...tmdbIds);

  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.tmdb_id)) byId.set(row.tmdb_id, []);
    byId.get(row.tmdb_id).push({
      name: row.name,
      short_name: row.short_name ?? null,
      year: row.award_year ?? null,
    });
  }
  return byId;
}

/**
 * Which lists a film is on, and where it sits on each.
 *
 * Used to be a comma-joined string of names, which answered "is this film on
 * anything" and stopped there. A rank is the more interesting half: being on
 * Box-office España says less than being its **#3 of 1952**.
 *
 * Carries `by_year` per membership rather than letting the client guess, for
 * the same reason the Top-N label does — the rank means a different thing on a
 * per-year list than on an end-to-end one, and "#3" alone cannot say which.
 * The tell is more than one row at rank 1; see the note in routes/lists.js for
 * why repeated ranks is the wrong test.
 *
 * `list_shape` is a CTE rather than a correlated subquery so the per-list
 * aggregate is computed once for the whole statement instead of once per
 * membership row of every hydrated film.
 */
export const LIST_SHAPE_CTE = `list_shape AS (
  SELECT list_id, SUM(rank = 1) > 1 AS by_year FROM list_movies GROUP BY list_id
)`;

/**
 * A film on no list yields `[]` rather than `[null]`: json_group_array over an
 * empty set gives `[]`, but a LEFT JOIN that found nothing would give a single
 * null entry, and the modal would render a membership that does not exist.
 */
export const parseMemberships = (json) =>
  (JSON.parse(json || '[]') ?? []).filter((row) => row && row.name);

export const listMembershipsSql = (idExpr) => `(
  SELECT json_group_array(json_object('name', name, 'rank', rank, 'year', year, 'by_year', by_year))
  FROM (
    SELECT l.name AS name, lm_x.rank AS rank, lm_x.raw_year AS year, s.by_year AS by_year
    FROM list_movies lm_x
    JOIN lists l ON l.id = lm_x.list_id
    LEFT JOIN list_shape s ON s.list_id = l.id
    WHERE lm_x.tmdb_id = ${idExpr} AND lm_x.status = 'resolved'
    ORDER BY l.name COLLATE NOCASE
  )
)`;

export function hydrateMovies(db, tmdbIds) {
  if (tmdbIds.length === 0) return [];
  const placeholders = tmdbIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `WITH ${LIST_SHAPE_CTE}
       SELECT m.*, (
         SELECT group_concat(g.name, ', ')
         FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
         WHERE mg.tmdb_id = m.tmdb_id
       ) AS genres, ${listMembershipsSql('m.tmdb_id')} AS lists
       FROM movies m WHERE m.tmdb_id IN (${placeholders})`,
    )
    .all(...tmdbIds);

  const awards = awardsByTmdbId(db, tmdbIds);
  const byId = new Map(
    rows.map((row) => [
      row.tmdb_id,
      { ...row, lists: parseMemberships(row.lists), awards: awards.get(row.tmdb_id) ?? [] },
    ]),
  );
  return tmdbIds.map((id) => byId.get(id)).filter(Boolean);
}
