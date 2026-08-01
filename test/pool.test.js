import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../server/db.js';
import {
  buildPoolQuery,
  describePoolSetup,
  normalizePoolSetup,
  poolCount,
  drawFromPool,
  queryPool,
  poolFacets,
  languageName,
} from '../server/pool.js';

const GENRES = { drama: 18, horror: 27, scifi: 878, comedy: 35 };

function seed() {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES
    (1, 'Active', 'seed', 1),
    (2, 'Inactive', 'seed', 0)`);
  for (const [id, name] of Object.entries(GENRES)) {
    db.prepare('INSERT INTO genres (id, name) VALUES (?, ?)').run(name, id);
  }

  const add = (tmdbId, title, year, lang, runtime, genres, { watched = 0, listId = 1 } = {}) => {
    db.prepare(
      `INSERT INTO movies (tmdb_id, title, year, runtime, original_language, watched)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(tmdbId, title, year, runtime, lang, watched);
    for (const genre of genres) {
      db.prepare('INSERT INTO movie_genres (tmdb_id, genre_id) VALUES (?, ?)').run(tmdbId, genre);
    }
    db.prepare(
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
       VALUES (?, ?, ?, ?, 'resolved')`,
    ).run(listId, tmdbId, title, year);
  };

  add(1, 'Old Drama', 1955, 'en', 120, [GENRES.drama]);
  add(2, 'Japanese Drama', 1960, 'ja', 200, [GENRES.drama]);
  add(3, 'Modern Horror', 2015, 'en', 95, [GENRES.horror, GENRES.drama]);
  add(4, 'Sci-Fi Epic', 1968, 'en', 149, [GENRES.scifi]);
  add(5, 'Seen It', 1990, 'en', 100, [GENRES.comedy], { watched: 1 });
  add(6, 'Off-list Film', 1970, 'fr', 90, [GENRES.drama], { listId: 2 });
  return db;
}

test('the pool is only active lists, and excludes watched films by default', () => {
  const db = seed();
  assert.equal(poolCount(db, {}), 4);
  assert.equal(poolCount(db, { filters: { includeWatched: true } }), 5, 'rewatch toggle adds the watched film');
});

test('explicit null bounds behave exactly like omitted ones', () => {
  // The client's default filter state sends { min: null, max: null } rather
  // than omitting the keys. Number(null) is 0, not NaN, so a naive coercion
  // turns "no bound" into "<= 0" and zeroes the whole pool — this is a
  // regression test for exactly that bug.
  const db = seed();
  const explicitNulls = {
    filters: {
      genres: { include: [], exclude: [] },
      languages: { include: [], exclude: [] },
      year: { min: null, max: null },
      runtime: { min: null, max: null },
      includeWatched: false,
    },
  };
  assert.equal(poolCount(db, explicitNulls), poolCount(db, {}));
  assert.equal(poolCount(db, explicitNulls), 4);
});

test('a film on two lists is counted once', () => {
  const db = seed();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (3, 'Overlap', 'seed', 1)`);
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
     VALUES (3, 1, 'Old Drama', 1955, 'resolved')`,
  ).run();

  // Deduplication by tmdb_id is the whole point of keying on TMDB rather than title.
  assert.equal(poolCount(db, {}), 4);
});

test('genre include matches any of the chosen genres', () => {
  const db = seed();
  assert.equal(poolCount(db, { filters: { genres: { include: [GENRES.horror] } } }), 1);
  assert.equal(poolCount(db, { filters: { genres: { include: [GENRES.horror, GENRES.scifi] } } }), 2);
});

test('genre exclude drops a film carrying any excluded genre', () => {
  const db = seed();
  // Modern Horror is both horror and drama, so excluding horror must drop it
  // even though it is also a drama.
  assert.equal(poolCount(db, { filters: { genres: { exclude: [GENRES.horror] } } }), 3);
  assert.equal(poolCount(db, { filters: { genres: { exclude: [GENRES.drama] } } }), 1);
});

test('include and exclude combine', () => {
  const db = seed();
  const count = poolCount(db, { filters: { genres: { include: [GENRES.drama], exclude: [GENRES.horror] } } });
  assert.equal(count, 2, 'the two pure dramas, not the horror-drama');
});

test('language include/exclude, year and runtime filters narrow the pool', () => {
  const db = seed();
  assert.equal(poolCount(db, { filters: { languages: { include: ['ja'] } } }), 1);
  assert.equal(poolCount(db, { filters: { languages: { include: ['en', 'ja'] } } }), 4);
  assert.equal(poolCount(db, { filters: { year: { min: 1960, max: 1970 } } }), 2);
  assert.equal(poolCount(db, { filters: { year: { min: 2000 } } }), 1);
  assert.equal(poolCount(db, { filters: { runtime: { max: 120 } } }), 2);
  assert.equal(poolCount(db, { filters: { runtime: { min: 140 } } }), 2);
});

test('language exclude drops a matching language but keeps an unknown one', () => {
  const db = seed();
  // 4 films total: 3 en, 1 ja. Excluding 'en' should leave just the ja film.
  assert.equal(poolCount(db, { filters: { languages: { exclude: ['en'] } } }), 1);

  db.prepare('UPDATE movies SET original_language = NULL WHERE tmdb_id = 1').run();
  // An unknown language must not be swept up by an exclude filter — SQL's
  // `NULL NOT IN (...)` is NULL (falsy), which would otherwise drop it too.
  assert.equal(poolCount(db, { filters: { languages: { exclude: ['en'] } } }), 2);
});

test('language include and exclude combine', () => {
  const db = seed();
  const count = poolCount(db, { filters: { languages: { include: ['en', 'ja'], exclude: ['ja'] } } });
  assert.equal(count, 3, 'en+ja included, then ja excluded again leaves just en');
});

test('a film with an unknown year is excluded by a year filter', () => {
  const db = seed();
  db.prepare('UPDATE movies SET year = NULL WHERE tmdb_id = 1').run();
  assert.equal(poolCount(db, { filters: { year: { min: 1900, max: 2100 } } }), 3);
  assert.equal(poolCount(db, {}), 4, 'but it stays in an unfiltered pool');
});

test('draws never exceed the requested size and return only pool members', () => {
  const db = seed();
  const drawn = drawFromPool(db, {}, 2);
  assert.equal(drawn.length, 2);
  assert.equal(new Set(drawn).size, 2, 'no duplicates within a draw');
  for (const id of drawn) assert.ok([1, 2, 3, 4].includes(id));
});

test('an over-tight filter returns fewer than asked rather than throwing', () => {
  const db = seed();
  const drawn = drawFromPool(db, { filters: { languages: { include: ['ja'] } } }, 5);
  assert.equal(drawn.length, 1);
});

test('an empty pool draws nothing', () => {
  const db = seed();
  assert.deepEqual(drawFromPool(db, { filters: { languages: { include: ['zz'] } } }, 5), []);
});

test('facets only describe the active pool', () => {
  const db = seed();
  const facets = poolFacets(db);

  const languages = facets.languages.map((row) => row.code);
  assert.ok(languages.includes('en') && languages.includes('ja'));
  assert.ok(!languages.includes('fr'), 'the inactive list must not leak into the options');
  assert.equal(facets.min_year, 1955);
});

test('filter values are coerced, so hand-crafted input cannot inject SQL', () => {
  const db = seed();
  const { params } = buildPoolQuery({ filters: { genres: { include: ["1); DROP TABLE movies;--", 27] },
    year: { min: 'nonsense' }, } });

  assert.deepEqual(params, [27], 'non-numeric ids are dropped, not interpolated');
  assert.doesNotThrow(() => poolCount(db, { filters: { genres: { include: ["1); DROP TABLE movies;--"] } } }));
  assert.equal(poolCount(db, {}), 4, 'the table is still there');
});

test('language names cover TMDB codes Intl does not know', () => {
  assert.equal(languageName('en'), 'English');
  assert.equal(languageName('ja'), 'Japanese');
  assert.equal(languageName('cn'), 'Cantonese');
});

// --- queryPool: sorted, paginated browsing for the Explore tab -----------
// Fixture (active, unwatched pool): 1 Old Drama (1955, 120min), 2 Japanese
// Drama (1960, 200min), 3 Modern Horror (2015, 95min), 4 Sci-Fi Epic (1968, 149min).

test('queryPool defaults to title order', () => {
  const db = seed();
  const ids = queryPool(db, {});
  const titles = ids.map((id) => db.prepare('SELECT title FROM movies WHERE tmdb_id = ?').get(id).title);
  assert.deepEqual(titles, ['Japanese Drama', 'Modern Horror', 'Old Drama', 'Sci-Fi Epic']);
});

test('queryPool sorts by year in both directions', () => {
  const db = seed();
  assert.deepEqual(queryPool(db, {}, { sort: 'year_desc' }), [3, 4, 2, 1]);
  assert.deepEqual(queryPool(db, {}, { sort: 'year_asc' }), [1, 2, 4, 3]);
});

test('queryPool sorts by runtime, longest first', () => {
  const db = seed();
  assert.deepEqual(queryPool(db, {}, { sort: 'runtime' }), [2, 4, 1, 3]);
});

test('queryPool sorts by rating, unrated films last rather than first', () => {
  const db = seed();
  db.prepare('UPDATE movies SET vote_average = 8.5 WHERE tmdb_id = 3').run();
  db.prepare('UPDATE movies SET vote_average = 6.0 WHERE tmdb_id = 1').run();
  // 3 (8.5), 1 (6.0), then 2 and 4 (both NULL, tie-broken by title).
  assert.deepEqual(queryPool(db, {}, { sort: 'rating' }), [3, 1, 2, 4]);
});

test('queryPool paginates with limit and offset', () => {
  const db = seed();
  const firstPage = queryPool(db, {}, { limit: 2, offset: 0 });
  const secondPage = queryPool(db, {}, { limit: 2, offset: 2 });
  assert.equal(firstPage.length, 2);
  assert.equal(secondPage.length, 2);
  assert.deepEqual([...firstPage, ...secondPage].sort(), [1, 2, 3, 4]);
  assert.equal(new Set([...firstPage, ...secondPage]).size, 4, 'no overlap between pages');
});

test('queryPool falls back to title order for an unrecognised sort key', () => {
  const db = seed();
  assert.deepEqual(queryPool(db, {}, { sort: 'not-a-real-sort' }), queryPool(db, {}, { sort: 'title' }));
});

test('queryPool respects filters exactly like poolCount', () => {
  const db = seed();
  const ja = queryPool(db, { filters: { languages: { include: ['ja'] } } });
  assert.deepEqual(ja, [2]);
});

// --- search: title, original title, or director ---------------------------

test('search matches title, original title, or director, case-insensitively', () => {
  const db = seed();
  db.prepare("UPDATE movies SET director = 'Akira Kurosawa' WHERE tmdb_id = 2").run();
  db.prepare("UPDATE movies SET original_title = 'Aru Kagayaku Kioku' WHERE tmdb_id = 3").run();

  assert.equal(poolCount(db, { filters: { search: 'drama' } }), 2, '"Old Drama" and "Japanese Drama"');
  assert.equal(poolCount(db, { filters: { search: 'KUROSAWA' } }), 1, 'matches director, case-insensitively');
  assert.equal(poolCount(db, { filters: { search: 'Kagayaku' } }), 1, 'matches original_title');
  assert.equal(poolCount(db, { filters: { search: 'nonexistent' } }), 0);
});

test('search ignores surrounding whitespace and blank input', () => {
  const db = seed();
  assert.equal(poolCount(db, { filters: { search: '  Old Drama  ' } }), 1);
  assert.equal(poolCount(db, { filters: { search: '   ' } }), 4, 'blank search is no filter at all');
});

test('search escapes LIKE wildcard characters so they match literally', () => {
  const db = seed();
  db.prepare("UPDATE movies SET title = '100% Real' WHERE tmdb_id = 1").run();
  // Without escaping, the "%" in the search term would itself act as a
  // wildcard and match every row, not just titles containing a literal "%".
  assert.equal(poolCount(db, { filters: { search: '100%' } }), 1);
  assert.equal(poolCount(db, { filters: { search: '100% Real' } }), 1);
  assert.equal(poolCount(db, { filters: { search: '%' } }), 1, 'a bare wildcard char is still just a literal search term');
});

// --- exclude: "don't hand back what's already staged" ---------------------

test('exclude narrows the pool without being a persisted filter preference', () => {
  const db = seed();
  assert.equal(poolCount(db, {}, [1]), 3);
  assert.equal(poolCount(db, {}, [1, 2]), 2);
  assert.equal(poolCount(db, {}), 4, 'omitting it entirely still means no exclusion at all');
});

test('drawFromPool never returns an excluded id, even when it would otherwise win every draw', () => {
  const db = seed();
  for (let i = 0; i < 20; i += 1) {
    const drawn = drawFromPool(db, {}, 3, [1]);
    assert.equal(drawn.length, 3);
    assert.ok(!drawn.includes(1));
  }
});

test('exclude combines with ordinary filters rather than replacing them', () => {
  const db = seed();
  // Pool minus horror (3: films 1,2,4) minus excluded film 2 = films 1,4.
  assert.equal(poolCount(db, { filters: { genres: { exclude: [GENRES.horror] } } }, [2]), 2);
});

test('exclude tolerates non-numeric junk instead of breaking the query', () => {
  const db = seed();
  assert.doesNotThrow(() => poolCount(db, {}, ['not-a-number', null, undefined, 1]));
  assert.equal(poolCount(db, {}, ['not-a-number', 1]), 3, 'the one valid id is still excluded');
});

// --- List selection (roadmap §0) and Top-N (4.1) ---------------------------

/**
 * Two lists, one active one not, with ranks on the active one so the "top N"
 * cut and the unranked-list case can both be exercised.
 *
 *   list 1 "Ranked"   (active)   films 10,11,12 at ranks 1,2,3
 *   list 2 "Unranked" (inactive) films 20,21    with rank NULL
 */
function seedRanked() {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES
    (1, 'Ranked', 'seed', 1),
    (2, 'Unranked', 'seed', 0)`);

  const add = (tmdbId, title, listId, rank) => {
    db.prepare('INSERT INTO movies (tmdb_id, title, year) VALUES (?, ?, 1970)').run(tmdbId, title);
    db.prepare(
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, rank, status)
       VALUES (?, ?, ?, 1970, ?, 'resolved')`,
    ).run(listId, tmdbId, title, rank);
  };

  add(10, 'First', 1, 1);
  add(11, 'Second', 1, 2);
  add(12, 'Third', 1, 3);
  add(20, 'Unranked A', 2, null);
  add(21, 'Unranked B', 2, null);
  return db;
}

test('an absent list selection falls back to is_active, so old clients keep working', () => {
  const db = seedRanked();
  assert.equal(poolCount(db, {}), 3, 'only the active list');
  assert.equal(poolCount(db, { lists: null }), 3, 'null is treated as absent, not as empty');
});

test('an explicitly EMPTY list selection means an empty pool, never the whole library', () => {
  // The dangerous failure: treating [] as "no constraint" would widen the pool
  // to every cached film at the exact moment the host deselected everything.
  const db = seedRanked();
  assert.equal(poolCount(db, { lists: [] }), 0);
  assert.deepEqual(drawFromPool(db, { lists: [] }, 5), []);
});

test('an explicit selection overrides is_active in both directions', () => {
  const db = seedRanked();
  assert.equal(poolCount(db, { lists: [2] }), 2, 'an INACTIVE list can be selected for tonight');
  assert.equal(poolCount(db, { lists: [1, 2] }), 5, 'both lists at once');
  assert.equal(
    poolCount(db, {}),
    3,
    'and selecting one for a draw does not mutate what is_active says',
  );
});

test('topN narrows a ranked list', () => {
  const db = seedRanked();
  assert.equal(poolCount(db, { lists: [1], topN: 2 }), 2);
  assert.equal(poolCount(db, { lists: [1], topN: 1 }), 1);
  assert.equal(poolCount(db, { lists: [1], topN: 99 }), 3, 'a topN past the end keeps everything');
});

test('topN keeps unranked lists whole instead of deleting them from the pool', () => {
  // rank IS NULL means "this list simply is not ranked" (Criterion, Ghibli),
  // NOT "rank worse than N". Excluding those would make "top 10" silently drop
  // every unranked list, which is the opposite of narrowing.
  const db = seedRanked();
  assert.equal(poolCount(db, { lists: [2], topN: 1 }), 2, 'both unranked films survive topN=1');
  assert.equal(
    poolCount(db, { lists: [1, 2], topN: 1 }),
    3,
    'ranked list cut to 1, unranked list untouched (1 + 2)',
  );
});

test('topN is ignored when absent, zero or negative rather than emptying the pool', () => {
  const db = seedRanked();
  assert.equal(poolCount(db, { lists: [1] }), 3);
  assert.equal(poolCount(db, { lists: [1], topN: null }), 3);
  assert.equal(poolCount(db, { lists: [1], topN: 0 }), 3);
  assert.equal(poolCount(db, { lists: [1], topN: -5 }), 3);
});

test('list selection and topN survive the round trip through buildPoolQuery params', () => {
  // Guards the params/placeholder ordering: the list ids are bound inside the
  // membership subquery and topN right after them, so an off-by-one in that
  // push order would bind a list id as the rank cut.
  const { where, params } = buildPoolQuery({ lists: [7, 9], topN: 25 });
  assert.match(where, /l\.id IN \(\?, \?\)/);
  assert.match(where, /lm\.rank IS NULL OR lm\.rank <= \?/);
  assert.deepEqual(params, [7, 9, 25]);
});

test('topN combines with ordinary filters instead of replacing them', () => {
  const db = seedRanked();
  assert.equal(poolCount(db, { lists: [1], topN: 2, filters: { search: 'Second' } }), 1);
  assert.equal(poolCount(db, { lists: [1], topN: 1, filters: { search: 'Second' } }), 0, 'cut out by topN');
});

test('poolFacets describes the SELECTED pool, not whatever is_active says', () => {
  // The bug this replaces: with only one list selected, the genre chips still
  // reported counts from every active list — "Drama 1671" against a 40-film
  // selection.
  const db = seed();
  const everything = poolFacets(db);
  const justInactive = poolFacets(db, [2]);

  assert.ok(everything.genres.length > 0);
  assert.deepEqual(
    justInactive.genres.map((g) => g.name),
    ['drama'],
    'only the genres present on list 2',
  );
  assert.equal(justInactive.min_year, 1970, 'bounds come from the selection too');
  assert.equal(justInactive.max_year, 1970);
});

test('poolFacets with an explicitly empty selection reports an empty pool', () => {
  const db = seed();
  const facets = poolFacets(db, []);
  assert.deepEqual(facets.genres, []);
  assert.deepEqual(facets.languages, []);
  assert.equal(facets.min_year, null);
});

test('poolFacets falls back to is_active when no selection is given', () => {
  // First paint has no client-side selection yet, so absent must keep working.
  const db = seed();
  assert.deepEqual(poolFacets(db).genres, poolFacets(db, null).genres);
});

// --- selection is not a filter --------------------------------------------

test('the pool setup keeps the selection and the filters as peers', () => {
  const setup = normalizePoolSetup({
    lists: [1],
    topN: 2,
    filters: { search: 'Second', includeWatched: true },
  });

  assert.deepEqual(setup.lists, [1]);
  assert.equal(setup.topN, 2);
  assert.equal(setup.filters.search, 'Second');
  assert.equal(setup.filters.lists, undefined, 'the selection must not leak into the filters');
  assert.equal(setup.filters.topN, undefined);
});

test('a filter left at the top level is ignored rather than quietly honoured', () => {
  // The old shape put `genres` and `lists` in one object. Accepting both shapes
  // is what let /api/pool/facets and /api/pool/count disagree about what a pool
  // was, so a stray top-level filter must do nothing rather than half-work.
  const db = seed();
  assert.equal(poolCount(db, { genres: { include: [GENRES.horror] } }), 4, 'not applied');
  assert.equal(poolCount(db, { filters: { genres: { include: [GENRES.horror] } } }), 1, 'applied');
});

test('a selection nested under filters is ignored rather than quietly honoured', () => {
  const db = seedRanked();
  assert.equal(poolCount(db, { filters: { lists: [2] } }), 3, 'falls back to is_active');
  assert.equal(poolCount(db, { lists: [2] }), 2, 'the real selection');
});

// --- award-winner filter ---------------------------------------------------

function seedWithAwards() {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES
    (1, 'Canon', 'seed', 1),
    (2, 'Palme d’Or (Cannes)', 'seed', 1),
    (3, 'Stale Category Award', 'seed', 1)`);
  // List 2 is tagged; list 3 carries only the dead `category` column.
  db.exec(`INSERT INTO list_tags (list_id, tag) VALUES (1, 'canon'), (2, 'awards')`);
  db.exec(`UPDATE lists SET category = 'awards' WHERE id = 3`);

  const add = (tmdbId, title, listId, status = 'resolved') => {
    db.prepare('INSERT OR IGNORE INTO movies (tmdb_id, title, year) VALUES (?, ?, 1990)').run(tmdbId, title);
    db.prepare(
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status) VALUES (?, ?, ?, 1990, ?)`,
    ).run(listId, tmdbId, title, status);
  };
  add(1, 'Winner', 1);
  add(1, 'Winner', 2);          // also on the awards list
  add(2, 'Plain Film', 1);
  add(3, 'Category Only', 1);
  add(3, 'Category Only', 3);   // on a list with category but no tag
  add(4, 'Unresolved Award', 2, 'needs_review');
  return db;
}

test('the award filter keeps only films on an award-tagged list', () => {
  const db = seedWithAwards();
  assert.equal(poolCount(db, {}), 4, 'all four films without the filter');
  assert.equal(poolCount(db, { filters: { awardWinners: true } }), 1);
});

test('the award filter resolves on the tag, not the dead category column', () => {
  // Same move as the award badges: `lists.category` has no readers left, and a
  // list added today has it NULL.
  const db = seedWithAwards();
  const ids = drawFromPool(db, { filters: { awardWinners: true } }, 10);
  assert.deepEqual(ids, [1], 'Category Only must not count as a winner');
});

test('an unresolved membership is not a win', () => {
  // A needs_review row has no confirmed film behind it.
  const db = seedWithAwards();
  const ids = drawFromPool(db, { filters: { awardWinners: true } }, 10);
  assert.ok(!ids.includes(4));
});

test('the award filter is independent of which lists are selected', () => {
  // Drawing from the canon list while asking only for winners is a real
  // question, and different from selecting the award lists.
  const db = seedWithAwards();
  // The canon list holds Winner, Plain Film and Category Only. The
  // needs_review row is on the awards list only.
  assert.equal(poolCount(db, { lists: [1] }), 3);
  assert.equal(poolCount(db, { lists: [1], filters: { awardWinners: true } }), 1);
});

test('the award filter shows up in the session summary', () => {
  const db = seedWithAwards();
  const summary = describePoolSetup(db, { filters: { awardWinners: true } }, ['Canon']);
  assert.match(summary, /award winners/);
});

// --- National cinema night: the country filter ----------------------------

test('a country filter matches whole entries, never substrings', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (1, 'L', 'seed', 1)`);
  db.exec(`INSERT INTO movies (tmdb_id, title, year, countries) VALUES
    (1, 'Solo Japanese',   1954, 'Japan'),
    (2, 'Co-production',   1988, 'France, Japan'),
    (3, 'Papua New Guinea',1990, 'Papua New Guinea'),
    (4, 'Northern Irish',  2000, 'Northern Ireland'),
    (5, 'No country',      1970, NULL)`);
  for (const id of [1, 2, 3, 4, 5]) {
    db.exec(`INSERT INTO list_movies (list_id, tmdb_id, raw_title, status)
             VALUES (1, ${id}, 't', 'resolved')`);
  }

  const titles = (country) => {
    const { where, params } = buildPoolQuery({
      lists: [1],
      filters: { countries: { include: [country] } },
    });
    return db
      .prepare(`SELECT m.title FROM movies m WHERE ${where} ORDER BY m.tmdb_id`)
      .all(...params)
      .map((row) => row.title);
  };

  // A co-production is honestly Japanese as well as French, so both nights
  // reach it.
  assert.deepEqual(titles('Japan'), ['Solo Japanese', 'Co-production']);
  assert.deepEqual(titles('France'), ['Co-production']);

  // The trap this clause exists for: "Guinea" is a substring of "Papua New
  // Guinea" and "Ireland" of "Northern Ireland". A LIKE '%name%' would return
  // them and nothing would look wrong.
  assert.deepEqual(titles('Guinea'), []);
  assert.deepEqual(titles('Ireland'), []);
  assert.deepEqual(titles('Papua New Guinea'), ['Papua New Guinea']);

  // A film with no country recorded is absent rather than treated as matching.
  assert.equal(titles('Japan').includes('No country'), false);
});

