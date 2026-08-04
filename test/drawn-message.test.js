/**
 * `drawnMessage` says what a draw put on the table.
 *
 * The draw was the app's one moment of theatre and it happened in silence:
 * the lineup grew below the fold and nothing announced it. The message names
 * films rather than counting them — the count is already on screen, the
 * titles are what the host clicked for — and stops naming them at the point
 * a list stops being readable in a glance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { drawnMessage } = await import('../public/dom.js');

const films = (...titles) => titles.map((title) => ({ title }));

test('nothing drawn says nothing', () => {
  assert.equal(drawnMessage([]), null);
  assert.equal(drawnMessage(undefined), null);
});

test('one film is named', () => {
  assert.equal(drawnMessage(films('Ran')), 'Drew Ran');
});

test('the default draw of two reads as a sentence', () => {
  assert.equal(drawnMessage(films('Ran', 'A Separation')), 'Drew Ran and A Separation');
});

test('three are still all named', () => {
  assert.equal(
    drawnMessage(films('Ran', 'A Separation', 'Le Trou')),
    'Drew Ran, A Separation and Le Trou',
  );
});

test('beyond three it becomes a count, not a list', () => {
  assert.equal(
    drawnMessage(films('Ran', 'A Separation', 'Le Trou', ' 8½', 'Sansho')),
    'Drew Ran, A Separation and 3 more',
  );
});

// A draw returns whatever the API returned. A row with no title would
// otherwise put "Drew undefined" in front of the host.
test('a film with no title is skipped rather than printed as undefined', () => {
  assert.equal(drawnMessage([{ title: 'Ran' }, { title: '' }, {}]), 'Drew Ran');
});
