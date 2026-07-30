import { getDb } from './db.js';
import { hasTmdbCredentials } from './config.js';
import { getMovie, getTvShow } from './tmdb.js';
import { upsertMovie } from './movies.js';
import { findDynamicLists, materialiseAll } from './dynamic-lists.js';

/** Re-fetches one cached row from the right TMDB endpoint for its media type. */
export function refetch(row) {
  return row.media_type === 'tv' ? getTvShow(-row.tmdb_id) : getMovie(row.tmdb_id);
}

// TMDB's terms cap cached data at six months. Refresh at five so entries are
// never close to the limit even if the Pi is off for a few weeks.
const REFRESH_AFTER_DAYS = 150;
const DAILY = 24 * 60 * 60 * 1000;

// Fields that should always end up populated once a movie has been fetched at
// least once since they were added to the schema. `trailer_key` is
// deliberately excluded: plenty of obscure or older films genuinely have no
// TMDB-catalogued trailer, and treating that as "incomplete" would re-fetch
// those rows forever instead of just the ones actually missing data.
//
// `countries` and `languages` are excluded for exactly the same reason, which
// took a measurement to notice. They are not always present on TMDB either —
// verified against the live API, `/movie/1578` (Raging Bull) and `/movie/637`
// (Life Is Beautiful) both come back with an empty spoken_languages, and
// `/movie/1204194` is empty for both fields. Five rows in a 2,460-film library
// could therefore never satisfy this predicate: they were re-fetched every
// single day, and because the ORDER BY below sorts incomplete rows first they
// permanently occupied the head of the 250-row daily queue. `npm run backfill`
// reported "5 updated" on every run without ever converging.
//
// The cost of leaving them out is that a NEWLY added column stops self-healing
// within a day for these two fields; the 150-day cycle still backfills it, just
// slower. That is the right trade — the alternative is a queue that never
// drains.
const INCOMPLETE = `(vote_average IS NULL OR original_title IS NULL)`;

// "Stale" also covers a cached row missing one of those fields — not just one
// past the six-month cap — so a schema addition self-heals over the following
// days instead of leaving old entries permanently incomplete. Missing-field
// rows sort first since they're actively broken, not just aging.
//
// A manual entry (is_manual = 1) has no TMDB source at all, so it will NEVER
// have these fields populated — without excluding it, the job would retry it
// forever, uselessly, since refetch() has nothing to fetch it from.
export function findStaleMovies(db, limit = 250) {
  return db
    .prepare(
      `SELECT tmdb_id, media_type FROM movies
       WHERE is_manual = 0 AND (refreshed_at < datetime('now', ?) OR ${INCOMPLETE})
       ORDER BY ${INCOMPLETE} DESC, refreshed_at ASC LIMIT ?`,
    )
    .all(`-${REFRESH_AFTER_DAYS} days`, limit);
}

/** Every cached movie missing required data, regardless of age — for a one-off backfill (see scripts/backfill.mjs). */
export function findIncompleteMovies(db) {
  return db.prepare(`SELECT tmdb_id, media_type FROM movies WHERE is_manual = 0 AND ${INCOMPLETE}`).all();
}

export async function refreshStaleMovies({ limit = 250, log = console.log } = {}) {
  if (!hasTmdbCredentials()) return { refreshed: 0, failed: 0, skipped: true };

  const db = getDb();
  const stale = findStaleMovies(db, limit);
  if (stale.length === 0) return { refreshed: 0, failed: 0 };

  log(`[refresh] refreshing ${stale.length} cached movie(s) older than ${REFRESH_AFTER_DAYS} days`);
  let refreshed = 0;
  let failed = 0;

  await Promise.all(
    stale.map(async (row) => {
      try {
        const movie = await refetch(row);
        if (movie) {
          upsertMovie(db, movie);
          refreshed += 1;
        } else {
          failed += 1;
        }
      } catch (error) {
        failed += 1;
        log(`[refresh] ${row.tmdb_id} failed: ${error.message}`);
      }
    }),
  );

  log(`[refresh] done: ${refreshed} refreshed, ${failed} failed`);
  return { refreshed, failed };
}

/**
 * Re-runs every dynamic list's query, so "crowd-pleasers of the last ten
 * years" keeps meaning that as films are released and ratings settle.
 *
 * Deliberately part of the same daily job rather than its own schedule: these
 * lists drift slowly (a film needs thousands of votes to qualify), and a Pi
 * that's rebooted often gets a run at boot either way.
 */
export async function refreshDynamicLists({ log = console.log } = {}) {
  if (!hasTmdbCredentials()) return { skipped: true };
  const db = getDb();
  const lists = findDynamicLists(db);
  if (lists.length === 0) return { lists: 0 };

  const results = await materialiseAll(db, { log });
  for (const result of results) {
    if (result.error) continue;
    if (result.added || result.removed) {
      log(`[dynamic] ${result.name}: +${result.added} -${result.removed} (${result.total} total)`);
    }
  }
  return { lists: results.length, results };
}

export function startRefreshJob() {
  const run = () => {
    refreshStaleMovies().catch((error) => console.error('[refresh]', error.message));
    refreshDynamicLists().catch((error) => console.error('[dynamic]', error.message));
  };
  // A minute after boot, then daily — the Pi is likely to be rebooted more often
  // than it stays up for a month, so boot is the reliable trigger.
  setTimeout(run, 60_000).unref();
  setInterval(run, DAILY).unref();
}
