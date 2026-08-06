import { Router } from 'express';

import { getDb } from '../db.js';
import { parseImport } from '../parse.js';
import { resolveEntry, getMovie, getTvShow, scoreCandidate } from '../tmdb.js';
import {
  recordEntry,
  upsertMovie,
  LIST_SHAPE_CTE,
  listMembershipsSql,
  parseMemberships,
} from '../movies.js';

const router = Router();

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

function listWithCounts(db, id) {
  return db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM list_movies lm
                WHERE lm.list_id = l.id AND lm.status = 'resolved')     AS resolved_count,
              (SELECT COUNT(*) FROM list_movies lm
                WHERE lm.list_id = l.id AND lm.status <> 'resolved')    AS review_count,
              (SELECT COUNT(lm.rank) FROM list_movies lm
                WHERE lm.list_id = l.id)                               AS ranked_count,
              (SELECT SUM(lm.rank = 1) > 1 FROM list_movies lm
                WHERE lm.list_id = l.id)                               AS ranks_by_year
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
                WHERE lm.list_id = l.id AND lm.status <> 'resolved') AS review_count,
              -- COUNT(col) skips NULLs, so this is "how many rows on this list
              -- carry a rank" — 0 means the list simply isn't a ranked one,
              -- which is what the Top-N control keys off to decide whether it
              -- is worth showing at all.
              (SELECT COUNT(lm.rank) FROM list_movies lm
                WHERE lm.list_id = l.id)                             AS ranked_count,
              -- Whether this list's rank is a position WITHIN A YEAR rather
              -- than across the whole list. It decides what a Top-N cut means
              -- here — "the top 5" or "the top 5 of every year" — which is a
              -- difference of two orders of magnitude in the pool.
              --
              -- The tell is MORE THAN ONE row at rank 1: a per-year list has a
              -- #1 for every year it covers, an end-to-end ranking has exactly
              -- one. Repeated ranks anywhere is NOT the tell, and using it was
              -- wrong: Sight and Sound is a poll with heavy ties, 264 ranked
              -- rows across only 71 distinct positions, and it was read as
              -- per-year. It has one #1, like every end-to-end list here.
              (SELECT SUM(lm.rank = 1) > 1 FROM list_movies lm
                WHERE lm.list_id = l.id)                             AS ranks_by_year,
              (SELECT group_concat(tag, ',') FROM (
                 SELECT tag FROM list_tags WHERE list_id = l.id ORDER BY tag
               ))                                                    AS tag_csv
       FROM lists l ORDER BY l.origin DESC, l.name`,
    )
    .all()
    // Tags arrive as a delimited string from group_concat; the client wants an
    // array, and an untagged list must be [] rather than [''].
    .map((row) => ({ ...row, tags: row.tag_csv ? row.tag_csv.split(',') : [] }));

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
  // A watchlist is a list with an owner, and nothing else distinguishes it.
  // Empty string is not an owner: it would make a household list answer to
  // every device's "is this mine?" at once.
  const owner = String(req.body?.owner ?? '').trim() || null;

  const db = getDb();
  if (db.prepare('SELECT 1 FROM lists WHERE name = ?').get(name)) {
    throw badRequest(`A list named "${name}" already exists`);
  }
  // One per person. Without this, a device that loses its localStorage and
  // re-announces the same name quietly ends up with two watchlists, and only
  // one of them has the films in it.
  if (owner && db.prepare('SELECT 1 FROM lists WHERE owner = ?').get(owner)) {
    throw badRequest(`${owner} already has a watchlist`);
  }

  const { lastInsertRowid } = db
    .prepare(
      // is_active = 0, always. A watchlist that arrived in play would widen
      // everyone else's pool the next time the app opened, on the strength of
      // one person saving one film.
      `INSERT INTO lists (name, origin, is_active, owner) VALUES (?, 'custom', 0, ?)`,
    )
    .run(name, owner);

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
    // Same guard POST already has. Without it the UNIQUE index on lists.name
    // surfaces as a 500 carrying a raw SQLite string. `id != ?` so that
    // renaming a list to the name it already has stays a no-op rather than
    // failing against itself.
    if (db.prepare('SELECT 1 FROM lists WHERE name = ? AND id != ?').get(name, id)) {
      throw badRequest(`A list named "${name}" already exists`);
    }
    // Renaming a seed list hands its name to the host for good: the seed keeps
    // the key and stops touching the name — see upsertList in scripts/seed.mjs.
    // Only when the name actually CHANGES, so a PATCH that resends the current
    // name does not quietly opt them out of future renames.
    const takesOver = list.seed_key !== null && name !== list.name;
    db.prepare(`UPDATE lists SET name = ?${takesOver ? ', name_custom = 1' : ''} WHERE id = ?`)
      .run(name, id);
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
  if (list.origin === 'seed' && req.query.force !== 'true') {
    throw badRequest('Refusing to delete a seed list without ?force=true');
  }
  // A watchlist gets the same guard for the OPPOSITE reason, and the inversion
  // is the point: a seed list is protected because re-resolving it costs TMDB
  // calls, but it can always be re-fetched. A watchlist exists nowhere else --
  // it was assembled a film at a time and no source can rebuild it. Export it
  // first; that endpoint exists so this one can be survivable.
  if (list.owner && req.query.force !== 'true') {
    throw badRequest(`Refusing to delete ${list.owner}'s watchlist without ?force=true`);
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

