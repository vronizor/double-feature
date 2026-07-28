/**
 * Tap-to-rank state, kept as an ordered array of TMDB ids.
 *
 * Representing the ranking as an array is what makes the spec's auto-renumber
 * fall out for free: removing an entry closes the gap, because a movie's rank
 * is just its index + 1. Shared by the guest screen and the tests.
 */

export function toggleRank(ranked, tmdbId) {
  return ranked.includes(tmdbId)
    ? ranked.filter((id) => id !== tmdbId)
    : [...ranked, tmdbId];
}

export function rankOf(ranked, tmdbId) {
  const index = ranked.indexOf(tmdbId);
  return index === -1 ? null : index + 1;
}

export const clearRanks = () => [];

/** Submission payload: ordered ids, which the server renumbers from 1 anyway. */
export const toBallot = (ranked) => ranked.map((tmdbId, index) => ({ tmdb_id: tmdbId, rank: index + 1 }));
