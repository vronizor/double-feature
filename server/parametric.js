/**
 * Parametric vibes — the ones that need a value chosen at selection time.
 *
 * "Director night" is not a set of lists; it is a question ("which director?")
 * whose answer is a different set of films every time. The problem is that
 * everything downstream of the draw — the filters, Top-N, the "N films match"
 * counter, publishing, History — works one way: films that are on the lists you
 * ticked. There is no path into the pool that is not a list.
 *
 * So rather than teach four places a second way to be in the pool, a parametric
 * vibe owns ONE list and rewrites it. Think of a whiteboard labelled "Director
 * night": choose Kurosawa and we wipe it and write his 32 films; choose Ozu next
 * week and we wipe it again. Exactly one row per parametric vibe, forever, and
 * every downstream feature already knows how to read it.
 *
 * The two costs, both accepted deliberately:
 *
 *   - You cannot have two directors at once. Picking one replaces the other.
 *     Combining directors is not what "director night" asks for.
 *   - The list's contents change under you. Published sessions are unaffected,
 *     because publishing copies the films into session_movies rather than
 *     referencing the list.
 *
 * The alternative — a new list per director — proliferates rows forever, which
 * is the exact problem that ruled out one list per country.
 */

import { getMovie, getDirectorCredits, getActingCredits, getPerson } from './tmdb.js';
import { upsertMovie } from './movies.js';
import { inTransaction } from './db.js';
import { countryFacet } from './pool.js';

/**
 * The canonical name for a value, looked up rather than taken on trust.
 *
 * The caller sends an id and a name together, and nothing stops them
 * disagreeing — which is not hypothetical: testing this endpoint with an id
 * typed from memory produced a list of Allison Anders films correctly counted,
 * correctly resolved, and labelled "Director night — Yasujiro Ozu". Nothing
 * failed. The id is the only thing that selected any films, so the id is what
 * names the list, and the caller's name is a fallback for when TMDB is
 * unreachable rather than a source of truth.
 */
async function canonicalName(value) {
  try {
    return (await getPerson(value.id))?.name ?? value.name;
  } catch {
    return value.name;
  }
}

// Both read /person/{id}/movie_credits, but from different halves of it —
// directing is a crew job, acting is not a job at all. See getActingCredits.
const CREDITS_BY_JOB = {
  Director: getDirectorCredits,
  Acting: getActingCredits,
};

/** The films a parametric vibe resolves to, for each kind of parameter. */
async function filmsFor(param, value) {
  if (param?.kind !== 'person') throw new Error(`unsupported parameter kind: ${param?.kind}`);
  // Never discover's with_crew — it matches any crew role and returns
  // assistant-director credits on other people's films. See DECISIONS.md §1.
  const credits = CREDITS_BY_JOB[param.job];
  if (!credits) throw new Error(`unsupported job: ${param.job}`);
  return credits(value.id);
}

/**
 * The name a slot list wears while it holds this value.
 *
 * Possessive, to match the vibes themselves: the built-ins are "Director's
 * night" and "Actor's night", and this produced "Director night — Kurosawa"
 * and "Actor night — Bruce Willis" beside them. The mismatch reached the vote
 * panel, where the list summary is what a published vote records itself as
 * having been drawn from.
 *
 * Safe to change: a slot list is found through its `vibe_lists` link and never
 * by name — see slotList below — so existing ones simply take the new name the
 * next time they are applied.
 */
function slotName(param, value) {
  return `${param.label ?? 'Vibe'}'s night — ${value.name}`;
}

/**
 * Finds the vibe's slot list, creating it the first time. Identified by the
 * vibe_lists link rather than by name, precisely because the name changes.
 */
