import test from 'node:test';
import assert from 'node:assert/strict';

// browse.js imports dom.js, which touches document at module scope only through
// helpers — but api.js reads location, so stub the pair before importing.
globalThis.document = { createElement: () => ({ style: {}, setAttribute() {}, append() {}, addEventListener() {}, classList: { add() {} } }), getElementById: () => null, addEventListener() {} };
globalThis.window = { addEventListener() {}, location: { hash: '', pathname: '/' } };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { hash: '', pathname: '/' };

const { isGroupOpen, setGroupOpen } = await import('../public/browse.js');

test('a group with a selection defaults to open, one without defaults to closed', () => {
  const open = new Set();
  assert.equal(isGroupOpen(open, 'awards', true), true);
  assert.equal(isGroupOpen(open, 'canon', false), false);
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
