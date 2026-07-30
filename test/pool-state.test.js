import test from 'node:test';
import assert from 'node:assert/strict';

import { poolState, emptyFilters } from '../public/pool-state.js';
import { applyVibe } from '../public/vibes.js';

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

test('a preset still replaces pool setup wholesale rather than merging into it', () => {
  // The deep copy must not quietly turn "apply" into "merge" — a vibe
  // replacing the setup outright is the documented behaviour.
  applyVibe({ id: 1, name: 'A', filters: { year: { min: 1960, max: 1969 } }, resolved_lists: [1] });
  applyVibe({ id: 2, name: 'B', filters: {}, resolved_lists: [2] });

  assert.deepEqual(poolState.filters.year, emptyFilters().year, 'B carries no year, so no year should survive');
  assert.deepEqual(poolState.selectedLists(), [2]);
});
