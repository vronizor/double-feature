/**
 * `matchDiffers` decides whether the reconciliation screen shows a resolved
 * row's raw source text beside the film it matched.
 *
 * It carries more weight than its size: the screen otherwise shows only the
 * answer, so a row that matched the wrong film is indistinguishable from one
 * that matched the right one. This is the only thing that puts the question
 * in front of a human.
 *
 * No DOM needed — the decision is pure, which is why it lives in dom.js rather
 * than inside the view's closure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { matchDiffers } = await import('../public/dom.js');

test('an exact agreement is not worth showing', () => {
  assert.equal(
    matchDiffers({ raw_title: 'Vertigo', raw_year: 1958, title: 'Vertigo', year: 1958 }),
    false,
  );
});

test('the original title counts as agreement, not as a mismatch', () => {
  // A list writing a film under its own name is the same film, not an error.
  assert.equal(
    matchDiffers({
      raw_title: 'Shichinin no samurai',
      raw_year: 1954,
      title: 'Seven Samurai',
      original_title: 'Shichinin no samurai',
      year: 1954,
    }),
    false,
  );
});

test('a different title is shown', () => {
  assert.equal(
    matchDiffers({
      raw_title: 'Tierra de Nadie',
      raw_year: 2024,
      title: 'Barren Land',
      original_title: 'Tierra de nadie',
      year: 2024,
    }),
    true,
    'case differs, so this is not the same string and is worth a glance',
  );
});

test('the same title in a different year is shown — the case least likely to look wrong', () => {
  assert.equal(
    matchDiffers({ raw_title: 'Psycho', raw_year: 1960, title: 'Psycho', year: 1998 }),
    true,
  );
});

test('a missing year on either side is not treated as disagreement', () => {
  // Absent is not "different". Plenty of lists give no year at all, and
  // flagging every one of those rows would drown the signal.
  assert.equal(matchDiffers({ raw_title: 'Psycho', raw_year: null, title: 'Psycho', year: 1960 }), false);
  assert.equal(matchDiffers({ raw_title: 'Psycho', raw_year: 1960, title: 'Psycho', year: null }), false);
});

test('an entry with no raw title at all is never flagged', () => {
  assert.equal(matchDiffers({}), false);
  assert.equal(matchDiffers(null), false);
});
