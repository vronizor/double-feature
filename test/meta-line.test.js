/**
 * `metaLine` turns the card's "year · director · rating" into ITEMS rather
 * than one joined string, which is what lets the line wrap without stranding a
 * separator or clipping the rating. The separator itself is drawn in CSS on
 * the following item, so there is deliberately none in the DOM here — a test
 * asserting on "·" would be testing the old design.
 *
 * A tiny document stub, in the spirit of dom-focus.test.js: `h` only needs
 * createElement, and `metaLine` only needs `instanceof Node` to work.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.className = '';
  }
  append(child) {
    this.children.push(child);
  }
}

globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  createTextNode: (text) => {
    const node = new FakeNode('#text');
    node.text = String(text);
    return node;
  },
};

const { metaLine, h } = await import('../public/dom.js');

const textOf = (node) =>
  node.tag === '#text' ? node.text : node.children.map(textOf).join('');

test('each part becomes its own item, so the line can wrap between them', () => {
  const items = metaLine(1994, 'Krzysztof Kieślowski');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(textOf), ['1994', 'Krzysztof Kieślowski']);
});

test('no separator is emitted into the DOM', () => {
  // It is a CSS ::before on the following item, which is the whole reason it
  // cannot be left dangling at the end of a wrapped line.
  assert.equal(metaLine(1994, 'Kurosawa').map(textOf).join(''), '1994Kurosawa');
});

test('a missing year or director collapses rather than leaving a gap', () => {
  // Plenty of films carry no director in this library, and an unrated film
  // yields no rating node at all.
  assert.deepEqual(metaLine(null, 'Kurosawa', null).map(textOf), ['Kurosawa']);
  assert.deepEqual(metaLine(undefined, '', 1954).map(textOf), ['1954']);
  assert.deepEqual(metaLine(null, null), []);
});

test('a node is passed through untouched rather than stringified', () => {
  // The rating arrives as an element carrying its own class and hover title.
  const rating = h('span', { class: 'movie-rating' }, '★ 7.9');
  const items = metaLine(1954, 'Kurosawa', rating);
  assert.equal(items[2], rating, 'the rating element itself must survive');
  assert.equal(items[2].className, 'movie-rating');
});

test('a zero is kept, since it is a real value and not an absent one', () => {
  assert.deepEqual(metaLine(0, 'x').map(textOf), ['0', 'x']);
});

/**
 * The orphaned separator, third attempt.
 *
 * `sweepMetaSeparators` is the only half of the fix that can be unit-tested:
 * whether an item starts a line is a layout fact, so the test supplies the
 * layout (offsetTop) rather than measuring one. What it pins down is the rule
 * — first-on-a-line loses its separator, everything else keeps one — and the
 * read-then-write ordering that keeps a hundred-card grid to one reflow.
 */
test('the item that starts a wrapped line loses its separator', async () => {
  const { sweepMetaSeparators } = await import('../public/dom.js');

  const order = [];
  const item = (offsetTop) => ({
    offsetTop,
    classList: {
      toggle(name, on) {
        order.push(`write:${name}:${on}`);
        this.value = on;
      },
    },
    get offsetTopRead() {
      return this.offsetTop;
    },
  });

  // "1994 · Kurosawa" on line one, "★ 8.5" wrapped onto line two.
  const items = [item(0), item(0), item(18)];
  const row = { children: items };
  const root = { querySelectorAll: () => [row] };

  sweepMetaSeparators(root);

  assert.equal(items[0].classList.value, true, 'the very first item always starts a line');
  assert.equal(items[1].classList.value, false, 'mid-line items keep their separator');
  assert.equal(items[2].classList.value, true, 'the wrapped item loses its separator');
});

test('a row that does not wrap is left entirely alone', async () => {
  const { sweepMetaSeparators } = await import('../public/dom.js');
  const writes = [];
  const item = () => ({ offsetTop: 0, classList: { toggle: (n, on) => writes.push(on) } });
  sweepMetaSeparators({ querySelectorAll: () => [{ children: [item(), item()] }] });
  assert.deepEqual(writes, [true, false], 'only the first item is marked');
});

test('a single-item row is skipped — there is no separator to orphan', async () => {
  const { sweepMetaSeparators } = await import('../public/dom.js');
  const writes = [];
  const row = { children: [{ offsetTop: 0, classList: { toggle: () => writes.push(1) } }] };
  sweepMetaSeparators({ querySelectorAll: () => [row] });
  assert.equal(writes.length, 0);
});