test('no country filter leaves the pool alone', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (1, 'L', 'seed', 1)`);
  db.exec(`INSERT INTO movies (tmdb_id, title, countries) VALUES (1, 'A', NULL), (2, 'B', 'Japan')`);
  db.exec(`INSERT INTO list_movies (list_id, tmdb_id, raw_title, status) VALUES
    (1, 1, 't', 'resolved'), (1, 2, 't', 'resolved')`);
  const { where, params } = buildPoolQuery({ lists: [1], filters: {} });
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM movies m WHERE ${where}`).get(...params).n, 2);
});

test('excluding a country drops it, but keeps films whose country is unknown', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (1, 'L', 'seed', 1)`);
  db.exec(`INSERT INTO movies (tmdb_id, title, countries) VALUES
    (1, 'American',   'United States of America'),
    (2, 'Co-pro',     'France, United States of America'),
    (3, 'French',     'France'),
    (4, 'Unknown',    NULL)`);
  for (const id of [1, 2, 3, 4]) {
    db.exec(`INSERT INTO list_movies (list_id, tmdb_id, raw_title, status)
             VALUES (1, ${id}, 't', 'resolved')`);
  }
  const { where, params } = buildPoolQuery({
    lists: [1],
    filters: { countries: { exclude: ['United States of America'] } },
  });
  const titles = db
    .prepare(`SELECT m.title FROM movies m WHERE ${where} ORDER BY m.tmdb_id`)
    .all(...params)
    .map((row) => row.title);

  // The co-production goes too: it IS partly American, and "no American films"
  // that still returns one would be a lie.
  // "Unknown" stays: absent means unknown, never "not from there" — the same
  // rule the streaming badge follows.
  assert.deepEqual(titles, ['French', 'Unknown']);
});
