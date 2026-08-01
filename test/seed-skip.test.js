import test from 'node:test';
import assert from 'node:assert/strict';

import { alreadySeeded } from '../scripts/seed.mjs';

/**
 * The re-seed skip decision.
 *
 * It was keyed on raw_title + raw_year alone, which is fragile in three ways
 * that all look like nothing going wrong: a corrected title in a seed file
 * makes an existing row look new, which wastes a TMDB call for a resolved
 * entry — and genuinely duplicates an UNRESOLVED one, because
 * `list_movies_unique` is a partial index (`WHERE tmdb_id IS NOT NULL`) and so
 * does not cover needs_review rows at all.
 *
 * The new key is additive: id when the entry has one, title+year otherwise. It
 * can only ever widen what gets skipped, which is why it cannot introduce a
 * duplicate the old key would have caught.
 */
const rows = [
  { tmdb_id: 346, raw_title: 'Seven Samurai', raw_year: 1954 },
  { tmdb_id: null, raw_title: 'A Film Nobody Matched', raw_year: 1970 },
  { tmdb_id: 999, raw_title: 'No Year Recorded', raw_year: null },
];

test('an entry is skipped when its tmdb_id is already present', () => {
  assert.equal(alreadySeeded(rows, { tmdb_id: 346, title: 'Seven Samurai', year: 1954 }), true);
});

test('a corrected title still matches on the id — the whole point', () => {
  // This is what used to cost a wasted TMDB call every re-seed.
  assert.equal(alreadySeeded(rows, { tmdb_id: 346, title: 'Shichinin no samurai', year: 1954 }), true);
});

test('an unresolved row still matches on title and year', () => {
  // No tmdb_id on either side, so the fallback is the only key there is — and
  // the partial unique index does not protect these rows, so this is the one
  // that actually prevented a duplicate.
  assert.equal(alreadySeeded(rows, { title: 'A Film Nobody Matched', year: 1970 }), true);
});

test('a missing year is matched as a missing year, not as any year', () => {
  assert.equal(alreadySeeded(rows, { title: 'No Year Recorded' }), true);
  assert.equal(alreadySeeded(rows, { title: 'No Year Recorded', year: 1980 }), false);
});

test('a genuinely new entry is not skipped', () => {
  assert.equal(alreadySeeded(rows, { tmdb_id: 111, title: 'Something Else', year: 2001 }), false);
});

test('a new id with a title that collides is still skipped, and that is correct', () => {
  // Two different films can share a title and year in a seed file; the
  // fallback catches the second one. Skipping is the safe direction — the old
  // key did the same, and widening the check cannot make it worse.
  assert.equal(alreadySeeded(rows, { tmdb_id: 222, title: 'Seven Samurai', year: 1954 }), true);
});

test('an entry with no id and no match is seeded', () => {
  assert.equal(alreadySeeded(rows, { title: 'Brand New', year: 1999 }), false);
});
