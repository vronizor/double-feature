import { Router } from 'express';
import QRCode from 'qrcode';

import { getDb } from '../db.js';
import { generateSlug, isValidSlug } from '../slug.js';
import { hydrateMovies } from '../movies.js';
import { tallyBallots, describeTiebreak } from '../borda.js';
import { describeFilters } from '../pool.js';
import { baseUrl } from '../lan.js';

const router = Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

function loadSession(slug) {
  if (!isValidSlug(slug)) throw fail('No such vote session', 404);
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE slug = ?').get(slug);
  if (!session) throw fail('No such vote session', 404);
  return { db, session };
}

function sessionMovies(db, slug) {
  const ids = db
    .prepare('SELECT tmdb_id FROM session_movies WHERE slug = ? ORDER BY position')
    .all(slug)
    .map((row) => row.tmdb_id);
  return hydrateMovies(db, ids);
}

function loadBallots(db, slug) {
  const ballots = db
    .prepare('SELECT id, voter_name FROM ballots WHERE slug = ? ORDER BY id')
    .all(slug);
  const ranks = db
    .prepare(
      `SELECT br.ballot_id, br.tmdb_id, br.rank
       FROM ballot_ranks br JOIN ballots b ON b.id = br.ballot_id
       WHERE b.slug = ? ORDER BY br.rank`,
    )
    .all(slug);

  const byBallot = new Map(ballots.map((b) => [b.id, { ...b, ranks: [] }]));
  for (const rank of ranks) byBallot.get(rank.ballot_id)?.ranks.push(rank);
  return [...byBallot.values()];
}

// --- Publish --------------------------------------------------------------

router.post('/', (req, res) => {
  const db = getDb();
  const tmdbIds = (Array.isArray(req.body?.tmdb_ids) ? req.body.tmdb_ids : [])
    .map(Number)
    .filter(Number.isInteger);

  if (tmdbIds.length === 0) throw fail('Publish a draw with at least one movie', 400);

  const known = db
    .prepare(
      `SELECT tmdb_id FROM movies WHERE tmdb_id IN (${tmdbIds.map(() => '?').join(', ')})`,
    )
    .all(...tmdbIds)
    .map((row) => row.tmdb_id);
  if (known.length !== tmdbIds.length) throw fail('That draw contains unknown movies', 400);

  const activeLists = db
    .prepare('SELECT name FROM lists WHERE is_active = 1 ORDER BY name')
    .all()
    .map((row) => row.name);

  let slug;
  for (let attempt = 0; ; attempt += 1) {
    slug = generateSlug();
    if (!db.prepare('SELECT 1 FROM sessions WHERE slug = ?').get(slug)) break;
    if (attempt > 10) throw fail('Could not allocate a session slug', 500);
  }

  db.prepare(
    `INSERT INTO sessions (slug, anonymous, status, filter_summary)
     VALUES (?, ?, 'open', ?)`,
  ).run(
    slug,
    req.body?.anonymous ? 1 : 0,
    describeFilters(db, req.body?.filters ?? {}, activeLists),
  );

  const insert = db.prepare(
    'INSERT INTO session_movies (slug, tmdb_id, position) VALUES (?, ?, ?)',
  );
  tmdbIds.forEach((tmdbId, index) => insert.run(slug, tmdbId, index));

  const base = baseUrl();
  res.status(201).json({
    slug,
    url: base ? `${base}/vote/${slug}` : `/vote/${slug}`,
    anonymous: Boolean(req.body?.anonymous),
  });
});

