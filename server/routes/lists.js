import { Router } from 'express';

import { getDb } from '../db.js';
import { parseImport } from '../parse.js';
import { resolveEntry, getMovie, getTvShow } from '../tmdb.js';
import { recordEntry, upsertMovie } from '../movies.js';

const router = Router();

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function listWithCounts(db, id) {
  return db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM list_movies lm
                WHERE lm.list_id = l.id AND lm.status = 'resolved')     AS resolved_count,
              (SELECT COUNT(*) FROM list_movies lm
                WHERE lm.list_id = l.id AND lm.status <> 'resolved')    AS review_count
       FROM lists l WHERE l.id = ?`,
    )
    .get(id);
}

router.get('/', (req, res) => {
  const db = getDb();
  const lists = db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM list_movies lm
                WHERE lm.list_id = l.id AND lm.status = 'resolved')  AS resolved_count,
              (SELECT COUNT(*) FROM list_movies lm
                WHERE lm.list_id = l.id AND lm.status <> 'resolved') AS review_count
       FROM lists l ORDER BY l.kind DESC, l.name`,
    )
    .all();

  // The deduplicated pool is what actually matters for a draw, and it is smaller
  // than the sum of the lists whenever a film sits on more than one of them.
  const poolSize = db
    .prepare(
      `SELECT COUNT(DISTINCT lm.tmdb_id) AS n
       FROM list_movies lm JOIN lists l ON l.id = lm.list_id
       WHERE l.is_active = 1 AND lm.tmdb_id IS NOT NULL`,
    )
    .get().n;

  res.json({ lists, pool_size: poolSize });
});

router.post('/', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw badRequest('A list name is required');

  const db = getDb();
  if (db.prepare('SELECT 1 FROM lists WHERE name = ?').get(name)) {
    throw badRequest(`A list named "${name}" already exists`);
  }

  const { lastInsertRowid } = db
    .prepare(`INSERT INTO lists (name, kind, is_active) VALUES (?, 'custom', 0)`)
    .run(name);

  res.status(201).json(listWithCounts(db, Number(lastInsertRowid)));
});

router.patch('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) throw badRequest('No such list');

  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw badRequest('A list name is required');
    db.prepare('UPDATE lists SET name = ? WHERE id = ?').run(name, id);
  }
  if (req.body?.is_active !== undefined) {
    db.prepare('UPDATE lists SET is_active = ? WHERE id = ?').run(
      req.body.is_active ? 1 : 0,
      id,
    );
  }

  res.json(listWithCounts(db, id));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) throw badRequest('No such list');

  // Seed lists are cheap to re-seed but expensive to re-resolve; make removing
  // one deliberate rather than a stray click.
  if (list.kind === 'seed' && req.query.force !== 'true') {
    throw badRequest('Refusing to delete a seed list without ?force=true');
  }

  db.prepare('DELETE FROM lists WHERE id = ?').run(id);
  res.json({ deleted: true });
});

// --- Import ---------------------------------------------------------------
//
// Resolution is network-bound (two TMDB calls per title), so imports run as an
// in-memory background job the client polls. Jobs are as ephemeral as draws;
// nothing here needs to survive a restart.

const jobs = new Map();
let nextJobId = 1;

router.post('/:id/import', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) throw badRequest('No such list');

  const entries = parseImport(req.body, { format: req.query.format });
  if (entries.length === 0) throw badRequest('Could not find any titles in that input');
  if (entries.length > 5000) throw badRequest('That is over the 5000-title import limit');

  const jobId = String(nextJobId++);
  const job = {
    id: jobId,
    list_id: id,
    total: entries.length,
    done: 0,
    resolved: 0,
    needs_review: 0,
    unmatched: 0,
    duplicate: 0,
    status: 'running',
    error: null,
  };
  jobs.set(jobId, job);

  runImport(db, id, entries, job).catch((error) => {
    job.status = 'failed';
    job.error = error.message;
  });

  res.status(202).json(job);
});