function slotList(db, vibe) {
  const pinned = db
    .prepare(
      `SELECT l.* FROM vibe_lists vl JOIN lists l ON l.id = vl.list_id
        WHERE vl.vibe_id = ? AND l.hidden = 1`,
    )
    .get(vibe.id);
  if (pinned) return pinned;

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO lists (name, origin, is_active, hidden, source)
       VALUES (?, 'custom', 0, 1, ?)`,
    )
    .run(`${vibe.name} (slot)`, `Rewritten by the "${vibe.name}" vibe`);
  const id = Number(lastInsertRowid);
  db.prepare('INSERT INTO vibe_lists (vibe_id, list_id) VALUES (?, ?)').run(vibe.id, id);
  return db.prepare('SELECT * FROM lists WHERE id = ?').get(id);
}

/**
 * Gives a parametric vibe its value and returns the vibe, resolved.
 *
 * Films the library already holds are reused rather than re-fetched — for
 * Kurosawa that is 17 of 32, so half the night costs nothing. The rest are
 * fetched through getMovie, so the TMDB semaphore still caps concurrency.
 *
 * Ranked by RATING, which is the meaning that works. A filmography has no
 * order of its own, and the obvious one is wrong: writing chronological
 * positions would make "top 10" mean "his first ten films". Rating makes "the
 * top 10 Kurosawa" the question people actually ask, and the numbers are
 * already cached, so no fetch is added.
 *
 * See rankByRating for the floor and for why nothing is left NULL.
 */
/**
 * Below this many IMDb votes a rating is noise rather than an opinion.
 *
 * The same floor `formatImdb` uses to decide whether a second rating is worth
 * showing at all, and it is duplicated here for the same reason `topNLabel` is:
 * that one lives in the browser bundle and the server cannot import it. If one
 * moves, move both.
 *
 * 1,000 rather than the 5,000 the Modern Classics query needed. That number is
 * right for a query sorting the whole of TMDB, where anything looser returns
 * Gabriel's Inferno; it is wrong here. A filmography is twenty to forty films,
 * and 5,000 votes would strip most pre-1960 work out of a Kurosawa or an Ozu —
 * deleting the canon to keep out noise that a closed, human-curated set of one
 * director's films does not contain in the first place.
 */
const IMDB_VOTE_FLOOR = 1000;

/**
 * Orders a slot list's films best-first, and ranks EVERY one of them.
 *
 * **Nothing may be left NULL, and that is the subtle part.** A NULL rank means
 * "this list is not ranked" and a Top-N cut deliberately keeps those films —
 * otherwise asking for the top 100 would delete every unranked list from the
 * pool. Correct across lists, wrong within one: leaving the unrated films NULL
 * here would make "top 10 Kurosawa" return ten good films PLUS every obscure
 * title that could not be rated, which is the opposite of what was asked.
 *
 * So films that cannot be rated sink to the bottom of the order rather than
 * floating out of the cut. Two ways to be unrateable and both land there: too
 * few votes, and no IMDb rating at all — the latter is ordinary rather than
 * exceptional, because ratings arrive from a script that is run by hand, so a
 * film fetched into the library today has none until it is next run.
 */
function rankByRating(films) {
  const rateable = (film) => film.imdb_rating > 0 && (film.imdb_votes ?? 0) >= IMDB_VOTE_FLOOR;

  return [...films].sort((a, b) => {
    if (rateable(a) !== rateable(b)) return rateable(a) ? -1 : 1;
    if (!rateable(a)) return String(a.title).localeCompare(String(b.title));
    // Votes break a rating tie: at equal scores the more-seen film is the
    // better answer to "his best", and it keeps the order stable rather than
    // letting SQLite's row order decide.
    return b.imdb_rating - a.imdb_rating || (b.imdb_votes ?? 0) - (a.imdb_votes ?? 0);
  });
}

export async function applyParameter(db, vibe, value) {
  if (!vibe.param) throw new Error(`"${vibe.name}" is not a parametric vibe`);

  // A country parameter is a FILTER, not a list, and that is the whole design.
  // movies.countries is already cached, so "Japanese night" narrows the pool
  // the host already curated rather than fetching films the library has never
  // seen. Nothing is written: the vibe hands back a filter and the client
  // applies it, exactly as any other vibe's filters are applied.
  //
  // The discover route (with_origin_country) would ADD unseen films instead.
  // That is a genuinely different feature -- a way to explore Japanese cinema
  // rather than to draw from your own shelf -- and it is not this one.
  if (vibe.param.kind === 'country') {
    const country = String(value?.name ?? '').trim();
    if (!country) throw new Error('A country parameter needs a name');
    const known = countryFacet(db).find((entry) => entry.country === country);
    if (!known) throw new Error(`No films from ${country} in the library`);
    return {
      kind: 'filter',
      filters: { countries: { include: [country] } },
      count: known.count,
      // The vibe's own name, not the parameter label: "Country night — Japan"
      // reads like a category, "National cinema — Japan" like an answer.
      name: `${vibe.name} — ${country}`,
    };
  }

  if (!value?.id || !value?.name) throw new Error('A parameter needs an id and a name');

  const named = { ...value, name: await canonicalName(value) };
  const films = await filmsFor(vibe.param, named);
  if (films.length === 0) return { kind: 'list', list_id: null, count: 0, name: slotName(vibe.param, named) };

  const ids = films.map((film) => film.id);
  const cached = new Set(
    db
      .prepare(`SELECT tmdb_id FROM movies WHERE tmdb_id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids)
      .map((row) => row.tmdb_id),
  );

  const fetched = await Promise.all(
    films
      .filter((film) => !cached.has(film.id))
      .map(async (film) => {
        try {
          return await getMovie(film.id);
        } catch {
          // One unavailable film must not lose the whole night.
          return null;
        }
      }),
  );

  const list = slotList(db, vibe);
  const name = slotName(vibe.param, named);
  let count = 0;

  // Wipe and rewrite as one unit: a crash midway would otherwise leave the
  // slot holding half of one director and half of another, which is a list
  // that never existed and would be drawn from silently.
  inTransaction(db, () => {
    for (const movie of fetched) if (movie) upsertMovie(db, movie);
    db.prepare('DELETE FROM list_movies WHERE list_id = ?').run(list.id);

    const insert = db.prepare(
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, rank, status)
       VALUES (?, ?, ?, ?, ?, 'resolved')`,
    );

    // Read the ratings back AFTER the upserts above, so a film fetched moments
    // ago is ranked on the same footing as one the library already held.
    const known = db.prepare(
      'SELECT title, year, imdb_rating, imdb_votes FROM movies WHERE tmdb_id = ?',
    );
    const rows = films
      .map((film) => {
        const row = known.get(film.id);
        // Never cached and the fetch failed: there is no title to show and no
        // rating to rank on, so the film is dropped rather than ranked last.
        return row ? { ...row, id: film.id, title: row.title ?? film.title, year: row.year ?? film.year } : null;
      })
      .filter(Boolean);

    for (const [index, row] of rankByRating(rows).entries()) {
      insert.run(list.id, row.id, row.title, row.year, index + 1);
      count += 1;
    }
    db.prepare('UPDATE lists SET name = ?, materialised_at = datetime(\'now\') WHERE id = ?').run(
      name,
      list.id,
    );
  });

  return { kind: 'list', list_id: list.id, count, name };
}
