import { Router } from 'express';

import { getDb } from '../db.js';
import { LIST_SHAPE_CTE, listMembershipsSql, parseMemberships } from '../movies.js';
import { searchMovie, scoreCandidate, searchPerson, getDirectorCredits } from '../tmdb.js';

const router = Router();

/** Which of your lists (if any) each of these TMDB ids already resolves on. */
function listsByTmdbId(db, tmdbIds) {
  if (tmdbIds.length === 0) return new Map();
  const placeholders = tmdbIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `WITH ${LIST_SHAPE_CTE}
       SELECT lm.tmdb_id, ${listMembershipsSql('lm.tmdb_id')} AS lists
       FROM list_movies lm
       WHERE lm.tmdb_id IN (${placeholders}) AND lm.status = 'resolved'
       GROUP BY lm.tmdb_id`,
    )
    .all(...tmdbIds);
  return new Map(rows.map((row) => [row.tmdb_id, parseMemberships(row.lists)]));
}

/**
 * Backs both the reconciliation search box and the Draw tab's "add a specific
 * film" search — the latter wants to know at a glance whether a result is
 * already part of one of the host's curated lists, or a totally ad-hoc pick.
 */
router.get('/search', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  if (!query) return res.json({ results: [] });

  const year = req.query.year ? Number(req.query.year) : null;
  const results = await searchMovie({ title: query, year });
  const lists = listsByTmdbId(getDb(), results.map((candidate) => candidate.id));

  res.json({
    results: results
      .map((candidate) => {
        const { score, candidateYear } = scoreCandidate({ title: query, year }, candidate);
        return {
          tmdb_id: candidate.id,
          title: candidate.title,
          year: candidateYear,
          poster_path: candidate.poster_path ?? null,
          overview: candidate.overview || null,
          lists: lists.get(candidate.id) ?? null,
          score,
        };
      })
      .sort((a, b) => b.score - a.score),
  });
});

/**
 * Person search, for director night's parameter picker.
 *
 * Returns nothing for a query shorter than two characters rather than asking
 * TMDB — a one-letter search is a keystroke on the way somewhere, not a
 * question, and answering it wastes a request per letter typed.
 */
router.get('/person', async (req, res) => {
  const query = String(req.query.q ?? '').trim();
  if (query.length < 2) return res.json({ results: [] });
  res.json({ results: await searchPerson(query) });
});

/**
 * A person's directed filmography, with a note of which are already cached.
 *
 * The cached count is what tells the caller how much of this night is free:
 * films the library already holds need no TMDB detail call to enter the pool.
 */
router.get('/person/:id/directed', async (req, res) => {
  const personId = Number(req.params.id);
  if (!Number.isInteger(personId) || personId <= 0) {
    return res.status(400).json({ error: 'A person id is required' });
  }

  const films = await getDirectorCredits(personId);
  const ids = films.map((film) => film.id);
  const cached = new Set();
  if (ids.length) {
    const rows = getDb()
      .prepare(`SELECT tmdb_id FROM movies WHERE tmdb_id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids);
    for (const row of rows) cached.add(row.tmdb_id);
  }

  res.json({
    films: films.map((film) => ({ ...film, cached: cached.has(film.id) })),
    total: films.length,
    cached_count: cached.size,
  });
});

export default router;
