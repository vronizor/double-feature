import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeTitle, scoreCandidate, pickTrailer, tvToMovie } from '../server/tmdb.js';
import { generateSlug, isValidSlug } from '../server/slug.js';

test('normalisation folds accents, punctuation and case', () => {
  assert.equal(normalizeTitle('Amélie'), normalizeTitle('Amelie'));
  assert.equal(normalizeTitle('Sátántangó'), 'satantango');
  assert.equal(normalizeTitle('WALL·E'), 'wall e');
  assert.equal(normalizeTitle('CITIZEN KANE'), normalizeTitle('Citizen Kane'));
});

test('normalisation drops a leading article so list styles agree', () => {
  assert.equal(normalizeTitle('The Rules of the Game'), normalizeTitle('Rules of the Game'));
  assert.equal(normalizeTitle('Les Enfants du Paradis'), normalizeTitle('Enfants du Paradis'));
});

test('normalisation folds curly and straight apostrophes together', () => {
  assert.equal(normalizeTitle('Singin’ in the Rain'), normalizeTitle("Singin' in the Rain"));
});

test('an exact title and year is a confident match', () => {
  const result = scoreCandidate(
    { title: 'Vertigo', year: 1958 },
    { title: 'Vertigo', release_date: '1958-05-09', popularity: 30 },
  );
  assert.equal(result.confident, true);
  assert.equal(result.yearDelta, 0);
});

test('a one-year difference still counts as confident', () => {
  // Festival vs general release routinely differ by a year between sources.
  const result = scoreCandidate(
    { title: 'Vertigo', year: 1958 },
    { title: 'Vertigo', release_date: '1959-01-01' },
  );
  assert.equal(result.confident, true);
});

test('the same title in the wrong decade is not confident', () => {
  const result = scoreCandidate(
    { title: 'Psycho', year: 1960 },
    { title: 'Psycho', release_date: '1998-12-04' },
  );
  assert.equal(result.confident, false);
  assert.ok(result.score < 100);
});

test('a title with no year given is never auto-confident', () => {
  // Without a year there is nothing to disambiguate remakes, so it goes to review.
  const result = scoreCandidate(
    { title: 'Psycho', year: null },
    { title: 'Psycho', release_date: '1960-06-16' },
  );
  assert.equal(result.confident, false);
});

test('the original title is matched as well as the localised one', () => {
  const result = scoreCandidate(
    { title: 'Nuovo Cinema Paradiso', year: 1988 },
    { title: 'Cinema Paradiso', original_title: 'Nuovo Cinema Paradiso', release_date: '1988-11-17' },
  );
  assert.equal(result.confident, true);
});

test('slugs are unguessable-ish and free of look-alike characters', () => {
  const slugs = new Set();
  for (let i = 0; i < 500; i += 1) {
    const slug = generateSlug();
    assert.equal(slug.length, 6);
    assert.ok(isValidSlug(slug), `${slug} should be valid`);
    assert.doesNotMatch(slug, /[01ilo]/, 'ambiguous characters must not appear');
    slugs.add(slug);
  }
  assert.ok(slugs.size > 490, 'slugs should essentially never collide');
});

test('isValidSlug rejects junk', () => {
  assert.equal(isValidSlug('abc'), false);
  assert.equal(isValidSlug('has-dash'), false);
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug(null), false);
});

test('pickTrailer prefers an official YouTube trailer over any other', () => {
  const key = pickTrailer([
    { site: 'YouTube', type: 'Trailer', official: false, key: 'unofficial' },
    { site: 'YouTube', type: 'Trailer', official: true, key: 'official' },
  ]);
  assert.equal(key, 'official');
});

test('pickTrailer falls back to the first YouTube trailer when none are official', () => {
  const key = pickTrailer([
    { site: 'YouTube', type: 'Trailer', official: false, key: 'first' },
    { site: 'YouTube', type: 'Trailer', official: false, key: 'second' },
  ]);
  assert.equal(key, 'first');
});

test('pickTrailer ignores non-YouTube sites and non-trailer clip types', () => {
  const key = pickTrailer([
    { site: 'Vimeo', type: 'Trailer', official: true, key: 'wrong-site' },
    { site: 'YouTube', type: 'Featurette', official: true, key: 'wrong-type' },
    { site: 'YouTube', type: 'Trailer', official: false, key: 'right-one' },
  ]);
  assert.equal(key, 'right-one');
});

test('pickTrailer returns null when nothing matches, including no videos at all', () => {
  assert.equal(pickTrailer([]), null);
  assert.equal(pickTrailer(undefined), null);
  assert.equal(
    pickTrailer([{ site: 'YouTube', type: 'Clip', official: true, key: 'not-a-trailer' }]),
    null,
  );
});

// --- tvToMovie: TMDB TV entries (e.g. Histoire(s) du cinéma) as movie rows --

test('tvToMovie stores the negated id, so it can never collide with a real movie id', () => {
  const movie = tvToMovie({ id: 206647, name: 'Histoire(s) du cinéma', genres: [] });
  assert.equal(movie.tmdb_id, -206647);
  assert.equal(movie.media_type, 'tv');
});

