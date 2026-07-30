import test from 'node:test';
import assert from 'node:assert/strict';

// A fake DOM small enough to be obvious. `preserveFocus` only touches
// document.activeElement, root.contains, root.querySelector, focus() and
// setSelectionRange, so that is all this provides.
function fakeDom() {
  const nodes = new Map();
  const root = {
    contains: (node) => [...nodes.values()].includes(node),
    querySelector: (selector) => nodes.get(selector.replace(/^#/, '')) ?? null,
  };
  const make = (id, type) => {
    const node = {
      id,
      type,
      focused: false,
      selectionStart: 0,
      selectionEnd: 0,
      focus() {
        this.focused = true;
        globalThis.document.activeElement = this;
      },
      setSelectionRange(start, end) {
        if (!['text', 'search', 'url', 'tel', 'password'].includes(this.type)) {
          // Real browsers throw InvalidStateError here; the helper must not call it.
          throw new Error(`InvalidStateError: type "${this.type}" has no selection`);
        }
        this.selectionStart = start;
        this.selectionEnd = end;
      },
    };
    nodes.set(id, node);
    return node;
  };
  // Replacing a node is what a repaint does: same id, brand new object.
  const replace = (id, type) => make(id, type);
  return { root, make, replace };
}

const withDom = (fn) => {
  const savedDocument = globalThis.document;
  const savedCss = globalThis.CSS;
  globalThis.document = { activeElement: null };
  globalThis.CSS = { escape: (value) => value };
  try {
    return fn();
  } finally {
    globalThis.document = savedDocument;
    globalThis.CSS = savedCss;
  }
};

const { preserveFocus } = await import('../public/dom.js');

test('focus and caret survive a repaint of a text input', () =>
  withDom(() => {
    const dom = fakeDom();
    const search = dom.make('explore-search', 'search');
    search.selectionStart = 3;
    search.selectionEnd = 3;
    globalThis.document.activeElement = search;

    const restore = preserveFocus(dom.root);
    const repainted = dom.replace('explore-search', 'search'); // the repaint
    restore();

    assert.equal(repainted.focused, true);
    assert.equal(repainted.selectionStart, 3);
  }));

test('a number input regains focus without setSelectionRange throwing', () =>
  withDom(() => {
    // The regression this is really about: all five filter inputs are
    // type="number", and setSelectionRange throws InvalidStateError on those.
    // Restoring focus must not reach for a caret it cannot have.
    const dom = fakeDom();
    const yearMin = dom.make('filter-year-min', 'number');
    globalThis.document.activeElement = yearMin;

    const restore = preserveFocus(dom.root);
    const repainted = dom.replace('filter-year-min', 'number');

    assert.doesNotThrow(restore);
    assert.equal(repainted.focused, true);
  }));

test('an element with no id cannot be restored, and that is not an error', () =>
  withDom(() => {
    const dom = fakeDom();
    globalThis.document.activeElement = { id: '', type: 'text' };
    assert.doesNotThrow(preserveFocus(dom.root));
  }));

test('nothing focused is a no-op', () =>
  withDom(() => {
    const dom = fakeDom();
    globalThis.document.activeElement = null;
    assert.doesNotThrow(preserveFocus(dom.root));
  }));

test('a focused element outside the repainted root is left alone', () =>
  withDom(() => {
    // Otherwise a repaint of one panel would steal focus from another.
    const dom = fakeDom();
    globalThis.document.activeElement = { id: 'somewhere-else', type: 'text', focus() { this.focused = true; } };
    preserveFocus(dom.root)();
    assert.notEqual(globalThis.document.activeElement.focused, true);
  }));

// --- watch links -----------------------------------------------------------

const { watchUrl, tmdbUrl } = await import('../public/dom.js');

test('the watch link is derived from the id we already store', () => {
  assert.equal(watchUrl(346), 'https://www.themoviedb.org/movie/346/watch');
});

test('a TV-sourced entry links to its /tv/ watch page', () => {
  // TV entries are keyed by the NEGATION of their real TMDB id (see the schema
  // comment on `movies`), so both the sign and the path have to be handled.
  assert.equal(watchUrl(-900, 'tv'), 'https://www.themoviedb.org/tv/900/watch');
});

test('the watch link is exactly the TMDB page plus /watch', () => {
  // Keeping it derived from tmdbUrl means the id-negation and media-type rules
  // live in one place rather than two that can drift apart.
  for (const [id, type] of [[346, 'movie'], [-900, 'tv'], [550, undefined]]) {
    assert.equal(watchUrl(id, type), `${tmdbUrl(id, type)}/watch`);
  }
});
