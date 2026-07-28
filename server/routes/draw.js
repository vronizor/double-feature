import { Router } from 'express';

import { getDb } from '../db.js';
import { drawFromPool, queryPool, poolCount, poolFacets, languageName, POOL_SORT_KEYS } from '../pool.js';
import { hydrateMovies } from '../movies.js';

const router = Router();

const MIN_DRAW_SIZE = 1;
const MAX_DRAW_SIZE = 10;
const MAX_PAGE_SIZE = 120;

/** Filter options, limited to what the active pool actually contains. */
router.get('/pool/facets', (req, res) => {
  const db = getDb();
  const facets = poolFacets(db);
  res.json({
    ...facets,
    languages: facets.languages.map((row) => ({ ...row, name: languageName(row.code) })),
    total: poolCount(db, {}),
  });
});

/** Live "N films match" count behind the filter panel. */
router.post('/pool/count', (req, res) => {
  const filters = req.body?.filters ?? {};
  const exclude = req.body?.exclude ?? [];
  res.json({ count: poolCount(getDb(), filters, exclude) });
});

/**
 * A draw is ephemeral: nothing is written until the host publishes it. The
 * host's staged selection (already-picked films, whether drawn or added by
 * hand) is passed as `exclude` so "draw N more" tops up the lineup rather
 * than handing back duplicates of what's already in it.
 */
router.post('/draw', (req, res) => {
  const db = getDb();
  const size = Number(req.body?.size ?? req.body?.n ?? 2);
  if (!Number.isInteger(size) || size < MIN_DRAW_SIZE || size > MAX_DRAW_SIZE) {
    throw Object.assign(
      new Error(`Draw size must be a whole number from ${MIN_DRAW_SIZE} to ${MAX_DRAW_SIZE}`),
      { status: 400 },
    );
  }

  const filters = req.body?.filters ?? {};
  const exclude = req.body?.exclude ?? [];
  const available = poolCount(db, filters, exclude);
  const tmdbIds = drawFromPool(db, filters, size, exclude);

  res.json({
    movies: hydrateMovies(db, tmdbIds),
    requested: size,
    available,
    // Over-filtering is reported rather than thrown, so the host can see what
    // happened and loosen a filter instead of hitting an error page.
    shortfall: tmdbIds.length < size ? size - tmdbIds.length : 0,
  });
});

/**
 * A sorted, paginated page of the filtered pool — for browsing the library
 * (the Explore tab), as opposed to /draw's random N-sized sample.
 */
router.post('/pool/movies', (req, res) => {
  const db = getDb();
  const filters = req.body?.filters ?? {};
  const sort = POOL_SORT_KEYS.includes(req.body?.sort) ? req.body.sort : 'title';
  const limit = Math.min(Math.max(Number(req.body?.limit) || 60, 1), MAX_PAGE_SIZE);
  const offset = Math.max(Number(req.body?.offset) || 0, 0);

  const tmdbIds = queryPool(db, filters, { sort, limit, offset });
  res.json({
    movies: hydrateMovies(db, tmdbIds),
    total: poolCount(db, filters),
    limit,
    offset,
  });
});

export default router;
