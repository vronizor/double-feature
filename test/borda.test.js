import test from 'node:test';
import assert from 'node:assert/strict';

import { tallyBallots, describeTiebreak } from '../server/borda.js';

const ballot = (...orderedIds) => ({
  ranks: orderedIds.map((tmdb_id, index) => ({ tmdb_id, rank: index + 1 })),
});

test('scores N-1 down to 0 for a full ranking', () => {
  const result = tallyBallots({ tmdbIds: [1, 2, 3], ballots: [ballot(1, 2, 3)] });

  assert.deepEqual(
    result.standings.map((row) => [row.tmdb_id, row.points]),
    [[1, 2], [2, 1], [3, 0]],
  );
  assert.equal(result.winner, 1);
  assert.equal(result.tiebreak, null);
});

test('sums points across ballots', () => {
  const result = tallyBallots({
    tmdbIds: [1, 2, 3],
    ballots: [ballot(1, 2, 3), ballot(2, 1, 3)],
  });

  assert.equal(result.standings.find((r) => r.tmdb_id === 1).points, 3);
  assert.equal(result.standings.find((r) => r.tmdb_id === 2).points, 3);
  assert.equal(result.standings.find((r) => r.tmdb_id === 3).points, 0);
});

test('a partial ballot scores unranked films 0 rather than being discarded', () => {
  const result = tallyBallots({ tmdbIds: [1, 2, 3, 4, 5], ballots: [ballot(3, 1)] });

  assert.equal(result.standings.find((r) => r.tmdb_id === 3).points, 4);
  assert.equal(result.standings.find((r) => r.tmdb_id === 1).points, 3);
  for (const id of [2, 4, 5]) {
    assert.equal(result.standings.find((r) => r.tmdb_id === id).points, 0);
  }
  assert.equal(result.ballot_count, 1);
});

test('ties on points are broken by 1st-place votes', () => {
  // Both finish on 5 points; 1 was ranked first twice, 2 only once.
  const result = tallyBallots({
    tmdbIds: [1, 2, 3],
    ballots: [ballot(1, 2, 3), ballot(1, 2, 3), ballot(2, 1, 3), ballot(3, 2, 1)],
  });

  const one = result.standings.find((r) => r.tmdb_id === 1);
  const two = result.standings.find((r) => r.tmdb_id === 2);
  assert.equal(one.points, two.points, 'precondition: points are tied');
  assert.ok(one.first_place_votes > two.first_place_votes);
  assert.equal(result.winner, 1);
  assert.equal(result.tiebreak.method, 'first_place_votes');
});

test('a full tie falls back to a coin flip and says so', () => {
  const options = { tmdbIds: [1, 2], ballots: [ballot(1, 2), ballot(2, 1)] };

  const first = tallyBallots({ ...options, random: () => 0 });
  const second = tallyBallots({ ...options, random: () => 0.99 });

  assert.equal(first.tiebreak.method, 'coin_flip');
  assert.deepEqual(first.tiebreak.among.sort(), [1, 2]);
  assert.equal(first.winner, 1);
  assert.equal(second.winner, 2, 'the injected random actually decides the winner');
});

test('the coin-flip winner is floated to the top of the standings', () => {
  const result = tallyBallots({
    tmdbIds: [1, 2],
    ballots: [ballot(1, 2), ballot(2, 1)],
    random: () => 0.99,
  });

  assert.equal(result.winner, 2);
  assert.equal(result.standings[0].tmdb_id, 2, 'standings must not contradict the announced winner');
});

test('no ballots means no winner', () => {
  const result = tallyBallots({ tmdbIds: [1, 2], ballots: [] });
  assert.equal(result.winner, null);
  assert.equal(result.ballot_count, 0);
});

test('ranks for films outside the session are ignored', () => {
  const result = tallyBallots({
    tmdbIds: [1, 2],
    ballots: [{ ranks: [{ tmdb_id: 99, rank: 1 }, { tmdb_id: 1, rank: 2 }] }],
  });

  assert.equal(result.standings.find((r) => r.tmdb_id === 1).points, 0);
  assert.ok(!result.standings.some((r) => r.tmdb_id === 99));
});

test('out-of-range ranks are ignored rather than scoring negative', () => {
  const result = tallyBallots({
    tmdbIds: [1, 2],
    ballots: [{ ranks: [{ tmdb_id: 1, rank: 0 }, { tmdb_id: 2, rank: 7 }] }],
  });

  assert.ok(result.standings.every((row) => row.points === 0));
});

test('describeTiebreak names the films and the method', () => {
  const titles = { 1: 'Vertigo', 2: 'Tokyo Story' };
  const titleFor = (id) => titles[id];

  assert.equal(describeTiebreak(null, titleFor), null);
  assert.match(
    describeTiebreak({ method: 'coin_flip', among: [1, 2] }, titleFor),
    /coin flip/i,
  );
  assert.match(
    describeTiebreak({ method: 'first_place_votes', among: [1, 2] }, titleFor),
    /1st-place votes/i,
  );
});