async function runImport(db, listId, entries, job) {
  const CONCURRENCY = 8;
  let cursor = 0;

  const worker = async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      try {
        const result = await resolveEntry(entry);
        const recorded = recordEntry(db, {
          listId,
          rawTitle: entry.title,
          rawYear: entry.year,
          result,
        });
        job[recorded.status] = (job[recorded.status] ?? 0) + 1;
      } catch (error) {
        // One bad title must not abandon the rest of the import.
        recordEntry(db, {
          listId,
          rawTitle: entry.title,
          rawYear: entry.year,
          result: { status: 'unmatched', candidates: [] },
        });
        job.unmatched += 1;
        job.error = error.message;
      }
      job.done += 1;
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  job.status = 'done';

  // Keep finished jobs briefly so the client's last poll still sees the summary.
  setTimeout(() => jobs.delete(job.id), 5 * 60_000).unref();
}

router.get('/imports/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) throw badRequest('No such import job (it may have expired)');
  res.json(job);
});

// --- Entries and manual reconciliation ------------------------------------

router.get('/:id/entries', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const status = req.query.status;

  const where = status === 'needs_review' ? `AND lm.status <> 'resolved'` : '';
  const rows = db
    .prepare(
      `SELECT lm.id, lm.raw_title, lm.raw_year, lm.status, lm.candidates_json,
              lm.tmdb_id, m.media_type, m.title, m.original_title, m.year, m.poster_path, m.director,
              m.runtime, m.overview, m.original_language, m.vote_average,
              m.countries, m.languages, m.trailer_key, m.watched,
              (SELECT group_concat(g.name, ', ')
                 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                WHERE mg.tmdb_id = m.tmdb_id) AS genres,
              (SELECT group_concat(name, ', ') FROM (
                 SELECT l2.name FROM list_movies lm2 JOIN lists l2 ON l2.id = lm2.list_id
                 WHERE lm2.tmdb_id = m.tmdb_id AND lm2.status = 'resolved'
                 ORDER BY l2.name COLLATE NOCASE
               )) AS lists
       FROM list_movies lm
       LEFT JOIN movies m ON m.tmdb_id = lm.tmdb_id
       WHERE lm.list_id = ? ${where}
       ORDER BY lm.status <> 'resolved' DESC, COALESCE(m.title, lm.raw_title)
       LIMIT ? OFFSET ?`,
    )
    .all(id, Math.min(Number(req.query.limit) || 200, 5000), Number(req.query.offset) || 0);

  res.json({
    entries: rows.map(({ candidates_json: candidates, ...row }) => ({
      ...row,
      candidates: candidates ? JSON.parse(candidates) : [],
    })),
  });
});

/**
 * Attaches a host-chosen TMDB id to an entry the matcher could not settle —
 * either from a candidate the reconciliation UI already showed (always a
 * movie), or a TMDB URL/id the host pasted directly. The latter can name a
 * TV-catalogued entry (e.g. Histoire(s) du cinéma, which actually aired as an
 * 8-part French TV series) — `/search/movie` would never surface those, so a
 * direct paste is the only way in. TV rows are stored under the negation of
 * their TMDB id (see the schema comment on `movies`); `getTvShow` returns
 * them pre-negated, so `movie.tmdb_id` below is already the right storage key
 * either way.
 */
