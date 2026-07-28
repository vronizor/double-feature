import test from 'node:test';
import assert from 'node:assert/strict';

import { OCCASIONS, availableOccasions } from '../public/occasions.js';

// occasions.js is frontend code but deliberately DOM-free — it's pure data
// plus resolve functions — so it can be unit-tested here directly.

const LISTS = [
  { id: 1, name: 'TSPDT', category: 'canon' },
  { id: 2, name: 'Sight & Sound', category: 'canon' },
  { id: 3, name: 'BFI by 15', category: 'family' },
  { id: 4, name: 'Family Films', category: 'family' },
  { id: 5, name: 'Criterion', category: 'collection' },
  { id: 6, name: 'Uncategorised one', category: null },
];

const FACETS = {
  genres: [
    { id: 18, name: 'Drama' },
    { id: 27, name: 'Horror' },
  ],
};

const byId = (list, id) => list.find((entry) => entry.occasion.id === id);

test('an occasion resolves to the lists in its category', () => {
  const available = availableOccasions({ lists: LISTS, facets: FACETS });
  assert.deepEqual(byId(available, 'cinephile').filters.lists, [1, 2]);
  assert.deepEqual(byId(available, 'family').filters.lists, [3, 4]);
});

test('occasions with no lists yet are hidden rather than shown broken', () => {
  // Awards and crowd-pleasers have no lists until roadmap 4.2/4.3 land. They
  // must not render as chips that produce an empty pool when clicked — and
  // must start appearing on their own once such lists exist, with no code
  // change in occasions.js.
  const available = availableOccasions({ lists: LISTS, facets: FACETS });
  const shown = available.map((entry) => entry.occasion.id);
  assert.ok(!shown.includes('awards'));
  assert.ok(!shown.includes('crowd'));

  const withAwards = availableOccasions({
    lists: [...LISTS, { id: 7, name: 'Oscar Best Picture', category: 'awards' }],
    facets: FACETS,
  });
  assert.deepEqual(byId(withAwards, 'awards').filters.lists, [7]);
});

test('Family carries a filter, not just a list selection', () => {
  // This is what makes it an occasion rather than a bare category shortcut.
  const family = byId(availableOccasions({ lists: LISTS, facets: FACETS }), 'family');
  assert.deepEqual(family.filters.genres.exclude, [27], 'horror excluded');
});

test('the horror id is looked up by name, never hardcoded', () => {
  // Same library, but the genre carries a different id — the exclusion must
  // follow the name, so a filter that silently stops working isn't riding on
  // a magic number.
  const moved = { genres: [{ id: 999, name: 'Horror' }] };
  const family = byId(availableOccasions({ lists: LISTS, facets: moved }), 'family');
  assert.deepEqual(family.filters.genres.exclude, [999]);
});

test('a missing Horror genre degrades to no exclusion instead of throwing', () => {
  const family = byId(availableOccasions({ lists: LISTS, facets: { genres: [] } }), 'family');
  assert.deepEqual(family.filters.genres.exclude, []);
});

test('every occasion resolves without a facets payload at all', () => {
  // The chip row can render before /pool/facets has come back.
  for (const occasion of OCCASIONS) {
    assert.doesNotThrow(
      () => occasion.resolve({ lists: LISTS, facets: undefined }),
      `${occasion.id} threw on missing facets`,
    );
  }
});

test('an empty library produces no occasions rather than an empty chip row', () => {
  assert.deepEqual(availableOccasions({ lists: [], facets: FACETS }), []);
});
