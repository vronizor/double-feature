import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../server/db.js';
import { parseListQuery, materialiseList, findDynamicLists } from '../server/dynamic-lists.js';

// --- parseListQuery --------------------------------------------------------

test('a stored query is parsed from JSON and defaulted', () => {
  const query = parseListQuery('{"kind":"discover","params":{"vote_count.gte":5000}}');
  assert.equal(query.kind, 'discover');
  assert.deepEqual(query.params, { 'vote_count.gte': 5000 });
  assert.equal(query.limit, 100, 'a missing limit defaults rather than being unbounded');
});

test('the limit is clamped, so a query cannot walk the whole catalogue', () => {
  assert.equal(parseListQuery({ kind: 'discover', params: {}, limit: 100000 }).limit, 500);
  assert.equal(parseListQuery({ kind: 'discover', params: {}, limit: 0 }).limit, 1);
});

test('a missing query is null, not an error', () => {
  assert.equal(parseListQuery(null), null);
  assert.equal(parseListQuery(undefined), null);
  assert.equal(parseListQuery(''), null);
});

test('malformed or unsupported queries are rejected loudly', () => {
  assert.throws(() => parseListQuery('not json'), /not valid JSON/);
  assert.throws(() => parseListQuery('"a string"'), /must be an object/);
  assert.throws(() => parseListQuery({ kind: 'sql', params: {} }), /unsupported query kind/);
  assert.throws(() => parseListQuery({ kind: 'discover' }), /params must be an object/);
});

// --- materialiseList -------------------------------------------------------

const realFetch = globalThis.fetch;

/** Stubs TMDB so discover returns exactly `ids`, with detail for each. */
function stubTmdb(ids) {
  globalThis.fetch = async (input, init) => {
    const href = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const url = new URL(href);
    if (url.hostname !== 'api.themoviedb.org') return realFetch(input, init);
    const json = (body) =>
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

    if (url.pathname === '/3/discover/movie') {
      const page = Number(url.searchParams.get('page') ?? 1);
      return json({
        page,
        total_pages: 1,
        results: ids.map((id) => ({ id, title: `Film ${id}` })),
      });
    }
    const match = /^\/3\/movie\/(\d+)$/.exec(url.pathname);
    if (match) {
      const id = Number(match[1]);
      return json({
        id,
        title: `Film ${id}`,
        release_date: '2020-01-01',
        runtime: 100,
        original_language: 'en',
        vote_average: 8,
        genres: [{ id: 18, name: 'Drama' }],
        credits: { crew: [{ job: 'Director', name: 'Someone' }] },
        videos: { results: [] },
        production_countries: [],
        spoken_languages: [],
      });
    }
    return json({});
  };
}

function seedDynamicList(db) {
  db.exec(`INSERT INTO lists (id, name, kind, category, is_active, query_json)
    VALUES (1, 'Crowd', 'seed', 'dynamic', 1,
            '{"kind":"discover","params":{"vote_count.gte":5000},"limit":10}')`);
  return db.prepare('SELECT * FROM lists WHERE id = 1').get();
}

const memberIds = (db) =>
  db
    .prepare('SELECT tmdb_id FROM list_movies WHERE list_id = 1 ORDER BY tmdb_id')
    .all()
    .map((r) => r.tmdb_id);

test('findDynamicLists only returns query-backed lists', () => {
  const db = createTestDb();
  seedDynamicList(db);
  db.exec(`INSERT INTO lists (id, name, kind, category, is_active)
           VALUES (2, 'Static', 'seed', 'canon', 1)`);
  const found = findDynamicLists(db);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Crowd');
});

test('materialising populates the list and stamps materialised_at', async () => {
  const db = createTestDb();
  const list = seedDynamicList(db);
  stubTmdb([1, 2, 3]);
  try {
    const result = await materialiseList(db, list);
    assert.equal(result.added, 3);
    assert.equal(result.removed, 0);
    assert.deepEqual(memberIds(db), [1, 2, 3]);
    assert.ok(db.prepare('SELECT materialised_at FROM lists WHERE id = 1').get().materialised_at);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('re-materialising drops films that no longer match and keeps the rest', async () => {
  const db = createTestDb();
  const list = seedDynamicList(db);
  stubTmdb([1, 2, 3]);
  try {
    await materialiseList(db, list);
    const before = db.prepare('SELECT id FROM list_movies WHERE tmdb_id = 2').get().id;

    // Film 3 falls below the vote floor; film 4 rises above it.
    stubTmdb([1, 2, 4]);
    const result = await materialiseList(db, list);

    assert.deepEqual(memberIds(db), [1, 2, 4]);
    assert.equal(result.added, 1, 'only film 4 is new');
    assert.equal(result.removed, 1, 'only film 3 dropped out');

    const after = db.prepare('SELECT id FROM list_movies WHERE tmdb_id = 2').get().id;
    assert.equal(after, before, 'a film that still matches keeps its existing row');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a film dropping out of the list does not delete the film itself', async () => {
  // It may still be on other lists, marked watched, or sitting in someone's
  // published session — only the membership goes.
  const db = createTestDb();
  const list = seedDynamicList(db);
  stubTmdb([1, 2]);
  try {
    await materialiseList(db, list);
    stubTmdb([1]);
    await materialiseList(db, list);
    assert.deepEqual(memberIds(db), [1]);
    assert.ok(db.prepare('SELECT 1 FROM movies WHERE tmdb_id = 2').get(), 'movie row survives');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('an empty query result leaves the existing list alone', async () => {
  // Otherwise one transient API hiccup would silently empty a list the host is
  // actively drawing from.
  const db = createTestDb();
  const list = seedDynamicList(db);
  stubTmdb([1, 2, 3]);
  try {
    await materialiseList(db, list);
    stubTmdb([]);
    const result = await materialiseList(db, list);
    assert.equal(result.emptyResult, true);
    assert.deepEqual(memberIds(db), [1, 2, 3], 'nothing was removed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a list with no query materialises to nothing rather than throwing', async () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, kind, is_active) VALUES (1, 'Static', 'seed', 1)`);
  const list = db.prepare('SELECT * FROM lists WHERE id = 1').get();
  assert.deepEqual(await materialiseList(db, list), { skipped: true });
});
