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

import { getMovie, getDirectorCredits, getPerson } from './tmdb.js';
import { upsertMovie } from './movies.js';
import { inTransaction } from './db.js';

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

/** The films a parametric vibe resolves to, for each kind of parameter. */
async function filmsFor(param, value) {
  if (param?.kind !== 'person') throw new Error(`unsupported parameter kind: ${param?.kind}`);
  // job=Director via /person/{id}/movie_credits, never discover's with_crew —
  // that matches any crew role and returns assistant-director credits on other
  // people's films. See DECISIONS.md section 1.
  if (param.job !== 'Director') throw new Error(`unsupported job: ${param.job}`);
  return getDirectorCredits(value.id);
}

/** The name a slot list wears while it holds this value. */
function slotName(param, value) {
  return `${param.label ?? 'Vibe'} night — ${value.name}`;
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
 * Rank is deliberately left NULL. A filmography has no ranking, and writing
 * chronological positions would make "top 10" mean "his first ten films",
 * which is not what anyone asking for a top 10 wants.
 */
export async function applyParameter(db, vibe, value) {
  if (!vibe.param) throw new Error(`"${vibe.name}" is not a parametric vibe`);
  if (!value?.id || !value?.name) throw new Error('A parameter needs an id and a name');

  const named = { ...value, name: await canonicalName(value) };
  const films = await filmsFor(vibe.param, named);
  if (films.length === 0) return { list_id: null, count: 0, name: slotName(vibe.param, named) };

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
      `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
       VALUES (?, ?, ?, ?, 'resolved')`,
    );
    for (const film of films) {
      const known = db.prepare('SELECT title, year FROM movies WHERE tmdb_id = ?').get(film.id);
      if (!known) continue; // never cached and the fetch failed
      insert.run(list.id, film.id, known.title ?? film.title, known.year ?? film.year);
      count += 1;
    }
    db.prepare('UPDATE lists SET name = ?, materialised_at = datetime(\'now\') WHERE id = ?').run(
      name,
      list.id,
    );
  });

  return { list_id: list.id, count, name };
}
