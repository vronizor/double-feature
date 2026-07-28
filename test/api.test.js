/**
 * End-to-end pass over the real HTTP surface, with TMDB stubbed at `fetch`:
 * import → filtered draw → publish → ballots → close → results → history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from 'node:http';

process.env.TMDB_API_KEY = 'test-key';
process.env.HOST_LAN_IP = '192.168.1.50';
process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'double-feature-')), 'test.db');

// The URL handed to guests is built from the *configured* port, so the test
// server has to actually listen on the port it advertises. Grab a free one.
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const PORT = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
process.env.PORT = String(PORT);

// --- TMDB stub ------------------------------------------------------------

const CATALOGUE = [
  { id: 101, title: 'Vertigo', release_date: '1958-05-09', original_language: 'en', runtime: 128,
    genres: [{ id: 9648, name: 'Mystery' }], director: 'Alfred Hitchcock' },
  { id: 102, title: 'Tokyo Story', release_date: '1953-11-03', original_language: 'ja', runtime: 136,
    genres: [{ id: 18, name: 'Drama' }], director: 'Yasujiro Ozu' },
  { id: 103, title: 'Seven Samurai', release_date: '1954-04-26', original_language: 'ja', runtime: 207,
    genres: [{ id: 18, name: 'Drama' }, { id: 28, name: 'Action' }], director: 'Akira Kurosawa' },
  { id: 104, title: 'Psycho', release_date: '1960-06-16', original_language: 'en', runtime: 109,
    genres: [{ id: 27, name: 'Horror' }], director: 'Alfred Hitchcock' },
  { id: 105, title: 'Psycho', release_date: '1998-12-04', original_language: 'en', runtime: 105,
    genres: [{ id: 27, name: 'Horror' }], director: 'Gus Van Sant' },
  // Stand-ins for a boxset split by tmdb id: distinct from anything else on
  // the list, so resolving them can never collide with an existing entry.
  { id: 106, title: 'Koyaanisqatsi', release_date: '1982-01-01', original_language: 'en', runtime: 87,
    genres: [{ id: 99, name: 'Documentary' }], director: 'Godfrey Reggio' },
  { id: 107, title: 'Powaqqatsi', release_date: '1988-01-01', original_language: 'en', runtime: 99,
    genres: [{ id: 99, name: 'Documentary' }], director: 'Godfrey Reggio' },
  // Fixtures for the staging-basket tests: a small active pool of its own.
  { id: 108, title: 'Basket Film A', release_date: '2001-01-01', original_language: 'en', runtime: 90,
    genres: [{ id: 18, name: 'Drama' }], director: 'A Director' },
  { id: 109, title: 'Basket Film B', release_date: '2002-01-01', original_language: 'en', runtime: 95,
    genres: [{ id: 18, name: 'Drama' }], director: 'A Director' },
  { id: 110, title: 'Not Yet Cached', release_date: '2003-01-01', original_language: 'en', runtime: 100,
    genres: [{ id: 18, name: 'Drama' }], director: 'A Director' },
];

const detail = (movie) => ({
  ...movie,
  overview: `About ${movie.title}`,
  poster_path: `/${movie.id}.jpg`,
  credits: { crew: [{ job: 'Director', name: movie.director }] },
});

// A single fixture for the direct-paste TV path (e.g. Histoire(s) du cinéma,
// catalogued on TMDB as a TV series) and the boxset-split endpoint's tv branch.
const TV_CATALOGUE = [
  { id: 900, name: 'A TV Anthology', first_air_date: '1990-03-01', original_language: 'en',
    created_by: [{ name: 'Some Creator' }] },
];

const tvDetail = (show) => ({
  ...show,
  overview: `About ${show.name}`,
  poster_path: `/${show.id}.jpg`,
  episode_run_time: [50],
  credits: { crew: [] },
});

const realFetch = globalThis.fetch;
let tmdbCalls = 0;

globalThis.fetch = async (input, init) => {
  // tmdb.js passes a URL instance; keep strings and Requests working too.
  const href = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
  const url = new URL(href);
  if (url.hostname !== 'api.themoviedb.org') return realFetch(input, init);

  tmdbCalls += 1;
  const json = (body) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  if (url.pathname === '/3/genre/movie/list') {
    return json({
      genres: [{ id: 18, name: 'Drama' }, { id: 27, name: 'Horror' }, { id: 99, name: 'Documentary' }],
    });
  }
  if (url.pathname === '/3/search/movie') {
    const query = (url.searchParams.get('query') ?? '').toLowerCase();
    const year = url.searchParams.get('year');
    let results = CATALOGUE.filter((movie) => movie.title.toLowerCase() === query);
    if (year) results = results.filter((movie) => movie.release_date.startsWith(year));
    return json({ results });
  }
  const match = /^\/3\/movie\/(\d+)$/.exec(url.pathname);
  if (match) {
    const movie = CATALOGUE.find((entry) => entry.id === Number(match[1]));
    return movie
      ? json(detail(movie))
      : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }
  const tvMatch = /^\/3\/tv\/(\d+)$/.exec(url.pathname);
  if (tvMatch) {
    const show = TV_CATALOGUE.find((entry) => entry.id === Number(tvMatch[1]));
    return show
      ? json(tvDetail(show))
      : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 404 });
};

// --- Harness --------------------------------------------------------------

const { createApp } = await import('../server/index.js');
const { getDb } = await import('../server/db.js');
getDb();

const server = createApp().listen(PORT, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${PORT}`;
test.after(() => server.close());

async function call(path, { method = 'GET', body, text } = {}) {
  const options = { method, headers: {} };
  if (text !== undefined) {
    options.headers['content-type'] = 'text/plain';
    options.body = text;
  } else if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const response = await realFetch(base + path, options);
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

const waitForImport = async (jobId) => {
  for (let i = 0; i < 100; i += 1) {
    const { body } = await call(`/api/lists/imports/${jobId}`);
    if (body.status !== 'running') return body;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('import did not finish');
};

// --- Tests ----------------------------------------------------------------

let listId;

test('creates a list and imports titles, resolving them against TMDB', async () => {
  const created = await call('/api/lists', { method: 'POST', body: { name: 'Test List' } });
  assert.equal(created.status, 201);
  listId = created.body.id;

  const started = await call(`/api/lists/${listId}/import`, {
    method: 'POST',
    text: 'Vertigo (1958)\nTokyo Story (1953)\nSeven Samurai (1954)\nPsycho\nNot A Real Film',
  });
  assert.equal(started.status, 202);

  const job = await waitForImport(started.body.id);
  assert.equal(job.resolved, 3, 'the three unambiguous titles resolve');
  // "Psycho" with no year is ambiguous between 1960 and 1998; "Not A Real Film"
  // has no match. Neither may be silently dropped.
  assert.equal(job.needs_review + job.unmatched, 2);
  assert.equal(job.done, job.total);
});

test('unresolved entries are kept for manual reconciliation', async () => {
  const { body } = await call(`/api/lists/${listId}/entries?status=needs_review`);
  const titles = body.entries.map((entry) => entry.raw_title);

  assert.ok(titles.includes('Psycho'));
  assert.ok(titles.includes('Not A Real Film'));

  const psycho = body.entries.find((entry) => entry.raw_title === 'Psycho');
  assert.ok(psycho.candidates.length >= 2, 'both Psychos are offered as candidates');
});

test('the host can resolve a flagged entry by picking a candidate', async () => {
  const { body } = await call(`/api/lists/${listId}/entries?status=needs_review`);
  const psycho = body.entries.find((entry) => entry.raw_title === 'Psycho');

  const resolved = await call(`/api/lists/entries/${psycho.id}/resolve`, {
    method: 'POST',
    body: { tmdb_id: 104 },
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.status, 'resolved');

  const after = await call(`/api/lists/${listId}/entries?status=needs_review`);
  assert.ok(!after.body.entries.some((entry) => entry.raw_title === 'Psycho'));
});

test('activating the list fills the draw pool', async () => {
  await call(`/api/lists/${listId}`, { method: 'PATCH', body: { is_active: true } });

  const { body } = await call('/api/lists');
  assert.equal(body.pool_size, 4);
});

test('filters narrow the pool and are reflected in the count', async () => {
  const all = await call('/api/pool/count', { method: 'POST', body: { filters: {} } });
  assert.equal(all.body.count, 4);

  const japanese = await call('/api/pool/count', {
    method: 'POST',
    body: { filters: { languages: { include: ['ja'] } } },
  });
  assert.equal(japanese.body.count, 2);

  const noJapanese = await call('/api/pool/count', {
    method: 'POST',
    body: { filters: { languages: { exclude: ['ja'] } } },
  });
  assert.equal(noJapanese.body.count, 2);

  const noHorror = await call('/api/pool/count', {
    method: 'POST',
    body: { filters: { genres: { exclude: [27] } } },
  });
  assert.equal(noHorror.body.count, 3);
});

test('marking a film watched removes it from the pool, and the toggle brings it back', async () => {
  await call('/api/movies/101/watched', { method: 'POST', body: { watched: true } });

  const excluded = await call('/api/pool/count', { method: 'POST', body: { filters: {} } });
  assert.equal(excluded.body.count, 3);

  const included = await call('/api/pool/count', {
    method: 'POST',
    body: { filters: { includeWatched: true } },
  });
  assert.equal(included.body.count, 4);

  await call('/api/movies/101/watched', { method: 'POST', body: { watched: false } });
});

test('an over-tight draw reports the shortfall instead of failing', async () => {
  const { status, body } = await call('/api/draw', {
    method: 'POST',
    body: { size: 5, filters: { languages: { include: ['ja'] } } },
  });

  assert.equal(status, 200);
  assert.equal(body.movies.length, 2);
  assert.equal(body.available, 2);
  assert.equal(body.shortfall, 3);
});

test('a draw persists nothing until it is published', async () => {
  const before = await call('/api/sessions');
  await call('/api/draw', { method: 'POST', body: { size: 2, filters: {} } });
  const after = await call('/api/sessions');

  assert.equal(after.body.sessions.length, before.body.sessions.length);
});

test('accepts any whole draw size from 1 to 10, not just 1/2/5', async () => {
  const { status, body } = await call('/api/draw', { method: 'POST', body: { size: 3, filters: {} } });
  assert.equal(status, 200);
  assert.equal(body.requested, 3);
});

test('rejects a draw size outside 1–10', async () => {
  assert.equal((await call('/api/draw', { method: 'POST', body: { size: 0 } })).status, 400);
  assert.equal((await call('/api/draw', { method: 'POST', body: { size: 11 } })).status, 400);
  assert.equal((await call('/api/draw', { method: 'POST', body: { size: 2.5 } })).status, 400);
  assert.equal((await call('/api/draw', { method: 'POST', body: { size: -1 } })).status, 400);
});

let slug;

test('publishing a draw opens a vote session at an unguessable slug', async () => {
  const { status, body } = await call('/api/sessions', {
    method: 'POST',
    body: {
      tmdb_ids: [101, 102, 103],
      anonymous: false,
      filters: { year: { min: 1950, max: 1960 } },
    },
  });

  slug = body.slug;
  assert.equal(status, 201);
  assert.match(body.slug, /^[2-9a-hjkmnp-z]{6}$/);
  assert.equal(body.url, `http://192.168.1.50:${PORT}/vote/${body.slug}`);
});

test('the QR code renders as SVG for the published URL', async () => {
  const response = await realFetch(`${base}/api/sessions/${slug}/qr.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await response.text(), /<svg/);
});

test('guests submit ranked ballots', async () => {
  const ana = await call(`/api/sessions/${slug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Ana', ranks: [101, 102, 103] },
  });
  assert.equal(ana.status, 201);
  assert.equal(ana.body.ranked, 3);

  await call(`/api/sessions/${slug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Ben', ranks: [{ tmdb_id: 102, rank: 1 }, { tmdb_id: 101, rank: 2 }] },
  });
  await call(`/api/sessions/${slug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Cy', ranks: [101] },
  });
});

test('a ballot needs a name and at least one pick', async () => {
  const noName = await call(`/api/sessions/${slug}/ballots`, {
    method: 'POST',
    body: { voter_name: '  ', ranks: [101] },
  });
  assert.equal(noName.status, 400);

  const noPicks = await call(`/api/sessions/${slug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Dee', ranks: [] },
  });
  assert.equal(noPicks.status, 400);
});

test('the host sees a running tally while voting is open', async () => {
  const { body } = await call(`/api/sessions/${slug}?include=tally`);

  assert.equal(body.ballot_count, 3);
  assert.deepEqual(body.voters, ['Ana', 'Ben', 'Cy']);
  // Ana 2 + Ben 1 + Cy 2 = 5 for Vertigo.
  assert.equal(body.tally.standings.find((row) => row.tmdb_id === 101).points, 5);
  assert.equal(body.filter_summary, 'Test List · 1950–1960');
});

test('closing produces results, and closing is final', async () => {
  const closed = await call(`/api/sessions/${slug}/close`, { method: 'POST' });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.winner_tmdb_id, 101);
  assert.equal(closed.body.ballots.length, 3, 'named ballots are visible when not anonymous');

  const late = await call(`/api/sessions/${slug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Late', ranks: [101] },
  });
  assert.equal(late.status, 409);
});

test('results are stable across reads', async () => {
  const first = await call(`/api/sessions/${slug}/results`);
  const second = await call(`/api/sessions/${slug}/results`);
  assert.equal(first.body.winner_tmdb_id, second.body.winner_tmdb_id);
});

test('cancelling an open session throws the whole draw away, ballots included', async () => {
  const published = await call('/api/sessions', { method: 'POST', body: { tmdb_ids: [101, 102] } });
  const cancelSlug = published.body.slug;

  await call(`/api/sessions/${cancelSlug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Ana', ranks: [101, 102] },
  });

  const cancelled = await call(`/api/sessions/${cancelSlug}`, { method: 'DELETE' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.cancelled, true);

  // Gone entirely — not just marked closed, and not left over in history.
  assert.equal((await call(`/api/sessions/${cancelSlug}`)).status, 404);
  const { body: history } = await call('/api/sessions');
  assert.ok(!history.sessions.some((s) => s.slug === cancelSlug));
});

test('a closed session cannot be cancelled — cancel only undoes an open one', async () => {
  // `slug` (from earlier in this suite) is already closed.
  const attempt = await call(`/api/sessions/${slug}`, { method: 'DELETE' });
  assert.equal(attempt.status, 400);

  // Still there, untouched.
  assert.equal((await call(`/api/sessions/${slug}/results`)).status, 200);
});

test('an anonymous session never records who voted', async () => {
  const published = await call('/api/sessions', {
    method: 'POST',
    body: { tmdb_ids: [101, 102], anonymous: true },
  });
  const anonSlug = published.body.slug;

  await call(`/api/sessions/${anonSlug}/ballots`, {
    method: 'POST',
    body: { voter_name: 'Ana', ranks: [101, 102] },
  });
  await call(`/api/sessions/${anonSlug}/ballots`, {
    method: 'POST',
    body: { ranks: [102, 101] },
  });

  // Withheld from the host while open...
  const open = await call(`/api/sessions/${anonSlug}?include=tally`);
  assert.equal(open.body.ballot_count, 2);
  assert.equal(open.body.tally, undefined);
  assert.equal(open.body.voters, undefined);

  // ...and never written to disk in the first place.
  const rows = getDb()
    .prepare('SELECT voter_name, created_at FROM ballots WHERE slug = ?')
    .all(anonSlug);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.voter_name === null && row.created_at === null));

  const closed = await call(`/api/sessions/${anonSlug}/close`, { method: 'POST' });
  assert.equal(closed.body.ballots, null, 'aggregate only, even for the host');
  assert.equal(closed.body.ballot_count, 2);
  assert.ok(closed.body.standings.length === 2);
});

test('history lists published draws newest first, with filters and winner', async () => {
  const { body } = await call('/api/sessions');

  assert.equal(body.sessions.length, 2);
  const session = body.sessions.find((entry) => entry.slug === slug);
  assert.equal(session.winner_title, 'Vertigo');
  assert.equal(session.ballot_count, 3);
  assert.equal(session.movie_count, 3);
  assert.equal(session.filter_summary, 'Test List · 1950–1960');
  assert.equal(session.status, 'closed');
});

test('unknown slugs 404 rather than leaking anything', async () => {
  assert.equal((await call('/api/sessions/zzzzzz')).status, 404);
  assert.equal((await call('/api/sessions/!!!')).status, 404);
});

test('the SPA is served for the guest route', async () => {
  const response = await realFetch(`${base}/vote/${slug}`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="app"/);
});

test('resolution reuses the cache rather than re-querying TMDB', async () => {
  const before = tmdbCalls;
  await call('/api/pool/count', { method: 'POST', body: { filters: {} } });
  await call('/api/draw', { method: 'POST', body: { size: 2 } });
  assert.equal(tmdbCalls, before, 'drawing never touches the network');
});

// --- Direct TMDB paste + boxset splitting -----------------------------------
// A dedicated list, so these don't disturb the hand-tuned pool counts above.

let pasteListId;

test('setup: a second list for the paste/boxset tests', async () => {
  const created = await call('/api/lists', { method: 'POST', body: { name: 'Paste Test List' } });
  pasteListId = created.body.id;
});

test('a pasted TMDB id resolves an entry search could never find (a TV-catalogued title)', async () => {
  const started = await call(`/api/lists/${pasteListId}/import`, {
    method: 'POST',
    text: 'Not A Real Film',
  });
  await waitForImport(started.body.id);
  const { body: pending } = await call(`/api/lists/${pasteListId}/entries?status=needs_review`);
  const entry = pending.entries.find((e) => e.raw_title === 'Not A Real Film');
  assert.ok(entry, 'precondition: unresolved, since it matches nothing in the stub catalogue');

  const resolved = await call(`/api/lists/entries/${entry.id}/resolve`, {
    method: 'POST',
    body: { tmdb_id: 900, media_type: 'tv' },
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.tmdb_id, -900, 'stored under the negated id, never the raw positive one');
  assert.equal(resolved.body.movie.media_type, 'tv');
  assert.equal(resolved.body.movie.title, 'A TV Anthology');

  const after = await call(`/api/lists/${pasteListId}/entries?status=needs_review`);
  assert.ok(!after.body.entries.some((e) => e.raw_title === 'Not A Real Film'));
});

let boxsetEntryId;

test('setup: a placeholder entry to split into a boxset', async () => {
  const started = await call(`/api/lists/${pasteListId}/import`, {
    method: 'POST',
    text: 'Some Boxset Placeholder',
  });
  await waitForImport(started.body.id);
  const { body } = await call(`/api/lists/${pasteListId}/entries?status=needs_review`);
  const entry = body.entries.find((e) => e.raw_title === 'Some Boxset Placeholder');
  assert.ok(entry, 'the unmatched placeholder is kept for reconciliation, not dropped');
  boxsetEntryId = entry.id;
});

test('resolve-many splits one ambiguous entry into several independent resolved films', async () => {
  const { status, body } = await call(`/api/lists/entries/${boxsetEntryId}/resolve-many`, {
    method: 'POST',
    body: { items: [{ tmdb_id: 106 }, { tmdb_id: 107 }] },
  });

  assert.equal(status, 200);
  assert.equal(body.resolved.length, 2);
  assert.deepEqual(body.resolved.map((m) => m.title).sort(), ['Koyaanisqatsi', 'Powaqqatsi']);
  assert.equal(body.failed.length, 0);

  const { body: entries } = await call(`/api/lists/${pasteListId}/entries`);
  assert.ok(
    !entries.entries.some((e) => e.raw_title === 'Some Boxset Placeholder'),
    'the ambiguous placeholder is gone, replaced by its N films',
  );
  const titles = entries.entries.map((e) => e.title);
  assert.ok(titles.includes('Koyaanisqatsi') && titles.includes('Powaqqatsi'));
});

let secondBoxsetEntryId;

test('resolve-many reports per-item failures without losing the successes', async () => {
  const started = await call(`/api/lists/${pasteListId}/import`, {
    method: 'POST',
    text: 'Another Boxset Placeholder',
  });
  await waitForImport(started.body.id);
  const { body: pending } = await call(`/api/lists/${pasteListId}/entries?status=needs_review`);
  const entry = pending.entries.find((e) => e.raw_title === 'Another Boxset Placeholder');
  secondBoxsetEntryId = entry.id;

  const { status, body } = await call(`/api/lists/entries/${entry.id}/resolve-many`, {
    method: 'POST',
    // 106 (Koyaanisqatsi) is already on this list from the previous test —
    // must come back as a per-item failure, not silently accepted, and must
    // not abort resolution of the rest of the batch.
    body: { items: [{ tmdb_id: 106 }, { tmdb_id: 999 }] },
  });

  assert.equal(status, 200);
  assert.equal(body.resolved.length, 0);
  assert.equal(body.failed.length, 2);
  assert.match(body.failed[0].error, /already on this list/);

  // Nothing resolved, so the ambiguous placeholder must still be there — never silently lost.
  const { body: stillPending } = await call(`/api/lists/${pasteListId}/entries?status=needs_review`);
  assert.ok(stillPending.entries.some((e) => e.raw_title === 'Another Boxset Placeholder'));
});

test('resolve-many rejects an empty or oversized item list', async () => {
  const empty = await call(`/api/lists/entries/${secondBoxsetEntryId}/resolve-many`, {
    method: 'POST',
    body: { items: [] },
  });
  assert.equal(empty.status, 400);

  const tooMany = await call(`/api/lists/entries/${secondBoxsetEntryId}/resolve-many`, {
    method: 'POST',
    body: { items: Array.from({ length: 21 }, (_, i) => ({ tmdb_id: i + 1 })) },
  });
  assert.equal(tooMany.status, 400);
});

// --- Staging basket: draw more, add by search, add manually ---------------

let basketListId;

test('setup: a small active pool for the staging-basket tests', async () => {
  const created = await call('/api/lists', { method: 'POST', body: { name: 'Basket Test List' } });
  basketListId = created.body.id;
  await call(`/api/lists/${basketListId}`, { method: 'PATCH', body: { is_active: true } });

  const started = await call(`/api/lists/${basketListId}/import`, {
    method: 'POST',
    text: 'Basket Film A (2001)\nBasket Film B (2002)',
  });
  const job = await waitForImport(started.body.id);
  assert.equal(job.resolved, 2);
});

// These all scope to `search: 'Basket Film'` rather than a broad filter like
// language — by this point in the suite several OTHER lists are active too,
// with plenty of English-language films of their own, so a broad filter
// wouldn't isolate just this test's 2 fixtures the way a narrow search does.

test('draw with exclude tops up a basket instead of duplicating what is already staged', async () => {
  const first = await call('/api/draw', {
    method: 'POST',
    body: { size: 1, filters: { search: 'Basket Film' } },
  });
  const stagedId = first.body.movies[0].tmdb_id;

  // Ask for the other one, excluding what's already staged.
  const second = await call('/api/draw', {
    method: 'POST',
    body: { size: 1, filters: { search: 'Basket Film' }, exclude: [stagedId] },
  });
  assert.equal(second.body.movies.length, 1);
  assert.notEqual(second.body.movies[0].tmdb_id, stagedId);

  // And excluding both leaves nothing, reported as a shortfall, not an error.
  const third = await call('/api/draw', {
    method: 'POST',
    body: {
      size: 1,
      filters: { search: 'Basket Film' },
      exclude: [stagedId, second.body.movies[0].tmdb_id],
    },
  });
  assert.equal(third.status, 200);
  assert.equal(third.body.movies.length, 0);
  assert.equal(third.body.shortfall, 1);
});

test('pool/count reflects exclude too, for the live basket count', async () => {
  const withoutExclude = await call('/api/pool/count', {
    method: 'POST',
    body: { filters: { search: 'Basket Film' } },
  });
  assert.equal(withoutExclude.body.count, 2);

  const withExclude = await call('/api/pool/count', {
    method: 'POST',
    body: { filters: { search: 'Basket Film' }, exclude: [108] },
  });
  assert.equal(withExclude.body.count, 1);
});

test('TMDB search flags results already on one of the host\'s lists', async () => {
  const { body } = await call('/api/tmdb/search?q=Vertigo');
  const result = body.results.find((r) => r.tmdb_id === 101);
  assert.ok(result);
  assert.equal(result.lists, 'Test List', 'Vertigo was resolved onto "Test List" earlier in this suite');

  // A film on none of the host's lists reports no lists at all.
  const notOnAnyList = await call('/api/tmdb/search?q=Not Yet Cached');
  assert.equal(notOnAnyList.body.results[0].lists, null);
});

test('GET /api/movies/:id caches on first fetch, then serves from cache', async () => {
  const before = tmdbCalls;
  const first = await call('/api/movies/110');
  assert.equal(first.status, 200);
  assert.equal(first.body.movie.title, 'Not Yet Cached');
  assert.equal(tmdbCalls, before + 1, 'first request had to fetch from TMDB');

  const second = await call('/api/movies/110');
  assert.equal(second.body.movie.title, 'Not Yet Cached');
  assert.equal(tmdbCalls, before + 1, 'second request served from the local cache, no network hit');
});

test('a manual entry has no TMDB source and never appears in the pool', async () => {
  const created = await call('/api/movies/manual', {
    method: 'POST',
    body: { title: 'Someone’s Home Movie', year: 2019 },
  });
  assert.equal(created.status, 200);
  const manual = created.body.movie;
  assert.ok(manual.tmdb_id <= -1_000_000_000);
  assert.equal(manual.is_manual, 1);
  assert.equal(manual.poster_path, null);

  // It was never linked into any list, so it can never appear in a random
  // draw or an Explore search — it exists only for a specific session's basket.
  const searchForIt = await call('/api/pool/movies', {
    method: 'POST',
    body: { filters: { search: 'Home Movie' } },
  });
  assert.equal(searchForIt.body.movies.length, 0);
});

test('a basket combining a draw, a search-add, and a manual entry all publish together', async () => {
  const drawn = await call('/api/draw', {
    method: 'POST',
    body: { size: 1, filters: { languages: { include: ['en'] } } },
  });
  const drawnId = drawn.body.movies[0].tmdb_id;

  const cached = await call('/api/movies/110');
  const manual = await call('/api/movies/manual', {
    method: 'POST',
    body: { title: 'A Friend’s Proposal', year: null },
  });

  const tmdbIds = [drawnId, cached.body.movie.tmdb_id, manual.body.movie.tmdb_id];
  const published = await call('/api/sessions', { method: 'POST', body: { tmdb_ids: tmdbIds } });
  assert.equal(published.status, 201);

  const session = await call(`/api/sessions/${published.body.slug}`);
  assert.deepEqual(
    session.body.movies.map((m) => m.tmdb_id).sort((a, b) => a - b),
    [...tmdbIds].sort((a, b) => a - b),
  );
  const manualInSession = session.body.movies.find((m) => m.tmdb_id === manual.body.movie.tmdb_id);
  assert.equal(manualInSession.title, 'A Friend’s Proposal');
});