test('tvToMovie prefers created_by over the aggregated episode crew for "director"', () => {
  const movie = tvToMovie({
    id: 1,
    name: 'A Show',
    created_by: [{ name: 'Jean-Luc Godard' }],
    credits: { crew: [{ job: 'Director', name: 'Some Episode Director' }] },
    genres: [],
  });
  assert.equal(movie.director, 'Jean-Luc Godard');
});

test('tvToMovie falls back to aggregated crew directors when created_by is empty', () => {
  const movie = tvToMovie({
    id: 1,
    name: 'A Show',
    created_by: [],
    credits: { crew: [{ job: 'Director', name: 'Episode Director' }, { job: 'Writer', name: 'X' }] },
    genres: [],
  });
  assert.equal(movie.director, 'Episode Director');
});

test('tvToMovie maps name/first_air_date/episode_run_time onto the movie shape', () => {
  const movie = tvToMovie({
    id: 1,
    name: 'English Title',
    original_name: 'Titre Original',
    first_air_date: '1988-12-25',
    episode_run_time: [51, 50],
    genres: [{ id: 99, name: 'Documentary' }],
  });
  assert.equal(movie.title, 'English Title');
  assert.equal(movie.original_title, 'Titre Original');
  assert.equal(movie.year, 1988);
  assert.equal(movie.runtime, 51);
  assert.deepEqual(movie.genres, [{ id: 99, name: 'Documentary' }]);
});

test('tvToMovie handles a show with no episode_run_time at all', () => {
  const movie = tvToMovie({ id: 1, name: 'A Show', genres: [] });
  assert.equal(movie.runtime, null);
});

// --- Director night: the person half of a parametric vibe -----------------
//
// These stub fetch rather than calling TMDB, so they run without credentials.
// The shape they assert against was captured from the live API on 2026-07-30.

const realFetch = globalThis.fetch;

function stubTmdb(payloads) {
  globalThis.fetch = async (input) => {
    const url = String(input);
    const key = Object.keys(payloads).find((path) => url.includes(path));
    if (!key) throw new Error(`unstubbed TMDB path: ${url}`);
    return { ok: true, status: 200, json: async () => payloads[key] };
  };
}

test('person search puts directors above more popular non-directors', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  stubTmdb({
    '/search/person': {
      results: [
        { id: 1, name: 'Popular Actor', known_for_department: 'Acting', popularity: 90 },
        { id: 2, name: 'The Director', known_for_department: 'Directing', popularity: 3 },
      ],
    },
  });
  const { searchPerson } = await import('../server/tmdb.js');
  const results = await searchPerson('someone');

  // TMDB orders by popularity alone, which for a shared surname buries the
  // director under an actor. Directing must win regardless of the gap.
  assert.equal(results[0].name, 'The Director');
  assert.equal(results[0].directs, true);
  assert.equal(results[1].directs, false);
});

test('directed credits keep only job=Director, never any crew role', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  stubTmdb({
    '/movie_credits': {
      crew: [
        { id: 10, title: 'Directed This', job: 'Director', release_date: '1954-04-26' },
        // The exact noise that makes discover's with_crew return 112 films for
        // Kurosawa instead of 32 — measured, see ROADMAP section 2.
        { id: 11, title: 'Assisted On This', job: 'Assistant Director', release_date: '1936-01-01' },
        { id: 12, title: 'Wrote This', job: 'Screenplay', release_date: '1949-01-01' },
        { id: 13, title: 'Edited This', job: 'Editor', release_date: '1950-01-01' },
      ],
      cast: [{ id: 14, title: 'Acted In This' }],
    },
  });
  const { getDirectorCredits } = await import('../server/tmdb.js');
  const films = await getDirectorCredits(5026);

  assert.deepEqual(films.map((f) => f.id), [10]);
  assert.equal(films[0].year, 1954);
});

test('a film credited twice as director appears once', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  stubTmdb({
    '/movie_credits': {
      crew: [
        { id: 10, title: 'Co-directed', job: 'Director', release_date: '1960-01-01' },
        { id: 10, title: 'Co-directed', job: 'Director', release_date: '1960-01-01' },
      ],
    },
  });
  const { getDirectorCredits } = await import('../server/tmdb.js');
  assert.equal((await getDirectorCredits(1)).length, 1);
});

test('directed credits read oldest first, and undated films sink', async (t) => {
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  stubTmdb({
    '/movie_credits': {
      crew: [
        { id: 3, title: 'Later', job: 'Director', release_date: '1985-01-01' },
        { id: 4, title: 'Undated', job: 'Director', release_date: null },
        { id: 5, title: 'Earlier', job: 'Director', release_date: '1954-01-01' },
      ],
    },
  });
  const { getDirectorCredits } = await import('../server/tmdb.js');
  const films = await getDirectorCredits(1);
  assert.deepEqual(films.map((f) => f.title), ['Earlier', 'Later', 'Undated']);
  assert.equal(films[2].year, null);
});
