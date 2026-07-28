import { Router } from 'express';

import { getDb } from '../db.js';
import { searchMovie, scoreCandidate } from '../tmdb.js';

const router = Router();

/** Which of your lists (if any) each of these TMDB ids already resolves on. */
function listsByTmdbId(db, tmdbIds) {
  if (tmdbIds.length === 0) return new Map();
  const placeholders = tmdbIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT lm.tmdb_id, (
         SELECT group_concat(name, ', ') FROM (
           SELECT l.name FROM list_movies lm2 JOIN lists l ON l.id = lm2.list_id
           WHERE lm2.tmdb_id = lm.tmdb_id AND lm2.status = 'resolved'
           ORDER BY l.name COLLATE NOCASE
         )
       ) AS lists
       FROM list_movies lm
       WHERE lm.tmdb_id IN (${placeholders}) AND lm.status = 'resolved'
       GROUP BY lm.tmdb_id`,
    )
    .all(...tmdbIds);
  return new Map(rows.map((row) => [row.tmdb_id, row.lists]));
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

export default router;
