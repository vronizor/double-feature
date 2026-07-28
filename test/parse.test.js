import test from 'node:test';
import assert from 'node:assert/strict';

import { parseImport, parseTextList, parseCsv, splitTitleYear } from '../server/parse.js';

test('splits a trailing year in the shapes people actually paste', () => {
  assert.deepEqual(splitTitleYear('Vertigo (1958)'), { title: 'Vertigo', year: 1958 });
  assert.deepEqual(splitTitleYear('Vertigo, 1958'), { title: 'Vertigo', year: 1958 });
  assert.deepEqual(splitTitleYear('Vertigo - 1958'), { title: 'Vertigo', year: 1958 });
  assert.deepEqual(splitTitleYear('Vertigo'), { title: 'Vertigo', year: null });
});

test('does not mistake a numeric title for a year', () => {
  assert.deepEqual(splitTitleYear('1917'), { title: '1917', year: null });
  assert.deepEqual(splitTitleYear('1917 (2019)'), { title: '1917', year: 2019 });
  assert.deepEqual(splitTitleYear('2001: A Space Odyssey'), {
    title: '2001: A Space Odyssey',
    year: null,
  });
});

test('parses a plain text list, skipping blanks and comments', () => {
  const entries = parseTextList('# my list\n\nVertigo (1958)\n  Tokyo Story\n\n');
  assert.deepEqual(entries, [
    { title: 'Vertigo', year: 1958 },
    { title: 'Tokyo Story', year: null },
  ]);
});

test('parses quoted CSV fields with embedded commas', () => {
  const rows = parseCsv('title,year\n"Jeanne Dielman, 23 quai du Commerce",1975\nVertigo,1958');
  assert.deepEqual(rows[1], ['Jeanne Dielman, 23 quai du Commerce', '1975']);
});

test('parses doubled quotes inside a CSV field', () => {
  const rows = parseCsv('title\n"He said ""hi"""');
  assert.deepEqual(rows[1], ['He said "hi"']);
});

test('import detects CSV with a header', () => {
  const entries = parseImport('title,year\nVertigo,1958\nTokyo Story,1953');
  assert.deepEqual(entries, [
    { title: 'Vertigo', year: 1958 },
    { title: 'Tokyo Story', year: 1953 },
  ]);
});

test('import handles a headerless two-column CSV', () => {
  const entries = parseImport('Vertigo,1958\nTokyo Story,1953');
  assert.deepEqual(entries, [
    { title: 'Vertigo', year: 1958 },
    { title: 'Tokyo Story', year: 1953 },
  ]);
});

test('import handles JSON arrays of objects and of strings', () => {
  assert.deepEqual(parseImport('[{"title":"Vertigo","year":1958}]'), [
    { title: 'Vertigo', year: 1958, tmdb_id: null },
  ]);
  assert.deepEqual(parseImport('["Vertigo (1958)"]'), [{ title: 'Vertigo', year: 1958 }]);
});

test('import keeps an explicit tmdb_id so pre-resolved lists skip search', () => {
  const [entry] = parseImport('[{"title":"Vertigo","year":1958,"tmdb_id":426}]');
  assert.equal(entry.tmdb_id, 426);
});

test('import falls back to text when JSON is malformed', () => {
  // A stray bracket shouldn't lose the whole paste.
  const entries = parseImport('[not really json\nVertigo (1958)');
  assert.ok(entries.some((entry) => entry.title === 'Vertigo'));
});

test('a single-column paste with no commas stays a text list', () => {
  const entries = parseImport('Vertigo\nTokyo Story');
  assert.deepEqual(entries, [
    { title: 'Vertigo', year: null },
    { title: 'Tokyo Story', year: null },
  ]);
});

test('empty input yields no entries rather than throwing', () => {
  assert.deepEqual(parseImport(''), []);
  assert.deepEqual(parseImport('   \n  '), []);
});
