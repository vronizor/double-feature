import test from 'node:test';
import assert from 'node:assert/strict';

import { poolState, emptyFilters } from '../public/pool-state.js';
import { applyVibe, clearVibe } from '../public/vibes.js';

// `pool-state.js` and `vibes.js` touch no DOM, so they import straight into
// node — no stub needed, unlike the view modules.

const familyVibe = () => ({
  id: 4,
  name: 'Family',
  filters: { genres: { include: [], exclude: [27] } },
  resolved_lists: [2, 4, 7, 8],
});

test('applying a preset does not alias its filter objects', () => {
  const vibe = familyVibe();
  applyVibe(vibe);
  assert.notEqual(
    poolState.filters.genres,
    vibe.filters.genres,
    'pool state must hold its own copy, not the caller’s object',
  );
});

test('editing a filter by hand never rewrites the preset it came from', () => {
  // The regression, in the order a host would actually hit it: pick Family,
  // click the Animation genre chip, wander off to another vibe, come back.
  // `/api/vibes` is fetched once per mount, so the corrupted object survives
  // every re-apply in between.
  const vibe = familyVibe();
  applyVibe(vibe);

  // Exactly what browse.js's chipToggleGroup does on a click.
  poolState.filters.genres.include.push(16);

  applyVibe({ id: 1, name: 'Cinephile', filters: {}, resolved_lists: [1, 3, 5] });
  applyVibe(vibe);

  assert.deepEqual(vibe.filters.genres, { include: [], exclude: [27] }, 'the cached vibe was mutated');
  assert.deepEqual(poolState.filters.genres, { include: [], exclude: [27] });
});

test('a preset carrying a range is not rewritten by typing in the range input', () => {
  const vibe = { id: 9, name: 'Seventies', filters: { year: { min: 1970, max: 1979 } }, resolved_lists: [1] };
  applyVibe(vibe);

  // Exactly what browse.js's rangeInputs does on a keystroke.
  poolState.filters.year.min = 1995;

  applyVibe(vibe);
  assert.equal(poolState.filters.year.min, 1970);
});

// --- Deselecting -----------------------------------------------------------
//
// Clicking an active chip now deselects it. That has to UNDO the vibe, not
// merely drop its label: the old ✕ next to the active chip looked like it
// meant "clear this selection" and actually deleted the vibe, and the fix is
// only a fix if the thing that replaces it does what the ✕ appeared to offer.

const allLists = [
  { id: 1, is_active: true },
  { id: 2, is_active: false },
  { id: 3, is_active: true },
];

test('deselecting returns the pool to the lists marked active by default', () => {
  applyVibe({ id: 4, name: 'Family', filters: {}, resolved_lists: [2, 7, 8] });
  clearVibe(allLists);

  assert.deepEqual(poolState.selectedLists(), [1, 3]);
  assert.equal(poolState.vibe, null, 'the chip row must read Custom afterwards');
});

test('deselecting clears the filters and the top-N the vibe brought with it', () => {
  applyVibe({
    id: 9,
    name: 'Seventies',
    filters: { year: { min: 1970, max: 1979 }, topN: 100 },
    resolved_lists: [1],
  });
  assert.equal(poolState.setup.topN, 100, 'guard: the vibe really did set a cut');

  clearVibe(allLists);

  assert.deepEqual(poolState.filters, emptyFilters(), 'a vibe’s filters must not outlive it');
  assert.equal(poolState.setup.topN, null);
});

test('deselecting twice lands in the same place as deselecting once', () => {
  // There is one "no vibe" state, not one per vibe you happened to leave from.
  applyVibe({ id: 4, name: 'Family', filters: { year: { min: 2000, max: null } }, resolved_lists: [2] });
  clearVibe(allLists);
  const once = structuredClone(poolState.setup);

  applyVibe({ id: 9, name: 'Seventies', filters: { runtime: { min: null, max: 100 } }, resolved_lists: [1, 2, 3] });
  clearVibe(allLists);

  assert.deepEqual(poolState.setup, once);
});

test('deselecting does not alias the caller’s list array', () => {
  // Same hazard applyVibe already guards: the setup must own its arrays, or a
  // later chip click edits the caller's data.
  clearVibe(allLists);
  poolState.setSelected(2, true);

  assert.deepEqual(
    allLists.filter((list) => list.is_active).map((list) => list.id),
    [1, 3],
    'the lists passed in were mutated',
  );
});

test('a preset still replaces pool setup wholesale rather than merging into it', () => {
  // The deep copy must not quietly turn "apply" into "merge" — a vibe
  // replacing the setup outright is the documented behaviour.
  applyVibe({ id: 1, name: 'A', filters: { year: { min: 1960, max: 1969 } }, resolved_lists: [1] });
  applyVibe({ id: 2, name: 'B', filters: {}, resolved_lists: [2] });

  assert.deepEqual(poolState.filters.year, emptyFilters().year, 'B carries no year, so no year should survive');
  assert.deepEqual(poolState.selectedLists(), [2]);
});