// --- History --------------------------------------------------------------
//
// Only published draws appear here; an unpublished draw is ephemeral by design
// and was never written down.

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT s.slug, s.status, s.anonymous, s.filter_summary, s.tiebreak_note,
              s.created_at, s.closed_at, s.winner_tmdb_id,
              w.title AS winner_title, w.year AS winner_year,
              w.poster_path AS winner_poster_path,
              (SELECT COUNT(*) FROM session_movies sm WHERE sm.slug = s.slug) AS movie_count,
              (SELECT COUNT(*) FROM ballots b       WHERE b.slug  = s.slug) AS ballot_count
       FROM sessions s
       LEFT JOIN movies w ON w.tmdb_id = s.winner_tmdb_id
       ORDER BY s.created_at DESC, s.rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(Number(req.query.limit) || 50, Number(req.query.offset) || 0);

  res.json({
    sessions: rows.map((row) => ({
      ...row,
      anonymous: Boolean(row.anonymous),
      movies: sessionMovies(db, row.slug).map((movie) => ({
        tmdb_id: movie.tmdb_id,
        title: movie.title,
        year: movie.year,
        poster_path: movie.poster_path,
      })),
    })),
  });
});

// --- Live state -----------------------------------------------------------

router.get('/:slug', (req, res) => {
  const { db, session } = loadSession(req.params.slug);
  const movies = sessionMovies(db, session.slug);
  const ballotCount = db
    .prepare('SELECT COUNT(*) AS n FROM ballots WHERE slug = ?').get(session.slug).n;

  const payload = {
    slug: session.slug,
    status: session.status,
    anonymous: Boolean(session.anonymous),
    filter_summary: session.filter_summary,
    created_at: session.created_at,
    closed_at: session.closed_at,
    movies,
    ballot_count: ballotCount,
  };

  // The running tally is for the host screen, and is withheld entirely while an
  // anonymous session is open — per the spec, the host waits like everyone else.
  if (req.query.include === 'tally' && !session.anonymous && session.status === 'open') {
    const ballots = loadBallots(db, session.slug);
    payload.tally = tallyBallots({
      tmdbIds: movies.map((movie) => movie.tmdb_id),
      ballots,
    });
    payload.voters = ballots.map((ballot) => ballot.voter_name);
  }

  res.json(payload);
});

