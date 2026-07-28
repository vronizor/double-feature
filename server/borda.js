/**
 * Borda count for a vote session.
 *
 * For N movies: rank 1 scores N-1 points, rank 2 scores N-2, ..., rank N scores 0.
 * Movies a voter left unranked also score 0 — the spec assumes full rankings, but
 * a guest who ranks only 2 of 5 films is otherwise unrepresentable, and dropping
 * their ballot entirely would be worse than counting the preferences they gave.
 *
 * Tie-break, in order:
 *   1. highest points
 *   2. most 1st-place votes
 *   3. random pick among those still tied — reported as a coin flip, never silent
 */
export function tallyBallots({ tmdbIds, ballots, random = Math.random }) {
  const n = tmdbIds.length;
  const points = new Map(tmdbIds.map((id) => [id, 0]));
  const firstPlaceVotes = new Map(tmdbIds.map((id) => [id, 0]));

  for (const ballot of ballots) {
    for (const { tmdb_id: tmdbId, rank } of ballot.ranks) {
      // Ignore ids that aren't part of this session rather than trusting input.
      if (!points.has(tmdbId)) continue;
      if (!Number.isInteger(rank) || rank < 1 || rank > n) continue;
      points.set(tmdbId, points.get(tmdbId) + (n - rank));
      if (rank === 1) firstPlaceVotes.set(tmdbId, firstPlaceVotes.get(tmdbId) + 1);
    }
  }

  const standings = tmdbIds
    .map((tmdbId) => ({
      tmdb_id: tmdbId,
      points: points.get(tmdbId),
      first_place_votes: firstPlaceVotes.get(tmdbId),
    }))
    .sort(
      (a, b) => b.points - a.points || b.first_place_votes - a.first_place_votes,
    );

  const result = { standings, ballot_count: ballots.length, winner: null, tiebreak: null };
  if (standings.length === 0 || ballots.length === 0) return result;

  const topPoints = standings[0].points;
  let contenders = standings.filter((row) => row.points === topPoints);

  if (contenders.length > 1) {
    const topFirsts = Math.max(...contenders.map((row) => row.first_place_votes));
    const byFirsts = contenders.filter((row) => row.first_place_votes === topFirsts);

    if (byFirsts.length === 1) {
      result.tiebreak = {
        method: 'first_place_votes',
        among: contenders.map((row) => row.tmdb_id),
      };
      contenders = byFirsts;
    } else {
      result.tiebreak = {
        method: 'coin_flip',
        among: byFirsts.map((row) => row.tmdb_id),
      };
      contenders = [byFirsts[Math.floor(random() * byFirsts.length)]];
    }
  }

  result.winner = contenders[0].tmdb_id;

  // Float the coin-flip winner to the top so the standings agree with the
  // announced result instead of quietly contradicting it.
  const winnerIndex = standings.findIndex((row) => row.tmdb_id === result.winner);
  if (winnerIndex > 0) {
    standings.unshift(...standings.splice(winnerIndex, 1));
  }

  return result;
}

/** Human-readable note for the results screen; null when nothing was tied. */
export function describeTiebreak(tiebreak, titleFor) {
  if (!tiebreak) return null;
  const titles = tiebreak.among.map(titleFor).join(', ');
  return tiebreak.method === 'first_place_votes'
    ? `Tied on points (${titles}) — broken by most 1st-place votes.`
    : `Tied on points and 1st-place votes (${titles}) — winner picked at random, a coin flip.`;
}