/**
 * Whether a resolved row is worth a second look.
 *
 * A row that failed to match sits in a visible queue; a row that matched
 * WRONGLY is `resolved`, so it is indistinguishable from 7,000 correct ones and
 * nobody ever looks at it again. That asymmetry is the reason this exists.
 *
 * It re-runs the matcher's OWN confidence rule against what the row actually
 * ended up pointing at, rather than inventing a second notion of agreement:
 * the question is "would the matcher be confident about this pair today", and
 * anything it would not wave through is worth a human glance. Reusing
 * scoreCandidate is the whole point — a bespoke heuristic here could disagree
 * with the matcher in either direction and neither answer would mean anything.
 *
 * It is a PROMPT, never a verdict. Fuzzy matching is accepted on the Spanish
 * list by decision, so a flag there often marks a correct match made loosely.
 * Measured across the library when written: 458 of 7,358 resolved rows, 6.2%,
 * concentrated in España (13%), France (10%) and Criterion (5%) — a queue you
 * can actually work through, which a stricter rule would not be.
 */
const looksUnsure = (row) =>
  !scoreCandidate(
    { title: row.raw_title, year: row.raw_year },
    {
      title: row.title,
      original_title: row.original_title,
      release_date: String(row.year ?? ''),
    },
  ).confident;