router.get('/:slug/qr.svg', async (req, res) => {
  const { session } = loadSession(req.params.slug);
  const base = baseUrl();
  if (!base) throw fail('No LAN address detected — set HOST_LAN_IP', 503);

  const svg = await QRCode.toString(`${base}/vote/${session.slug}`, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  res.type('image/svg+xml').set('cache-control', 'no-store').send(svg);
});

// --- Voting ---------------------------------------------------------------

router.post('/:slug/ballots', (req, res) => {
  const { db, session } = loadSession(req.params.slug);
  if (session.status !== 'open') throw fail('Voting has closed for this session', 409);

  const validIds = new Set(
    db.prepare('SELECT tmdb_id FROM session_movies WHERE slug = ?')
      .all(session.slug)
      .map((row) => row.tmdb_id),
  );

  // Accept either an ordered list of ids or explicit {tmdb_id, rank} pairs, then
  // renumber from 1 either way so a client bug can't submit gappy ranks.
  const raw = Array.isArray(req.body?.ranks) ? req.body.ranks : [];
  const ordered = raw
    .map((item) => (typeof item === 'object' ? item : { tmdb_id: item, rank: null }))
    .map((item) => ({ tmdb_id: Number(item.tmdb_id), rank: Number(item.rank) }))
    .filter((item) => validIds.has(item.tmdb_id))
    .sort((a, b) => (Number.isFinite(a.rank) && Number.isFinite(b.rank) ? a.rank - b.rank : 0));

  const seen = new Set();
  const ranks = [];
  for (const item of ordered) {
    if (seen.has(item.tmdb_id)) continue;
    seen.add(item.tmdb_id);
    ranks.push({ tmdb_id: item.tmdb_id, rank: ranks.length + 1 });
  }
  if (ranks.length === 0) throw fail('Rank at least one movie before submitting', 400);

  const name = String(req.body?.voter_name ?? '').trim().slice(0, 60);
  if (!session.anonymous && !name) throw fail('Enter your name before submitting', 400);

  // Anonymity is applied on write: no name and no timestamp ever reach the disk,
  // so nothing downstream — including the host, and including someone opening the
  // .db file directly — can attribute a ballot.
  const { lastInsertRowid } = db
    .prepare('INSERT INTO ballots (slug, voter_name, created_at) VALUES (?, ?, ?)')
    .run(
      session.slug,
      session.anonymous ? null : name,
      session.anonymous ? null : new Date().toISOString(),
    );

  const insert = db.prepare(
    'INSERT INTO ballot_ranks (ballot_id, tmdb_id, rank) VALUES (?, ?, ?)',
  );
  const rows = session.anonymous ? shuffle([...ranks]) : ranks;
  for (const rank of rows) insert.run(Number(lastInsertRowid), rank.tmdb_id, rank.rank);

  res.status(201).json({ submitted: true, ranked: ranks.length });
});

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

// --- Close and results ----------------------------------------------------

router.post('/:slug/close', (req, res) => {
  const { db, session } = loadSession(req.params.slug);
  if (session.status === 'closed') return res.json(buildResults(db, session.slug));

  const movies = sessionMovies(db, session.slug);
  const ballots = loadBallots(db, session.slug);
  const tally = tallyBallots({ tmdbIds: movies.map((m) => m.tmdb_id), ballots });

  const titleFor = (tmdbId) =>
    movies.find((movie) => movie.tmdb_id === tmdbId)?.title ?? String(tmdbId);

  // Resolved once and written down. Closing is final for this draw.
  db.prepare(
    `UPDATE sessions
     SET status = 'closed', closed_at = datetime('now'),
         winner_tmdb_id = ?, tiebreak_note = ?
     WHERE slug = ?`,
  ).run(tally.winner, describeTiebreak(tally.tiebreak, titleFor), session.slug);

  res.json(buildResults(db, session.slug));
});

/**
 * Cancels a still-open session outright — undoing the publish, rather than
 * closing (which computes and permanently records a winner). Only valid
 * while open: a closed session is a completed historical record, and
 * "cancel" isn't a way to un-close one. Cascades to session_movies, ballots
 * and ballot_ranks, so any ballots already submitted are discarded too.
 */
router.delete('/:slug', (req, res) => {
  const { db, session } = loadSession(req.params.slug);
  if (session.status !== 'open') {
    throw fail('Only an open session can be cancelled', 400);
  }
  db.prepare('DELETE FROM sessions WHERE slug = ?').run(session.slug);
  res.json({ cancelled: true });
});

router.get('/:slug/results', (req, res) => {
  const { db, session } = loadSession(req.params.slug);
  if (session.status !== 'closed') {
    return res.json({ slug: session.slug, status: 'open' });
  }
  res.json(buildResults(db, session.slug));
});

function buildResults(db, slug) {
  const session = db.prepare('SELECT * FROM sessions WHERE slug = ?').get(slug);
  const movies = sessionMovies(db, slug);
  const ballots = loadBallots(db, slug);
  const tally = tallyBallots({ tmdbIds: movies.map((m) => m.tmdb_id), ballots });

  // Points and 1st-place counts are deterministic, but the winner is not when a
  // coin flip decided it — so use the one recorded at close.
  const winner = session.winner_tmdb_id ?? tally.winner;
  const standings = [...tally.standings].sort(
    (a, b) =>
      (b.tmdb_id === winner) - (a.tmdb_id === winner) ||
      b.points - a.points ||
      b.first_place_votes - a.first_place_votes,
  );

  return {
    slug,
    status: session.status,
    anonymous: Boolean(session.anonymous),
    filter_summary: session.filter_summary,
    created_at: session.created_at,
    closed_at: session.closed_at,
    movies,
    standings,
    winner_tmdb_id: winner,
    tiebreak_note: session.tiebreak_note,
    ballot_count: ballots.length,
    // Anonymous sessions have no names stored at all; this is the aggregate view
    // the spec asks for, not a filtered version of a fuller one.
    ballots: session.anonymous
      ? null
      : ballots.map((ballot) => ({
          voter_name: ballot.voter_name,
          ranks: ballot.ranks.map((rank) => ({ tmdb_id: rank.tmdb_id, rank: rank.rank })),
        })),
  };
}

export default router;
