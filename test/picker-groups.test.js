import test from 'node:test';
import assert from 'node:assert/strict';

// browse.js imports dom.js, which touches document at module scope only through
// helpers — but api.js reads location, so stub the pair before importing.
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {} } }), getElementById: () => null, addEventListener() {} };
globalThis.window = { addEventListener() {}, location: { hash: '', pathname: '/' } };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { hash: '', pathname: '/' };

const { isGroupOpen, setGroupOpen, isPartiallySelected } = await import('../public/browse.js');
const { poolState } = await import('../public/pool-state.js');

test('a PART-selected group defaults to open; a uniform one defaults to closed', () => {
  const open = new Set();
  assert.equal(isGroupOpen(open, 'awards', true), true);
  assert.equal(isGroupOpen(open, 'canon', false), false);
});

/**
 * The default used to be "any selection at all", and the intent was right —
 * do not hide lists you are drawing from. But this app's default state is all
 * twenty lists selected, so every group qualified, all eight opened at once,
 * and a rule meant to say "look here" pointed at nothing.
 *
 * All-on and all-off are both uniform and the group header already says which
 * one you are in. Part-selected is the only state you cannot read off the
 * header, so it is the only one that opens itself.
 */
test('all-selected is NOT partial — which is what stopped every group opening', () => {
  const lists = [{ id: 1 }, { id: 2 }, { id: 3 }];
  poolState.setMany([1, 2, 3], true);
  assert.equal(isPartiallySelected(lists), false, 'all on is uniform');

  poolState.setMany([1, 2, 3], false);
  assert.equal(isPartiallySelected(lists), false, 'all off is uniform');

  poolState.setMany([2], true);
  assert.equal(isPartiallySelected(lists), true, 'some on is the informative case');
});

test('collapsing a group that has a selection actually sticks', () => {
  // The reason two markers exist. With only a "force open" marker, a group
  // holding a selection defaults back to open on the very next repaint, so
  // clicking to collapse it would appear to do nothing.
  const open = new Set();
  setGroupOpen(open, 'awards', false);
  assert.equal(isGroupOpen(open, 'awards', true), false);
});

test('the two markers can never disagree', () => {
  const open = new Set();
  setGroupOpen(open, 'awards', true);
  setGroupOpen(open, 'awards', false);
  assert.ok(!open.has('awards'), 'the force-open marker must be cleared');
  assert.ok(open.has('!awards'));
  assert.equal(isGroupOpen(open, 'awards', true), false);
});

test('collapse-all survives groups that hold selections', () => {
  // The bug this guards: "Collapse all" that only deletes the open markers
  // leaves any group with a selection open, so the button visibly does nothing
  // for exactly the groups the host is using.
  const open = new Set();
  const groups = [
    { key: 'awards', selected: true },
    { key: 'canon', selected: false },
    { key: 'family', selected: true },
  ];

  for (const g of groups) setGroupOpen(open, g.key, false);
  for (const g of groups) {
    assert.equal(isGroupOpen(open, g.key, g.selected), false, `${g.key} should be collapsed`);
  }

  for (const g of groups) setGroupOpen(open, g.key, true);
  for (const g of groups) {
    assert.equal(isGroupOpen(open, g.key, g.selected), true, `${g.key} should be expanded`);
  }
});

test('expanding is independent of selecting', () => {
  // Opening a group to look at it must not change what is drawn from. These
  // helpers touch only the open set, never poolState — asserted by the fact
  // that hasSelection is a parameter here rather than something they read.
  const open = new Set();
  setGroupOpen(open, 'awards', true);
  assert.deepEqual([...open], ['awards'], 'nothing but the open marker was written');
});

/**
 * Watchlists get a group of their own, derived from `owner IS NOT NULL`.
 *
 * Not from a tag, and the tests below are the reason: tags are host-editable,
 * so a tag could be removed from a watchlist or applied to something that is
 * not one, and the group would then disagree with the thing it names. The
 * owner column cannot drift.
 */
const { groupListsByTag } = await import('../public/browse.js');
const { watchlist } = await import('../public/watchlist.js');

const VOCAB = [
  { tag: 'canon', label: 'The canon' },
  { tag: 'awards', label: 'Awards' },
];

const LIBRARY = [
  { id: 1, name: 'Criterion', owner: null, tags: ['canon'] },
  { id: 2, name: 'Oscar — Best Picture', owner: null, tags: ['awards'] },
  { id: 3, name: 'A custom list', owner: null, tags: [] },
  { id: 7, name: 'Zoe’s watchlist', owner: 'Zoe', tags: [] },
  { id: 8, name: 'Alice’s watchlist', owner: 'Alice', tags: [] },
];

test('watchlists form their own group, and it leads', () => {
  watchlist.reset();
  const groups = groupListsByTag(LIBRARY, VOCAB);

  assert.equal(groups[0].key, '__watchlists');
  assert.equal(groups[0].label, 'Watchlists');
  assert.deepEqual(groups[0].lists.map((l) => l.id), [8, 7], 'alphabetical with no device owner');
});

test('this device’s own watchlist sorts to the top of that group', () => {
  watchlist.reset();
  watchlist.claim('Zoe');
  const groups = groupListsByTag(LIBRARY, VOCAB);

  // Yours is the one you came to tick. Alphabetically Zoe is last, so this
  // fails if the sort is not owner-aware.
  assert.deepEqual(groups[0].lists.map((l) => l.id), [7, 8]);
  watchlist.reset();
});

test('a watchlist does NOT also fall into Untagged', () => {
  watchlist.reset();
  const groups = groupListsByTag(LIBRARY, VOCAB);
  const untagged = groups.find((g) => g.label === 'Untagged');

  // It carries no tags, so without excluding owned lists from the tag pass it
  // would render twice — once in its own group and once as an untagged
  // stray, and ticking it in one place would tick it in both.
  assert.deepEqual(untagged.lists.map((l) => l.id), [3]);
});

test('a watchlist someone tagged still renders only once', () => {
  watchlist.reset();
  const tagged = LIBRARY.map((l) => (l.id === 8 ? { ...l, tags: ['canon'] } : l));
  const groups = groupListsByTag(tagged, VOCAB);

  assert.deepEqual(groups.find((g) => g.key === 'canon').lists.map((l) => l.id), [1]);
  assert.ok(groups[0].lists.some((l) => l.id === 8));
});

test('with no watchlists at all, nothing changes', () => {
  watchlist.reset();
  const groups = groupListsByTag(LIBRARY.filter((l) => !l.owner), VOCAB);

  assert.ok(!groups.some((g) => g.key === '__watchlists'), 'no empty group');
  assert.deepEqual(groups.map((g) => g.label), ['The canon', 'Awards', 'Untagged']);
});
