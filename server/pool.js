/**
 * The draw pool: every movie on a selected list, deduplicated by TMDB id,
 * narrowed by the host's filters.
 *
 * **A list selection is not a filter.** The two used to travel together inside
 * one `filters` object, and everything downstream disagreed about whether that
 * was true: the UI put the list picker *above* a card labelled "Filters",
 * `clearFilters()` had to explicitly preserve `lists` with a comment
 * apologising for the name, and `/api/pool/facets` took `?lists=` as a query
 * param while its siblings took it inside the body. That last disagreement is
 * what produced a "N films match" count computed from the selection alone.
 *
 * So the request shape is a POOL SETUP, with the selection and the filters as
 * peers — matching what the UI has always shown:
 *
 *   {
 *     lists: [1, 4],   // which lists are in play; see asListSelection for null vs []
 *     topN:  100,      // a per-list cut, only meaningful for ranked lists
 *     filters: {
 *       genres:    { include: [18, 80], exclude: [27] },
 *       languages: { include: ['en'],   exclude: ['ja'] },
 *       year:      { min: 1960, max: 1979 },
 *       runtime:   { min: 60,   max: 180 },
 *       includeWatched: false,
 *       search: 'kurosawa',
 *     },
 *   }
 *
 * Filters are plain WHERE clauses over metadata already cached, so they cost no
 * extra TMDB calls.
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

/** The narrow set: facets over metadata. No list selection here — see the header. */
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
    // Production countries, as TMDB's full names rather than codes, because
    // that is what movies.countries caches: "France, Italy".
    countries: {
      include: asStringList(raw.countries?.include),
      exclude: asStringList(raw.countries?.exclude),
    },
    year: { min: asInt(raw.year?.min), max: asInt(raw.year?.max) },
    runtime: { min: asInt(raw.runtime?.min), max: asInt(raw.runtime?.max) },
    includeWatched: Boolean(raw.includeWatched),
    awardWinners: Boolean(raw.awardWinners),
    search: asSearch(raw.search),
  };
}

/**
 * The whole pool definition: which lists, how deep into the ranked ones, and
 * the filters over the result.
 *
 * `topN` sits beside `lists` rather than inside `filters` because it is a cut
 * *through the selection* — "the top 100 of each ranked list I picked" — and is
 * meaningless without one. The UI has always grouped it that way too, under
 * "Ranked lists" rather than in the Filters card.
 */
