import test from 'node:test';
import assert from 'node:assert/strict';

import { lineup } from '../public/lineup.js';

const reset = () => lineup.clear();

test('provenance defaults to a deliberate add', () => {
  reset();
  lineup.add({ tmdb_id: 1, title: 'A' });
  assert.equal(lineup.movies[0].source, 'added');
});

test('drawn() returns only films the machine picked', () => {
  reset();
  lineup.addAll([{ tmdb_id: 1, title: 'A' }, { tmdb_id: 2, title: 'B' }], 'draw');
  lineup.add({ tmdb_id: 3, title: 'Requested' });
  assert.deepEqual(lineup.drawn().map((m) => m.tmdb_id), [1, 2]);
  assert.equal(lineup.movies.length, 3);
});

test('Replace must never be able to discard a deliberate pick', () => {
  // The whole reason provenance exists: someone asked for film 3 by name.
  reset();
  lineup.addAll([{ tmdb_id: 1, title: 'A' }], 'draw');
  lineup.add({ tmdb_id: 3, title: 'Requested' });
  for (const movie of lineup.drawn()) lineup.remove(movie.tmdb_id);
  assert.deepEqual(lineup.ids(), [3]);
});

test('adding the same film twice is still refused, whatever the source', () => {
  reset();
  assert.equal(lineup.add({ tmdb_id: 1, title: 'A' }, 'draw'), true);
  assert.equal(lineup.add({ tmdb_id: 1, title: 'A' }, 'added'), false);
  assert.equal(lineup.movies.length, 1);
});

test('the stored entry is a copy, so the caller cannot mutate lineup state', () => {
  reset();
  const movie = { tmdb_id: 1, title: 'A' };
  lineup.add(movie, 'draw');
  movie.title = 'changed';
  assert.equal(lineup.movies[0].title, 'A');
});
