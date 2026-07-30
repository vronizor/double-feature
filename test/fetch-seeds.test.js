import test from 'node:test';
import assert from 'node:assert/strict';

import { droppedKeys } from '../scripts/fetch-seed-lists.mjs';

// The regression: the written payload carried `category` but not `tags`, so a
// re-fetch silently deleted the tags array from every committed seed file. It
// failed silently twice over — seed.mjs skips the tag sync when the key is
// absent, so an existing database kept working, and it would only have shown up
// on a fresh install as every vibe resolving to an empty pool.
test('a payload that would drop tags from an existing seed file is refused', () => {
  const existing = { name: 'Studio Ghibli', tags: ['collection', 'family'], category: 'collection' };
  const payload = { name: 'Studio Ghibli', category: 'collection' };
  assert.deepEqual(droppedKeys(existing, payload), ['tags']);
});

test('carrying every preserved key through is allowed', () => {
  const existing = { name: 'Studio Ghibli', tags: ['collection'], category: 'collection' };
  const payload = { name: 'Studio Ghibli', tags: ['collection', 'family'], category: 'collection' };
  assert.deepEqual(droppedKeys(existing, payload), []);
});

test('an empty array counts as dropped, not as present', () => {
  // Otherwise `tags: []` would sail through the guard and strip them anyway.
  const existing = { tags: ['canon'] };
  assert.deepEqual(droppedKeys(existing, { tags: [] }), ['tags']);
});

test('a first fetch, with no existing file, is never blocked', () => {
  assert.deepEqual(droppedKeys(null, { name: 'Box-office France' }), []);
});

test('a key the existing file never had is not a drop', () => {
  assert.deepEqual(droppedKeys({ name: 'x' }, { name: 'x' }), []);
});