export function normalizePoolSetup(raw = {}) {
  return {
    lists: asListSelection(raw.lists),
    topN: asInt(raw.topN),
    filters: normalizeFilters(raw.filters),
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
export function buildPoolQuery(setup, exclude = []) {
  const { lists, topN, filters: f } = normalizePoolSetup(setup);
  const clauses = [];
  const params = [];

  // --- Which lists are in play -------------------------------------------
  //
  // An explicitly empty selection means an empty pool. Returning `1 = 0` (as
  // opposed to skipping the clause) is the whole point: without it, "no lists
  // selected" would fall through to no membership constraint at all and match
  // every movie ever cached, including films from lists the host just turned
  // off.
  if (lists !== null && lists.length === 0) {
    clauses.push('1 = 0');
  } else {
    const scope = lists === null ? 'l.is_active = 1' : `l.id IN (${lists.map(() => '?').join(', ')})`;
    const scopeParams = lists === null ? [] : lists;

    // A "top N" cut applies per list, and only to lists that actually carry
    // ranks. NULL rank means the list simply isn't ranked (Criterion, Ghibli),
    // and those films must stay in — otherwise asking for "the top 100" would
    // silently delete every unranked list from the pool rather than narrowing
    // the ranked ones.
    const cut = topN !== null && topN > 0;
    clauses.push(
      `m.tmdb_id IN (
       SELECT lm.tmdb_id FROM list_movies lm
       JOIN lists l ON l.id = lm.list_id
       WHERE ${scope} AND lm.tmdb_id IS NOT NULL${cut ? '\n         AND (lm.rank IS NULL OR lm.rank <= ?)' : ''}
     )`,
    );
    params.push(...scopeParams);
    if (cut) params.push(topN);
  }

  // --- Production country -------------------------------------------------
  //
  // movies.countries is a comma-separated list of full names, so a naive
  // LIKE '%France%' would be wrong in both directions: it matches nothing
  // useful that exact matching misses, and it DOES match a country whose name
  // contains another's. "China" is inside "Republic of China", "Guinea" is
  // inside "Papua New Guinea", "Ireland" is inside "Northern Ireland".
  //
  // Wrapping both sides in the separator makes it an exact element test:
  // ", France, Italy, " LIKE "%, France, %" is true, while
  // ", Papua New Guinea, " LIKE "%, Guinea, %" is false.
  //
  // ANY of the chosen countries matches, matching the genre include semantics —
  // a co-production counts as both of its countries, which is the honest
  // reading of "Japanese night" for a film Japan made with France.
  const countryTest = (name) => `(', ' || m.countries || ', ') LIKE ('%, ' || ? || ', %')`;
  if (f.countries.include.length) {
    clauses.push(
      `m.countries IS NOT NULL AND (${f.countries.include.map(countryTest).join(' OR ')})`,
    );
    params.push(...f.countries.include);
  }
  // Exclude exists because the chips cycle include -> exclude -> off, the same
  // as genres and languages. A chip state the server ignored would be a
  // control that silently does nothing. A film with no country recorded is NOT
  // excluded: absent means unknown, not "not from there".
  if (f.countries.exclude.length) {
    clauses.push(
      `(m.countries IS NULL OR NOT (${f.countries.exclude.map(countryTest).join(' OR ')}))`,
    );
    params.push(...f.countries.exclude);
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

  // "Only films that won something." Cheap, because the award badge already
  // needs this join — a film is a winner if it sits on any list tagged
  // `awards`, resolved.
  //
  // Deliberately independent of the list SELECTION: you can be drawing from
  // the canon lists and still ask only for winners among them. Making it a
  // selection of the award lists instead would change which films are in play,
  // which is a different question.
  //
  // Resolves on the tag, never on lists.category — that column has no readers
  // left, and an award list added today has it NULL.
  if (f.awardWinners) {
    clauses.push(
      `EXISTS (SELECT 1 FROM list_movies lm2
               JOIN list_tags lt2 ON lt2.list_id = lm2.list_id AND lt2.tag = 'awards'
               WHERE lm2.tmdb_id = m.tmdb_id AND lm2.status = 'resolved')`,
    );
  }

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

export function poolCount(db, setup, exclude = []) {
  const { where, params } = buildPoolQuery(setup, exclude);
  return db.prepare(`SELECT COUNT(*) AS n FROM movies m WHERE ${where}`).get(...params).n;
}

/** Random sample of up to `n` movies. Fewer means the filters were too tight. */
export function drawFromPool(db, setup, n, exclude = []) {
  const { where, params } = buildPoolQuery(setup, exclude);
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
export function queryPool(db, setup, { sort = 'title', limit = 60, offset = 0 } = {}) {
  const { where, params } = buildPoolQuery(setup);
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

  // Countries ride along with the other facets so the filter panel has one
  // source for everything it renders. Library-wide rather than pool-scoped,
  // deliberately: the country chips are a fixed vocabulary you pick FROM, and
  // having options appear and vanish as you narrow would make the panel feel
  // broken. Same reasoning as reporting the whole tag vocabulary.
  return { genres, languages, countries: countryFacet(db).slice(0, 12), ...bounds };
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

/**
 * Says what a Top-N cut did, not just what number was typed.
 *
 * The group a rank counts within differs per list: TSPDT ranks end to end, a
 * box-office list ranks within each year, so one N means ten films on one and
 * eight hundred on the other. The per-year kind has MORE THAN ONE row at rank
 * 1 — a #1 for every year it covers — where an end-to-end ranking has exactly
 * one. Repeated ranks anywhere is not the same test and is wrong: a poll with
 * ties repeats positions all the way down and still has a single winner.
 *
 * Must stay in step with `topNLabel` in public/dom.js, which says the same
 * thing live while the host is still building the pool. There is no module
 * shared between the browser and the server to hold it, so the duplication is
 * deliberate and small; the strings are the contract.
 */
function topNCut(db, setup, topN) {
  const { lists } = normalizePoolSetup(setup);
  const scope = lists === null ? 'l.is_active = 1' : `l.id IN (${lists.map(() => '?').join(', ')})`;
  const rows = db
    .prepare(
      `SELECT SUM(lm.rank = 1) > 1 AS by_year
         FROM lists l JOIN list_movies lm ON lm.list_id = l.id
        WHERE ${scope}
        GROUP BY l.id
       HAVING COUNT(lm.rank) > 0`,
    )
    .all(...(lists ?? []));

  const perYear = rows.filter((row) => row.by_year).length;
  if (rows.length === 0) return `top ${topN} (no ranked lists)`;
  if (perYear === 0) return `top ${topN}`;
  if (perYear === rows.length) return `top ${topN} per year`;
  return `top ${topN}, per year on some lists`;
}

/**
 * Short human-readable summary stored on the session for the results screen.
 *
 * Takes the whole pool setup, and the names for the ids in it. It used to take
 * the filters plus a *separate* list-names argument — which was the same
 * "selection isn't really a filter" instinct, worked around at the call site
 * instead of in the shape.
 *
 * The column it lands in is still `sessions.filter_summary`. Renaming a
 * populated column means a table rebuild for tidiness alone, and the value it
 * holds is honestly described by the name, so it stays.
 */
export function describePoolSetup(db, setup, selectedListNames) {
  const { topN, filters: f } = normalizePoolSetup(setup);
  const parts = [];
  if (selectedListNames?.length) parts.push(selectedListNames.join(' + '));

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
  if (topN !== null && topN > 0) parts.push(topNCut(db, setup, topN));
  if (f.awardWinners) parts.push('award winners');
  if (f.includeWatched) parts.push('incl. watched');
  if (f.search) parts.push(`"${f.search}"`);

  return parts.join(' · ') || null;
}

/**
 * Every production country in the library, with how many films carry it.
 *
 * Derived rather than stored: `movies.countries` is already cached, so the
 * vocabulary for "national cinema night" is a GROUP BY away and can never drift
 * from what is actually drawable. A country nobody's films come from simply
 * does not appear, which is the right behaviour for a picker — offering
 * "Iceland" and then drawing nothing would be worse than not offering it.
 *
 * Splitting a comma-separated column in SQL needs a recursive CTE; doing it in
 * JS over ~3,700 short strings is simpler to read and finishes in under a
 * millisecond, which is the whole budget this needs.
 */
export function countryFacet(db) {
  const rows = db.prepare('SELECT countries FROM movies WHERE countries IS NOT NULL').all();
  const counts = new Map();
  for (const row of rows) {
    // A co-production counts once for each of its countries — the same film is
    // honestly Japanese and French, and both nights should reach it.
    for (const name of String(row.countries).split(',')) {
      const country = name.trim();
      if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country));
}
