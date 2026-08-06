import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Who a device thinks it is, and what that decides.
 *
 * The store itself is a Set and needs no defending. What is worth testing is
 * the identity half, because every way it can be wrong writes a film onto
 * somebody else's list and nothing anywhere fails.
 *
 * `watchlist.js` reads localStorage at import time, so the stub has to be in
 * place before the import — hence the dynamic import below rather than a
 * static one at the top. It touches no DOM otherwise.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { watchlist } = await import('../public/watchlist.js');

test.beforeEach(() => {
  store.clear();
  watchlist.reset();
});

test('a fresh device is unclaimed, and claiming it persists', () => {
  assert.equal(watchlist.claimed, false);
  assert.equal(watchlist.owner, null);

  watchlist.claim('Alice');
  assert.equal(watchlist.claimed, true);
  assert.equal(watchlist.owner, 'Alice');
  // Persisted under its own key, not inside the prefs blob — clearing display
  // preferences must not be able to take a device's identity with it.
  assert.equal(store.get('double-feature:owner'), 'Alice');
});

test('a blank name is refused, because two blanks would be the same person', () => {
  assert.throws(() => watchlist.claim('   '), /name is required/);
  assert.throws(() => watchlist.claim(''), /name is required/);
  assert.throws(() => watchlist.claim(null), /name is required/);
  assert.equal(watchlist.claimed, false);
});

test('the name is trimmed, so " Alice " and "Alice" are one person', () => {
  assert.equal(watchlist.claim('  Alice  '), 'Alice');
  assert.equal(watchlist.owner, 'Alice');
});

const LISTS = [
  { id: 1, name: 'Criterion', owner: null },
  { id: 7, name: 'Alice’s watchlist', owner: 'Alice' },
  { id: 8, name: 'Bob’s watchlist', owner: 'Bob' },
];

test('a device adopts its OWN watchlist and no one else’s', () => {
  watchlist.claim('Bob');
  const mine = watchlist.adopt(LISTS);

  assert.equal(mine.id, 8);
  assert.equal(watchlist.listId, 8);
});

test('and it still finds it after the list has been renamed', () => {
  watchlist.claim('Alice');
  // Exactly what the Lists tab does. The owner column is untouched by a
  // rename, which is the whole reason it is the column being matched on:
  // `builtin_key` and `seed_key` both exist because a name used as identity
  // detached its row the first time somebody renamed it.
  const renamed = LISTS.map((list) =>
    list.id === 7 ? { ...list, name: 'Films for the train' } : list,
  );

  assert.equal(watchlist.adopt(renamed).id, 7);
});

test('a person with no watchlist yet adopts nothing, rather than the first one going', () => {
  watchlist.claim('Chris');
  assert.equal(watchlist.adopt(LISTS), null);
  assert.equal(watchlist.listId, null);
});

test('an unclaimed device adopts nothing even when watchlists exist', () => {
  assert.equal(watchlist.adopt(LISTS), null);
  assert.equal(watchlist.listId, null);
});

test('a deleted watchlist takes its saved films with it', () => {
  watchlist.claim('Alice');
  watchlist.adopt(LISTS);
  watchlist.fill([101, 102]);
  assert.equal(watchlist.has(101), true);

  // Deleted from the Lists tab, so the next payload no longer carries it.
  watchlist.adopt(LISTS.filter((list) => list.id !== 7));

  assert.equal(watchlist.listId, null);
  // Otherwise every Save button would go on reading "Saved" for a list that
  // no longer exists, and un-saving would 400 against a missing entry.
  assert.equal(watchlist.has(101), false);
  assert.equal(watchlist.size, 0);
});

test('remember and forget track what the server was told', () => {
  watchlist.claim('Alice');
  watchlist.fill([101]);

  // Idempotent, matching the endpoint it follows: a double tap on a phone
  // must not produce a second membership or a second count.
  watchlist.remember(102);
  watchlist.remember(102);
  assert.equal(watchlist.size, 2);
  assert.equal(watchlist.has(102), true);

  watchlist.forget(101);
  assert.equal(watchlist.has(101), false);
  // Forgetting something that was never there is not an error either.
  watchlist.forget(999);
  assert.equal(watchlist.size, 1);
});

test('the new list’s name is written in one place', () => {
  watchlist.claim('Alice');
  // The server enforces UNIQUE on lists.name, so two call sites disagreeing
  // by an apostrophe would be a 400 nobody could explain.
  assert.equal(watchlist.nameFor(), 'Alice’s watchlist');
  assert.equal(watchlist.nameFor('Bob'), 'Bob’s watchlist');
});

test('resetting a device clears the stored identity, not just the memory', () => {
  watchlist.claim('Alice');
  watchlist.adopt(LISTS);
  watchlist.fill([101]);

  watchlist.reset();

  assert.equal(watchlist.claimed, false);
  assert.equal(watchlist.listId, null);
  assert.equal(watchlist.size, 0);
  assert.equal(store.has('double-feature:owner'), false);
});

test('a localStorage that throws does not break the page', async () => {
  // Private-mode Safari throws on access rather than returning null. An
  // unclaimed device is a working device; it just gets asked again.
  const working = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('nope'); },
    setItem() { throw new Error('nope'); },
    removeItem() { throw new Error('nope'); },
  };

  try {
    assert.equal(watchlist.claim('Alice'), 'Alice');
    assert.equal(watchlist.owner, 'Alice', 'the identity holds for this session');
    watchlist.reset();
    assert.equal(watchlist.claimed, false);
  } finally {
    globalThis.localStorage = working;
  }
});
