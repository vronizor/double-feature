import test from 'node:test';
import assert from 'node:assert/strict';

import { toggleRank, rankOf, toBallot } from '../public/ranking.js';

test('successive taps rank 1, 2, 3', () => {
  let ranked = [];
  ranked = toggleRank(ranked, 10);
  ranked = toggleRank(ranked, 20);
  ranked = toggleRank(ranked, 30);

  assert.equal(rankOf(ranked, 10), 1);
  assert.equal(rankOf(ranked, 20), 2);
  assert.equal(rankOf(ranked, 30), 3);
});

test('unranked films report no rank', () => {
  assert.equal(rankOf([10, 20], 99), null);
});

test('tapping a ranked film removes it and closes the gap', () => {
  let ranked = [10, 20, 30];
  ranked = toggleRank(ranked, 20);

  assert.deepEqual(ranked, [10, 30]);
  assert.equal(rankOf(ranked, 10), 1);
  // 30 was rank 3; after removing 20 it must renumber to 2, not stay at 3.
  assert.equal(rankOf(ranked, 30), 2);
  assert.equal(rankOf(ranked, 20), null);
});

test('removing the first film renumbers everything below it', () => {
  const ranked = toggleRank([10, 20, 30], 10);
  assert.deepEqual(ranked.map((id) => rankOf(ranked, id)), [1, 2]);
  assert.equal(rankOf(ranked, 20), 1);
});

test('re-tapping after removal appends at the end', () => {
  let ranked = [10, 20, 30];
  ranked = toggleRank(ranked, 10);
  ranked = toggleRank(ranked, 10);

  assert.deepEqual(ranked, [20, 30, 10]);
  assert.equal(rankOf(ranked, 10), 3);
});

test('toggleRank does not mutate the array it is given', () => {
  const original = [10, 20];
  const next = toggleRank(original, 30);

  assert.deepEqual(original, [10, 20]);
  assert.deepEqual(next, [10, 20, 30]);
});

test('toBallot emits contiguous ranks from 1', () => {
  assert.deepEqual(toBallot([7, 8]), [
    { tmdb_id: 7, rank: 1 },
    { tmdb_id: 8, rank: 2 },
  ]);
  assert.deepEqual(toBallot([]), []);
});
