import { Router } from 'express';

import { getDb } from '../db.js';
import { drawFromPool, queryPool, poolCount, poolFacets, languageName, POOL_SORT_KEYS , countryFacet } from '../pool.js';
import { hydrateMovies } from '../movies.js';

const router = Router();

const MIN_DRAW_SIZE = 1;
const MAX_DRAW_SIZE = 10;
const MAX_PAGE_SIZE = 120;

/**
 * Filter options, limited to what the SELECTED pool actually contains.
 *
 * `?lists=1,4,9` scopes the counts and bounds to that selection; omitting it
 * falls back to `is_active`, which is what a first paint sends before the
 * client has a selection of its own. Without the parameter the chips would
 * describe the default pool while the draw used the selected one — measured at
 * "Drama 1671" against a 40-film selection.
 */
router.get('/pool/facets', (req, res) => {
  const db = getDb();
  // Three states, matching the filter convention: the parameter ABSENT means
  // "fall back to is_active", while `?lists=` (present but empty) means the
  // host has deselected everything and the pool really is empty. Collapsing
  // those two would make deselecting every list show the default pool's counts.
  const raw = req.query.lists;
  const lists =
    raw === undefined
      ? null
      : String(raw)
          .split(',')
          .map(Number)
          .filter(Number.isInteger);

  const facets = poolFacets(db, lists);
  // No `total` here on purpose. It used to be `poolCount` over the list
  // selection ALONE, which made it a plausible-looking number that ignored
  // genres, year, runtime, topN and includeWatched — draw.js seeded its
  // "N films match" from it and reported 954 where the real pool was 97.
  // /pool/count takes the whole filter set and is the only honest source for
  // that number; leaving a near-miss alternative in the response is what
  // caused the bug, so it is gone rather than fixed.
  res.json({
    ...facets,
    languages: facets.languages.map((row) => ({ ...row, name: languageName(row.code) })),
  });
});

// Every endpoint below takes a POOL SETUP — `{ lists, topN, filters }` — not a
// bare filter object. The list selection used to ride inside `filters`, which
// is what let this route and /pool/facets disagree about what a pool was.
const setupFrom = (req) => req.body?.setup ?? {};

/** Live "N films match" count behind the filter panel. */
router.post('/pool/count', (req, res) => {
  const exclude = req.body?.exclude ?? [];
  res.json({ count: poolCount(getDb(), setupFrom(req), exclude) });
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

  const setup = setupFrom(req);
  const exclude = req.body?.exclude ?? [];
  const available = poolCount(db, setup, exclude);
  const tmdbIds = drawFromPool(db, setup, size, exclude);

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
  const setup = setupFrom(req);
  const sort = POOL_SORT_KEYS.includes(req.body?.sort) ? req.body.sort : 'title';
  const limit = Math.min(Math.max(Number(req.body?.limit) || 60, 1), MAX_PAGE_SIZE);
  const offset = Math.max(Number(req.body?.offset) || 0, 0);

  const tmdbIds = queryPool(db, setup, { sort, limit, offset });
  res.json({
    movies: hydrateMovies(db, tmdbIds),
    total: poolCount(db, setup),
    limit,
    offset,
  });
});

/** The country vocabulary for national cinema night, derived from the library. */
router.get('/pool/countries', (req, res) => {
  res.json({ countries: countryFacet(getDb()) });
});

export default router;