import { Router } from 'express';

import { getDb } from '../db.js';
import { getMovie, getTvShow } from '../tmdb.js';
import { upsertMovie, hydrateMovies, createManualMovie } from '../movies.js';

const router = Router();

/**
 * "Watched" is a property of the film, not of a list membership — the same film
 * on both Criterion and BFI is one film, and marking it watched must exclude it
 * from draws regardless of which list surfaced it.
 */
router.post('/:tmdbId/watched', (req, res) => {
  const db = getDb();
  const tmdbId = Number(req.params.tmdbId);
  const watched = req.body?.watched === undefined ? true : Boolean(req.body.watched);

  const { changes } = db
    .prepare(
      `UPDATE movies
       SET watched = ?, watched_at = CASE WHEN ? THEN datetime('now') ELSE NULL END
       WHERE tmdb_id = ?`,
    )
    .run(watched ? 1 : 0, watched ? 1 : 0, tmdbId);

  if (!changes) throw Object.assign(new Error('No such movie'), { status: 404 });
  res.json({ tmdb_id: tmdbId, watched });
});

router.get('/watched', (req, res) => {
  const db = getDb();
  res.json({
    movies: db
      .prepare(
        `SELECT tmdb_id, title, year, poster_path, director, watched_at
         FROM movies WHERE watched = 1 ORDER BY watched_at DESC`,
      )
      .all(),
  });
});

/**
 * Fetches a movie by TMDB id, caching it locally first if it isn't already —
 * backs the Draw tab's "add a specific film" flow, where a host might add a
 * TMDB search result (or a pasted URL/id) that was never on any curated list.
 * Registered after /watched so that literal path isn't swallowed as a tmdbId.
 */
router.get('/:tmdbId', async (req, res) => {
  const db = getDb();
  const tmdbId = Number(req.params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId === 0) {
    throw Object.assign(new Error('A valid tmdb_id is required'), { status: 400 });
  }

  const [cached] = hydrateMovies(db, [tmdbId]);
  if (cached) return res.json({ movie: cached });

  const mediaType = req.query.media_type === 'tv' ? 'tv' : 'movie';
  const fetched = mediaType === 'tv' ? await getTvShow(Math.abs(tmdbId)) : await getMovie(tmdbId);
  if (!fetched) {
    throw Object.assign(
      new Error(`TMDB has no ${mediaType === 'tv' ? 'TV show' : 'movie'} with that id`),
      { status: 400 },
    );
  }

  upsertMovie(db, fetched);
  const [movie] = hydrateMovies(db, [fetched.tmdb_id]);
  res.json({ movie });
});

/**
 * The rare case where a proposal isn't findable on TMDB at all — creates a
 * bare title/year entry for the Draw tab's lineup, with no TMDB-derived data
 * (no poster, rating, genres, trailer). See the schema comment on `movies`
 * for how its id is kept from ever colliding with a real one.
 */
router.post('/manual', (req, res) => {
  const db = getDb();
  const title = req.body?.title;
  const year = Number.isInteger(Number(req.body?.year)) ? Number(req.body.year) : null;

  const tmdbId = createManualMovie(db, { title, year });
  const [movie] = hydrateMovies(db, [tmdbId]);
  res.json({ movie });
});

export default router;
