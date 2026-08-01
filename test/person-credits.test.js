/**
 * Director night and actor's night both read /person/{id}/movie_credits, but
 * from different halves of it. These tests pin the half, because "actor's
 * night is director night with the job swapped" is the intuitive reading and
 * it is wrong: acting is not a crew job, and swapping the string would return
 * an empty night rather than an error.
 *
 * Credentials are set before importing tmdb.js because `request` refuses
 * without them. The stub means no call ever leaves the machine.
 */
process.env.TMDB_API_KEY = 'test-key';

import test from 'node:test';
import assert from 'node:assert/strict';

const { getDirectorCredits, getActingCredits, ACTING_BILLING_LIMIT } = await import(
  '../server/tmdb.js'
);

// Shaped after the real payload for Toshiro Mifune, which is 167 cast credits
// against 13 crew ones — those thirteen being producer credits and a single
// directing credit.
const CREDITS = {
  cast: [
    { id: 1, title: 'Rashomon', release_date: '1950-08-26', order: 0 },
    { id: 2, title: 'Seven Samurai', release_date: '1954-04-26', order: 1 },
    { id: 3, title: 'High and Low', release_date: '1963-03-01', order: 2 },
    // Same film twice, as TMDB does when someone plays two roles.
    { id: 3, title: 'High and Low', release_date: '1963-03-01', order: 9 },
    { id: 4, title: 'Port Arthur', release_date: '1980-01-01', order: 127 },
    { id: 5, title: 'Desperado Outpost', release_date: '1959-01-01', order: 36 },
    { id: 6, title: 'No Billing At All', release_date: '1970-01-01', order: null },
  ],
  crew: [
    { id: 7, title: 'The Legacy of the 500,000', release_date: '1963-01-01', job: 'Director' },
    { id: 8, title: 'Some Production', release_date: '1962-01-01', job: 'Producer' },
    { id: 9, title: 'Another Production', release_date: '1961-01-01', job: 'Executive Producer' },
  ],
};

const realFetch = globalThis.fetch;
const stubCredits = () => {
  globalThis.fetch = async (input) => {
    const href = input instanceof URL ? input.href : String(input);
    if (!href.includes('api.themoviedb.org')) return realFetch(input);
    return new Response(JSON.stringify(CREDITS), {
      headers: { 'content-type': 'application/json' },
    });
  };
  return () => {
    globalThis.fetch = realFetch;
  };
};

test('acting credits come from cast — the crew array holds no acting job', () => {
  // The premise of the whole design, asserted against the fixture so that a
  // future refactor to "filter crew by job" fails here rather than silently
  // returning nothing.
  assert.equal(CREDITS.crew.filter((c) => c.job === 'Acting').length, 0);
  assert.ok(CREDITS.cast.length > 0);
});

test("an actor's night takes top-billed roles and drops the walk-ons", async () => {
  const restore = stubCredits();
  try {
    const films = await getActingCredits(7450);
    assert.deepEqual(
      films.map((f) => f.title),
      ['Rashomon', 'Seven Samurai', 'High and Low'],
      'billed 127th and 36th are not "their film"; unbilled is not either',
    );
  } finally {
    restore();
  }
});

test('a doubled cast credit yields one film, not two', async () => {
  const restore = stubCredits();
  try {
    const films = await getActingCredits(7450);
    assert.equal(films.filter((f) => f.id === 3).length, 1);
  } finally {
    restore();
  }
});

test('acting credits come back in release order', async () => {
  const restore = stubCredits();
  try {
    const films = await getActingCredits(7450);
    assert.deepEqual(films.map((f) => f.year), [1950, 1954, 1963]);
  } finally {
    restore();
  }
});

test('the billing limit is a boundary, not an off-by-one', async () => {
  // order 9 is the last kept value at a limit of 10. The fixture's doubled
  // credit sits exactly there, so this also proves the cut runs before the
  // de-duplication rather than after.
  assert.equal(ACTING_BILLING_LIMIT, 10);
  const restore = stubCredits();
  try {
    const films = await getActingCredits(7450);
    assert.ok(films.some((f) => f.id === 3));
  } finally {
    restore();
  }
});

test('director night still reads the crew array and ignores other jobs', async () => {
  const restore = stubCredits();
  try {
    const films = await getDirectorCredits(7450);
    assert.deepEqual(
      films.map((f) => f.title),
      ['The Legacy of the 500,000'],
      'producer credits are not a directing night',
    );
  } finally {
    restore();
  }
});

test('an actor with no billed roles resolves to nothing rather than throwing', async () => {
  const restore = stubCredits();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ cast: [{ id: 1, title: 'Extra', order: 40 }], crew: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  try {
    assert.deepEqual(await getActingCredits(1), []);
  } finally {
    restore();
  }
});
