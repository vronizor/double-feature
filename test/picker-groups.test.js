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