router.post('/entries/:entryId/resolve', async (req, res) => {
  const db = getDb();
  const entryId = Number(req.params.entryId);
  const entry = db.prepare('SELECT * FROM list_movies WHERE id = ?').get(entryId);
  if (!entry) throw badRequest('No such entry');

  const tmdbId = Number(req.body?.tmdb_id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) throw badRequest('A positive tmdb_id is required');
  const mediaType = req.body?.media_type === 'tv' ? 'tv' : 'movie';

  const movie =
    mediaType === 'tv'
      ? await getTvShow(tmdbId)
      : (await resolveEntry({ title: entry.raw_title, year: entry.raw_year, tmdb_id: tmdbId })).movie;

  if (!movie) {
    throw badRequest(`TMDB has no ${mediaType === 'tv' ? 'TV show' : 'movie'} with that id`);
  }

  const storedId = movie.tmdb_id;
  const clash = db
    .prepare('SELECT id FROM list_movies WHERE list_id = ? AND tmdb_id = ? AND id <> ?')
    .get(entry.list_id, storedId, entryId);
  if (clash) {
    // The film is already on this list under a different raw title; keep one row.
    db.prepare('DELETE FROM list_movies WHERE id = ?').run(entryId);
    return res.json({ status: 'duplicate', tmdb_id: storedId });
  }

  upsertMovie(db, movie);
  db.prepare(
    `UPDATE list_movies SET tmdb_id = ?, status = 'resolved', candidates_json = NULL WHERE id = ?`,
  ).run(storedId, entryId);

  res.json({ status: 'resolved', tmdb_id: storedId, movie });
});

/**
 * Splits one entry into several resolved films — for the rare case where a
 * single list entry actually represents a boxset (e.g. Criterion's Qatsi
 * Trilogy spine, which bundles three separate films under one release, since
 * Wikidata's spine-number property was recorded on the boxset rather than
 * each film). Rather than making one list_movies row point at several TMDB
 * ids, this dissolves the ambiguous entry into N ordinary resolved rows —
 * afterward there's no record it was ever "one entry"; each film is a plain
 * resolved row exactly like one imported on its own from the start. Nothing
 * else in the app has any notion of a boxset grouping to preserve.
 */
router.post('/entries/:entryId/resolve-many', async (req, res) => {
  const db = getDb();
  const entryId = Number(req.params.entryId);
  const entry = db.prepare('SELECT * FROM list_movies WHERE id = ?').get(entryId);
  if (!entry) throw badRequest('No such entry');

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) throw badRequest('At least one TMDB id is required');
  if (items.length > 20) {
    throw badRequest('That is a lot of films for one entry — is this really a single boxset?');
  }

  const resolved = [];
  const failed = [];

  for (const item of items) {
    const tmdbId = Number(item?.tmdb_id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      failed.push({ tmdb_id: item?.tmdb_id ?? null, error: 'not a valid TMDB id' });
      continue;
    }
    const mediaType = item?.media_type === 'tv' ? 'tv' : 'movie';

    try {
      const movie = mediaType === 'tv' ? await getTvShow(tmdbId) : await getMovie(tmdbId);
      if (!movie) {
        failed.push({
          tmdb_id: tmdbId,
          error: `no ${mediaType === 'tv' ? 'TV show' : 'movie'} with that id`,
        });
        continue;
      }

      const already = db
        .prepare('SELECT id FROM list_movies WHERE list_id = ? AND tmdb_id = ?')
        .get(entry.list_id, movie.tmdb_id);
      if (already) {
        failed.push({ tmdb_id: tmdbId, error: `"${movie.title}" is already on this list` });
        continue;
      }

      upsertMovie(db, movie);
      db.prepare(
        `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
         VALUES (?, ?, ?, ?, 'resolved')`,
      ).run(entry.list_id, movie.tmdb_id, movie.title, movie.year);
      resolved.push(movie);
    } catch (error) {
      failed.push({ tmdb_id: tmdbId, error: error.message });
    }
  }

  // Only replace the ambiguous placeholder once something actually resolved —
  // if every pasted id failed, leave it in place rather than losing it.
  if (resolved.length > 0) {
    db.prepare('DELETE FROM list_movies WHERE id = ?').run(entryId);
  }

  res.json({ resolved, failed });
});

router.delete('/entries/:entryId', (req, res) => {
  const db = getDb();
  const { changes } = db
    .prepare('DELETE FROM list_movies WHERE id = ?')
    .run(Number(req.params.entryId));
  if (!changes) throw badRequest('No such entry');
  res.json({ deleted: true });
});

export default router;
