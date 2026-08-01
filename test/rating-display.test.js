import test from 'node:test';
import assert from 'node:assert/strict';

import { chooseRating, countryLabel, IMDB_VOTE_FLOOR } from '../public/dom.js';

// `chooseRating` and `countryLabel` touch no DOM — the node-building half of
// `ratingLine` is a one-liner wrapped around the first of these, which is why
// the decision was split out of it.

const film = (over = {}) => ({
  vote_average: 7.8,
  imdb_rating: 7.1,
  imdb_votes: 50_000,
  ...over,
});

// --- Which score leads -----------------------------------------------------

test('TMDB leads by default, with IMDb on hover', () => {
  const chosen = chooseRating(film(), 'tmdb');
  assert.equal(chosen.text, '★ 7.8');
  assert.equal(chosen.title, 'IMDb 7.1');
});

test('preferring IMDb swaps which one is on the line and which is on hover', () => {
  const chosen = chooseRating(film(), 'imdb');
  assert.equal(chosen.text, 'IMDb 7.1');
  assert.equal(chosen.title, 'TMDB 7.8');
});

test('the vote count appears nowhere', () => {
  // It used to hang off the IMDb score as its tooltip, which made the two read
  // as different kinds of number. The floor still does the job it was there for.
  const chosen = chooseRating(film({ imdb_votes: 269_000 }), 'tmdb');
  assert.doesNotMatch(chosen.title, /vote|269/i);
  assert.doesNotMatch(chosen.text, /vote|269/i);
});

// --- Falling back ----------------------------------------------------------

test('preferring IMDb on a film that has none still shows TMDB', () => {
  // The preference orders the two; it does not blank the line.
  const chosen = chooseRating(film({ imdb_rating: null, imdb_votes: null }), 'imdb');
  assert.equal(chosen.text, '★ 7.8');
  assert.equal(chosen.title, null, 'nothing to reveal on hover');
});

test('a film under the vote floor has no second opinion to offer', () => {
  const chosen = chooseRating(film({ imdb_votes: IMDB_VOTE_FLOOR - 1 }), 'tmdb');
  assert.equal(chosen.text, '★ 7.8');
  assert.equal(chosen.title, null, 'below the floor must read as absent, not as a low score');
});

test('an unrated film renders no rating at all rather than a zero', () => {
  assert.equal(chooseRating({ vote_average: 0 }, 'tmdb'), null);
  assert.equal(chooseRating({ vote_average: 0 }, 'imdb'), null);
});

test('IMDb alone still shows when TMDB has no score', () => {
  const chosen = chooseRating(film({ vote_average: 0 }), 'tmdb');
  assert.equal(chosen.text, 'IMDb 7.1');
  assert.equal(chosen.title, null);
});

test('an unrecognised preference behaves as TMDB rather than blanking the line', () => {
  assert.equal(chooseRating(film(), 'letterboxd').text, '★ 7.8');
});

// --- Country chip labels ---------------------------------------------------

test('only the names that overflow are shortened', () => {
  assert.equal(countryLabel('United States of America'), 'USA');
  assert.equal(countryLabel('United Kingdom'), 'UK');
  assert.equal(countryLabel('Soviet Union'), 'USSR');
});

test('everything else renders as itself', () => {
  // The map is a display convenience with a fall-through, not a vocabulary.
  for (const name of ['France', 'Italy', 'Japan', 'Belgium', 'Sweden', 'Hong Kong']) {
    assert.equal(countryLabel(name), name);
  }
});

test('an unknown country is passed through untouched', () => {
  // Countries come from movies.countries, which TMDB fills — a name this map
  // has never seen must still render.
  assert.equal(countryLabel('Kingdom of Wakanda'), 'Kingdom of Wakanda');
});