router.get('/:id/entries', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const status = req.query.status;

  const where = status === 'needs_review' ? `AND lm.status <> 'resolved'` : '';
  const rows = db
    .prepare(
      `WITH ${LIST_SHAPE_CTE}
       SELECT lm.id, lm.raw_title, lm.raw_year, lm.status, lm.candidates_json,
              lm.tmdb_id, m.media_type, m.title, m.original_title, m.year, m.poster_path, m.director,
              m.runtime, m.overview, m.original_language, m.vote_average,
              m.countries, m.languages, m.trailer_key, m.watched,
              (SELECT group_concat(g.name, ', ')
                 FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id
                WHERE mg.tmdb_id = m.tmdb_id) AS genres,
              ${listMembershipsSql('m.tmdb_id')} AS lists
       FROM list_movies lm
       LEFT JOIN movies m ON m.tmdb_id = lm.tmdb_id
       WHERE lm.list_id = ? ${where}
       ORDER BY lm.status <> 'resolved' DESC, COALESCE(m.title, lm.raw_title)
       LIMIT ? OFFSET ?`,
    )
    // The suspect filter runs in JS, after the rows are read, because it needs
    // the matcher rather than SQL. So it must not be handed a page: filtering
    // the first 200 rows alphabetically would quietly report "3 worth checking"
    // on a 1,469-row list whose suspects mostly sit past the letter C. Read the
    // list whole and let the filter see all of it.
    .all(
      id,
      status === 'suspect' ? 5000 : Math.min(Number(req.query.limit) || 200, 5000),
      status === 'suspect' ? 0 : Number(req.query.offset) || 0,
    );

  const entries = rows.map(({ candidates_json: candidates, ...row }) => ({
    ...row,
    lists: parseMemberships(row.lists),
    candidates: candidates ? JSON.parse(candidates) : [],
    // Only ever true on a resolved row: an unresolved one is already in the
    // queue, and marking it as well would say nothing.
    suspect: row.status === 'resolved' && looksUnsure(row),
  }));

  res.json({
    entries: status === 'suspect' ? entries.filter((entry) => entry.suspect) : entries,
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

// --- One film at a time ----------------------------------------------------
//
// The import path above is bulk, asynchronous and network-bound because it
// resolves raw titles. Saving a film you are already looking at is none of
// those things: the id is known, the movie row already exists, and the answer
// has to come back inside a button press. So this is a separate route rather
// than an import of one, and it makes NO TMDB call at all.
//
// The consequence for the client is that a film not yet in the library has to
// be cached first, via GET /api/movies/:tmdbId — which is the same two-step
// the lineup's "add a specific film" flow already does.

router.post('/:id/entries', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) throw badRequest('No such list');

  const tmdbId = Number(req.body?.tmdb_id);
  // Not `!tmdbId`: a TV-sourced entry is stored under a NEGATIVE id and a
  // manual one below -1,000,000,000, so the only invalid integer here is 0.
  if (!Number.isInteger(tmdbId) || tmdbId === 0) throw badRequest('A valid tmdb_id is required');

  const movie = db.prepare('SELECT * FROM movies WHERE tmdb_id = ?').get(tmdbId);
  if (!movie) throw badRequest('That film is not in the library yet — cache it first');

  const existing = db
    .prepare('SELECT id FROM list_movies WHERE list_id = ? AND tmdb_id = ?')
    .get(id, tmdbId);
  // Idempotent rather than an error. This backs a toggle, and a double tap on
  // a phone must not surface as a failure — the film is on the list either
  // way, which is what the caller asked for.
  if (existing) return res.json({ entry_id: existing.id, tmdb_id: tmdbId, added: false });

  // raw_title/raw_year carry the film's own title here rather than something a
  // host typed, because nothing was typed: the provenance of a saved film is
  // the film. status is 'resolved' with no matching involved at all, which is
  // the whole reason this path cannot produce a needs_review row.
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
       VALUES (?, ?, ?, ?, 'resolved')`,
    )
    .run(id, tmdbId, movie.title, movie.year ?? null);

  res.status(201).json({ entry_id: Number(lastInsertRowid), tmdb_id: tmdbId, added: true });
});

/**
 * A list as a file, in EXACTLY the seed-file shape.
 *
 * Deliberately not a bespoke export format. `parseImport` already reads this
 * shape, and `resolveEntry` short-circuits to a single detail call when an
 * entry carries a tmdb_id — so a watchlist mailed to a friend re-imports
 * through the path that already exists, with no title matching and nothing
 * landing in their reconciliation queue. A new format would have meant a new
 * parser, and the parser is where the traps are.
 *
 * title and year travel beside the id even though the id alone would do: it
 * keeps the file readable by a human, and it degrades to ordinary title
 * matching if TMDB ever retires an id.
 */
router.get('/:id/export', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
  if (!list) throw badRequest('No such list');

  const entries = db
    .prepare(
      `SELECT lm.tmdb_id, lm.rank, lm.award_year, lm.raw_title, lm.raw_year,
              m.title, m.year
       FROM list_movies lm
       LEFT JOIN movies m ON m.tmdb_id = lm.tmdb_id
       WHERE lm.list_id = ? AND lm.tmdb_id IS NOT NULL
       ORDER BY lm.rank IS NULL, lm.rank, COALESCE(m.title, lm.raw_title)`,
    )
    .all(id)
    .map((row) => ({
      title: row.title ?? row.raw_title,
      year: row.year ?? row.raw_year ?? null,
      // Present but null on an unranked list, matching the seed files, rather
      // than absent — an absent key and a null one read the same to a person
      // and differently to a parser.
      ...(row.rank === null ? {} : { rank: row.rank }),
      ...(row.award_year === null ? {} : { award_year: row.award_year }),
      tmdb_id: row.tmdb_id,
    }));

  const tags = db
    .prepare('SELECT tag FROM list_tags WHERE list_id = ? ORDER BY tag')
    .all(id)
    .map((row) => row.tag);

  // The OWNER is deliberately not exported. A watchlist sent to a friend
  // becomes an ordinary list on their machine — importing "Alice's watchlist"
  // as something their own devices would then claim as theirs is the one way
  // this feature could confuse two households at once.
  res.json({
    name: list.name,
    ...(tags.length ? { tags } : {}),
    ...(list.category ? { category: list.category } : {}),
    ...(list.short_name ? { short_name: list.short_name } : {}),
    ...(list.source ? { source: list.source } : {}),
    ...(list.source_url ? { source_url: list.source_url } : {}),
    exported_at: new Date().toISOString().slice(0, 10),
    count: entries.length,
    entries,
  });
});

export default router;
