/**
 * The draw pool: every movie on a currently-active list, deduplicated by TMDB id,
 * narrowed by the host's filters.
 *
 * Filters are plain WHERE clauses over metadata Feature 2 already caches, so they
 * cost no extra TMDB calls. Shape:
 *   {
 *     genres:    { include: [18, 80], exclude: [27] },
 *     languages: { include: ['en'],   exclude: ['ja'] },
 *     year:      { min: 1960, max: 1979 },
 *     runtime:   { min: 60,   max: 180 },
 *     includeWatched: false,
 *     search: 'kurosawa',
 *   }
 */

const asIntList = (value) =>
  (Array.isArray(value) ? value : [])
    .map(Number)
    .filter((n) => Number.isInteger(n));

const asStringList = (value) =>
  (Array.isArray(value) ? value : [])
    .map((v) => String(v).trim())
    .filter(Boolean);

const asInt = (value) => {
  // Number(null) is 0, not NaN, so null must be rejected explicitly — otherwise
  // the client's default "no bound set" state (`{ min: null, max: null }`)
  // turns into a real "<= 0" clause instead of no filter at all.
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const asSearch = (value) => {
  const s = String(value ?? '').trim();
  return s || null;
};

/**
 * Deliberately NOT asIntList: this has three states, not two.
 *
 *   undefined/null → no selection sent; fall back to whatever `is_active` says
 *   []             → an explicit "no lists selected", i.e. an EMPTY pool
 *   [1, 4]         → exactly those lists
 *
 * Collapsing the first two would make "the host deselected every list" look
 * identical to "the client didn't mention lists at all", and the pool would
 * silently widen to the entire library at the exact moment the user asked for
 * nothing. The absent case exists so older clients (and the API's own
 * defaults) keep working while the UI moves over.
 */
const asListSelection = (value) =>
  value === undefined || value === null ? null : asIntList(value);

export function normalizeFilters(raw = {}) {
  return {
    genres: {
      include: asIntList(raw.genres?.include),
      exclude: asIntList(raw.genres?.exclude),
    },
    languages: {
      include: asStringList(raw.languages?.include),
      exclude: asStringList(raw.languages?.exclude),
    },
    year: { min: asInt(raw.year?.min), max: asInt(raw.year?.max) },
    runtime: { min: asInt(raw.runtime?.min), max: asInt(raw.runtime?.max) },
    includeWatched: Boolean(raw.includeWatched),
    search: asSearch(raw.search),
    lists: asListSelection(raw.lists),
    topN: asInt(raw.topN),
  };
}

/**
 * Builds the WHERE fragment for the pool. Kept separate from execution so the
 * clause logic can be unit-tested without a database.
 *
 * Genre semantics: `include` matches a film carrying ANY of the chosen genres
 * (OR, the useful default — "a comedy or a thriller"), while `exclude` drops a
 * film carrying ANY of the excluded ones.
 */
export function buildPoolQuery(filters, exclude = []) {
  const f = normalizeFilters(filters);
  const clauses = [];
  const params = [];

  // --- Which lists are in play -------------------------------------------
  //
  // An explicitly empty selection means an empty pool. Returning `1 = 0` (as
  // opposed to skipping the clause) is the whole point: without it, "no lists
  // selected" would fall through to no membership constraint at all and match
  // every movie ever cached, including films from lists the host just turned
  // off.
  if (f.lists !== null && f.lists.length === 0) {
    clauses.push('1 = 0');
  } else {
    const scope = f.lists === null ? 'l.is_active = 1' : `l.id IN (${f.lists.map(() => '?').join(', ')})`;
    const scopeParams = f.lists === null ? [] : f.lists;

    // A "top N" cut applies per list, and only to lists that actually carry
    // ranks. NULL rank means the list simply isn't ranked (Criterion, Ghibli),
    // and those films must stay in — otherwise asking for "the top 100" would
    // silently delete every unranked list from the pool rather than narrowing
    // the ranked ones.
    const topN = f.topN !== null && f.topN > 0;
    clauses.push(
      `m.tmdb_id IN (
       SELECT lm.tmdb_id FROM list_movies lm
       JOIN lists l ON l.id = lm.list_id
       WHERE ${scope} AND lm.tmdb_id IS NOT NULL${topN ? '\n         AND (lm.rank IS NULL OR lm.rank <= ?)' : ''}
     )`,
    );
    params.push(...scopeParams);
    if (topN) params.push(f.topN);
  }

  // Not a filter preference (like "no horror") — a per-request "don't hand
  // back what's already staged" instruction, so it's a separate argument
  // rather than part of the persisted-looking `filters` shape.
  const excludeIds = (Array.isArray(exclude) ? exclude : [])
    .map(Number)
    .filter(Number.isInteger);
  if (excludeIds.length) {
    clauses.push(`m.tmdb_id NOT IN (${excludeIds.map(() => '?').join(', ')})`);
    params.push(...excludeIds);
  }

  if (!f.includeWatched) clauses.push('m.watched = 0');

  if (f.year.min !== null) {
    clauses.push('m.year IS NOT NULL AND m.year >= ?');
    params.push(f.year.min);
  }
  if (f.year.max !== null) {
    clauses.push('m.year IS NOT NULL AND m.year <= ?');
    params.push(f.year.max);
  }
  if (f.runtime.min !== null) {
    clauses.push('m.runtime IS NOT NULL AND m.runtime >= ?');
    params.push(f.runtime.min);
  }
  if (f.runtime.max !== null) {
    clauses.push('m.runtime IS NOT NULL AND m.runtime <= ?');
    params.push(f.runtime.max);
  }

  if (f.languages.include.length) {
    clauses.push(`m.original_language IN (${f.languages.include.map(() => '?').join(', ')})`);
    params.push(...f.languages.include);
  }
  if (f.languages.exclude.length) {
    // NULL NOT IN (...) evaluates to NULL (i.e. false) in SQL, which would
    // wrongly drop films with an unknown language — the IS NULL keeps them in.
    clauses.push(
      `(m.original_language IS NULL OR m.original_language NOT IN (${f.languages.exclude.map(() => '?').join(', ')}))`,
    );
    params.push(...f.languages.exclude);
  }

  if (f.genres.include.length) {
    clauses.push(
      `EXISTS (SELECT 1 FROM movie_genres mg WHERE mg.tmdb_id = m.tmdb_id
               AND mg.genre_id IN (${f.genres.include.map(() => '?').join(', ')}))`,
    );
    params.push(...f.genres.include);
  }
  if (f.genres.exclude.length) {
    clauses.push(
      `NOT EXISTS (SELECT 1 FROM movie_genres mg WHERE mg.tmdb_id = m.tmdb_id
                   AND mg.genre_id IN (${f.genres.exclude.map(() => '?').join(', ')}))`,
    );
    params.push(...f.genres.exclude);
  }

  if (f.search) {
    // Escape LIKE's own wildcards so a literal "%" or "_" in the search box
    // (e.g. a film actually titled with one) is matched literally, not as a
    // wildcard. SQLite's LIKE is case-insensitive for ASCII by default.
    const escaped = f.search.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;
    clauses.push(
      `(m.title LIKE ? ESCAPE '\\' OR m.original_title LIKE ? ESCAPE '\\' OR m.director LIKE ? ESCAPE '\\')`,
    );
    params.push(pattern, pattern, pattern);
  }

  return { where: clauses.join('\n  AND '), params };
}

export function poolCount(db, filters, exclude = []) {
  const { where, params } = buildPoolQuery(filters, exclude);
  return db.prepare(`SELECT COUNT(*) AS n FROM movies m WHERE ${where}`).get(...params).n;
}

/** Random sample of up to `n` movies. Fewer means the filters were too tight. */
export function drawFromPool(db, filters, n, exclude = []) {
  const { where, params } = buildPoolQuery(filters, exclude);
  return db
    .prepare(`SELECT m.tmdb_id FROM movies m WHERE ${where} ORDER BY RANDOM() LIMIT ?`)
    .all(...params, n)
    .map((row) => row.tmdb_id);
}

// SQLite sorts NULL as the lowest value, so DESC naturally puts unrated/
// unknown-runtime films last rather than first — no explicit NULLS LAST
// needed. Fixed lookup table, not interpolated, so an unrecognised `sort`
// value just falls back to the default rather than being any kind of
// injection risk.
const POOL_SORTS = {
  title: 'm.title COLLATE NOCASE ASC',
  year_desc: 'm.year DESC, m.title COLLATE NOCASE ASC',
  year_asc: 'm.year ASC, m.title COLLATE NOCASE ASC',
  rating: 'm.vote_average DESC, m.title COLLATE NOCASE ASC',
  runtime: 'm.runtime DESC, m.title COLLATE NOCASE ASC',
};

export const POOL_SORT_KEYS = Object.keys(POOL_SORTS);

/** A page of the filtered pool, sorted — for browsing rather than a random draw. */
export function queryPool(db, filters, { sort = 'title', limit = 60, offset = 0 } = {}) {
  const { where, params } = buildPoolQuery(filters);
  const orderBy = POOL_SORTS[sort] ?? POOL_SORTS.title;
  return db
    .prepare(`SELECT m.tmdb_id FROM movies m WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset)
    .map((row) => row.tmdb_id);
}

/**
 * The genres, languages and year/runtime bounds actually present in the pool.
 *
 * Takes the same list selection as `buildPoolQuery` rather than assuming
 * `is_active`. Getting this wrong was visible: with only the Goya list
 * selected (40 films), the genre chips reported "Drama 1671 · Comedy 644" and
 * the total read 2,455 — the counts described the default pool while the draw
 * used the selected one.
 *
 * `lists` follows the same three-state convention as the filter: null/absent
 * means "fall back to is_active", an empty array means an empty pool.
 */
export function poolFacets(db, lists = null) {
  const selection = lists === null || lists === undefined ? null : asIntList(lists);

  let scope;
  let scopeParams = [];
  if (selection !== null && selection.length === 0) {
    scope = '1 = 0';
  } else if (selection === null) {
    scope = 'l.is_active = 1';
  } else {
    scope = `l.id IN (${selection.map(() => '?').join(', ')})`;
    scopeParams = selection;
  }

  const active = `
    SELECT lm.tmdb_id FROM list_movies lm
    JOIN lists l ON l.id = lm.list_id
    WHERE ${scope} AND lm.tmdb_id IS NOT NULL`;

  const genres = db
    .prepare(
      `SELECT g.id, g.name, COUNT(*) AS count
       FROM movie_genres mg
       JOIN genres g ON g.id = mg.genre_id
       WHERE mg.tmdb_id IN (${active})
       GROUP BY g.id ORDER BY g.name`,
    )
    .all(...scopeParams);

  const languages = db
    .prepare(
      `SELECT original_language AS code, COUNT(*) AS count
       FROM movies WHERE tmdb_id IN (${active}) AND original_language IS NOT NULL
       GROUP BY original_language ORDER BY count DESC`,
    )
    .all(...scopeParams);

  const bounds = db
    .prepare(
      `SELECT MIN(year) AS min_year, MAX(year) AS max_year,
              MIN(runtime) AS min_runtime, MAX(runtime) AS max_runtime
       FROM movies WHERE tmdb_id IN (${active})`,
    )
    .get(...scopeParams);

  return { genres, languages, ...bounds };
}

const LANGUAGE_NAMES = new Intl.DisplayNames(['en'], { type: 'language' });

// TMDB ships a few codes that aren't valid BCP-47, so Intl can't name them.
const TMDB_LANGUAGE_OVERRIDES = { cn: 'Cantonese', xx: 'No language', sh: 'Serbo-Croatian' };

export function languageName(code) {
  if (TMDB_LANGUAGE_OVERRIDES[code]) return TMDB_LANGUAGE_OVERRIDES[code];
  try {
    const name = LANGUAGE_NAMES.of(code);
    // Intl echoes the input back when it doesn't recognise the tag.
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** Short human-readable summary stored on the session for the results screen. */
export function describeFilters(db, filters, activeListNames) {
  const f = normalizeFilters(filters);
  const parts = [];
  if (activeListNames?.length) parts.push(activeListNames.join(' + '));

  const nameFor = (id) =>
    db.prepare('SELECT name FROM genres WHERE id = ?').get(id)?.name ?? `#${id}`;

  if (f.year.min !== null || f.year.max !== null) {
    parts.push(`${f.year.min ?? '…'}–${f.year.max ?? '…'}`);
  }
  if (f.runtime.min !== null || f.runtime.max !== null) {
    parts.push(`${f.runtime.min ?? 0}–${f.runtime.max ?? '…'} min`);
  }
  if (f.languages.include.length) parts.push(f.languages.include.map(languageName).join('/'));
  if (f.languages.exclude.length) parts.push(`no ${f.languages.exclude.map(languageName).join('/')}`);
  if (f.genres.include.length) parts.push(f.genres.include.map(nameFor).join('/'));
  if (f.genres.exclude.length) parts.push(`no ${f.genres.exclude.map(nameFor).join('/')}`);
  if (f.topN !== null && f.topN > 0) parts.push(`top ${f.topN}`);
  if (f.includeWatched) parts.push('incl. watched');
  if (f.search) parts.push(`"${f.search}"`);

  return parts.join(' · ') || null;
}
