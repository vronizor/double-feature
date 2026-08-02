/**
 * `topNLabel` says what a Top-N cut DID, which the number alone cannot.
 *
 * One control, one meaning — the top N of each ranked group — but the group is
 * whatever a list ranks within. N=10 is ten films from TSPDT and roughly eight
 * hundred from Box-office France. The label carries the group so the host is
 * not left guessing why their pool is two orders of magnitude bigger than the
 * number they typed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { topNLabel } = await import('../public/dom.js');

test('no cut, no label', () => {
  assert.equal(topNLabel(null, { ranked: 2, perYear: 1 }), null);
  assert.equal(topNLabel(0, { ranked: 2, perYear: 1 }), null);
});

test('lists ranked end to end read as a plain top N', () => {
  assert.equal(topNLabel(10, { ranked: 3, perYear: 0 }), 'top 10');
});

test('lists ranked within a year say so', () => {
  assert.equal(topNLabel(5, { ranked: 3, perYear: 3 }), 'top 5 per year');
});

test('a mixed selection admits it rather than picking one story', () => {
  assert.equal(topNLabel(5, { ranked: 3, perYear: 1 }), 'top 5, per year on some lists');
});

test('a cut over no ranked lists says it did nothing', () => {
  // Criterion and Ghibli carry no ranks, so a Top-N over them narrows nothing.
  // "top 5" would describe a narrowing that did not happen.
  assert.equal(topNLabel(5, { ranked: 0, perYear: 0 }), 'top 5 (no ranked lists)');
});
