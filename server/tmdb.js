import { config, hasTmdbCredentials } from './config.js';

const BASE = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';

// TMDB tolerates roughly 50 requests/second. Eight in flight keeps seeding fast
// (a few minutes for ~2,600 titles) while staying well inside that.
const MAX_CONCURRENCY = 8;
let inFlight = 0;
const waiting = [];

function acquire() {
  if (inFlight < MAX_CONCURRENCY) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else inFlight -= 1;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TmdbError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'TmdbError';
    this.status = status;
  }
}

async function request(path, params = {}, { retries = 3 } = {}) {
  if (!hasTmdbCredentials()) {
    throw new TmdbError('TMDB credentials are not configured (see .env.example)', 500);
  }

  const url = new URL(BASE + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = { accept: 'application/json' };
  if (config.tmdb.accessToken) {
    headers.authorization = `Bearer ${config.tmdb.accessToken}`;
  } else {
    url.searchParams.set('api_key', config.tmdb.apiKey);
  }

  await acquire();
  try {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      } catch (cause) {
        if (attempt >= retries) throw new TmdbError(`TMDB request failed: ${cause.message}`, 502);
        await sleep(500 * 2 ** attempt);
        continue;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 1;
        await sleep(retryAfter * 1000);
        continue;
      }
      if (response.status === 404) return null;
      if (response.status === 401) {
        throw new TmdbError('TMDB rejected the credentials (check TMDB_API_KEY)', 401);
      }
      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new TmdbError(`TMDB responded ${response.status}`, 502);
      }
      return response.json();
    }
  } finally {
    release();
  }
}

/**
 * Fold a title down to something comparable across the ways lists write them:
 * accents, punctuation, curly quotes, and leading articles all vary between
 * Wikipedia, TSPDT and TMDB for the same film.
 */
export function normalizeTitle(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an|le|la|les|el|los|il|lo|der|die|das|een|de|het)\s+/, '')
    .trim();
}

const yearOf = (releaseDate) => {
  const year = Number(String(releaseDate ?? '').slice(0, 4));
  return Number.isInteger(year) && year > 1800 ? year : null;
};

/**
 * Decide whether a search result is the film we asked for.
 * Confident means the title matches exactly once normalised AND, when the list
 * supplied a year, the release year is within a year of it — lists and TMDB
 * routinely disagree by one on festival vs general release.
 */
export function scoreCandidate(query, candidate) {
  const wanted = normalizeTitle(query.title);
  const titles = [candidate.title, candidate.original_title].filter(Boolean).map(normalizeTitle);
  const titleExact = titles.includes(wanted);
  const titleClose = !titleExact && titles.some((t) => t.startsWith(wanted) || wanted.startsWith(t));

  const candidateYear = yearOf(candidate.release_date);
  const yearDelta =
    query.year && candidateYear ? Math.abs(candidateYear - Number(query.year)) : null;

  let score = 0;
  if (titleExact) score += 100;
  else if (titleClose) score += 45;
  if (yearDelta === 0) score += 50;
  else if (yearDelta === 1) score += 35;
  else if (yearDelta !== null && yearDelta <= 3) score += 10;
  else if (yearDelta !== null) score -= 40;
  score += Math.min(10, Math.log10((candidate.popularity ?? 0) + 1) * 5);

  const confident = titleExact && (yearDelta === null ? false : yearDelta <= 1);
  return { score, confident, titleExact, yearDelta, candidateYear };
}

export async function searchMovie({ title, year }) {
  const withYear = await request('/search/movie', {
    query: title,
    year,
    include_adult: false,
    language: 'en-US',
  });
  let results = withYear?.results ?? [];

  // A wrong year in the source list shouldn't lose the film entirely.
  if (results.length === 0 && year) {
    const withoutYear = await request('/search/movie', {
      query: title,
      include_adult: false,
      language: 'en-US',
    });
    results = withoutYear?.results ?? [];
  }
  return results.slice(0, 10);
}

export async function getMovie(tmdbId) {
  // `videos` rides along on the same request as `credits` — TMDB's
  // append_to_response takes a comma list, so this costs nothing extra.
  const data = await request(`/movie/${tmdbId}`, {
    append_to_response: 'credits,videos',
    language: 'en-US',
  });
  return data ? toMovie(data) : null;
}

/**
 * Some entries the seed lists (or a host) point at are catalogued on TMDB as
 * a TV series rather than a movie — Godard's Histoire(s) du cinéma is the
 * canonical case, since it actually aired as an 8-part French TV series even
 * though Criterion sells it as one work. `/search/movie` will never find
 * these, so they're only reachable by pasting the exact TMDB id/URL.
 *
 * Takes the real (positive) TMDB TV id; returns a movie-shaped record keyed
 * by its negation — see the schema comment on `movies` for why.
 */
export async function getTvShow(tvId) {
  const data = await request(`/tv/${tvId}`, {
    append_to_response: 'credits,videos',
    language: 'en-US',
  });
  return data ? tvToMovie(data) : null;
}

/** Normalises a TMDB TV payload into the same shape `toMovie` produces. */
export function tvToMovie(data) {
  // created_by (the show's credited creator(s)) is the closer analogue to a
  // film's director for a single-auteur work; the crew list is aggregated
  // across every episode and often names several different episode
  // directors, so it's only a fallback.
  const creators = (data.created_by ?? []).map((person) => person.name);
  const crewDirectors = (data.credits?.crew ?? [])
    .filter((person) => person.job === 'Director')
    .map((person) => person.name);
  const directors = creators.length ? creators : crewDirectors;

  return {
    tmdb_id: -data.id,
    media_type: 'tv',
    title: data.name || data.original_name,
    original_title: data.original_name || null,
    year: yearOf(data.first_air_date),
    poster_path: data.poster_path ?? null,
    director: directors.length ? [...new Set(directors)].join(', ') : null,
    runtime: Array.isArray(data.episode_run_time) ? data.episode_run_time[0] ?? null : null,
    overview: data.overview || null,
    original_language: data.original_language ?? null,
    vote_average: typeof data.vote_average === 'number' ? data.vote_average : null,
    countries: (data.production_countries ?? []).map((c) => c.name).join(', ') || null,
    languages: (data.spoken_languages ?? []).map((l) => l.english_name || l.name).join(', ') || null,
    trailer_key: pickTrailer(data.videos?.results),
    genres: (data.genres ?? []).map((genre) => ({ id: genre.id, name: genre.name })),
  };
}

/**
 * Picks the best trailer from a movie's video list: an official YouTube
 * trailer first, then any YouTube trailer, else null (many older or obscure
 * films genuinely have none catalogued — the caller falls back to a YouTube
 * search link in that case, rather than this ever blocking on retrying).
 */
export function pickTrailer(videos) {
  const candidates = (videos ?? []).filter(
    (video) => video.site === 'YouTube' && video.type === 'Trailer',
  );
  const official = candidates.find((video) => video.official);
  return (official ?? candidates[0])?.key ?? null;
}

export async function getGenres() {
  const data = await request('/genre/movie/list', { language: 'en' });
  return data?.genres ?? [];
}

/**
 * /discover/movie with arbitrary caller-supplied filters, paged to `limit`.
 *
 * Backs query-backed ("dynamic") lists — a list defined by a query rather than
 * a fixed set of ids, so it stays current without re-seeding.
 *
 * Returns discover's summary records, which are NOT enough to store: they carry
 * no runtime, director or genre names. Callers upsert via getMovie() per id,
 * exactly as the seeder does for any other list.
 */
export async function discoverMovies(params = {}, { limit = 100 } = {}) {
  const movies = [];
  // The page cap is a guard, not a target: discover happily reports hundreds of
  // pages, and without it a careless query could walk the entire catalogue.
  for (let page = 1; movies.length < limit && page <= 20; page += 1) {
    const data = await request('/discover/movie', {
      language: 'en-US',
      include_adult: false,
      ...params,
      page,
    });
    if (!data?.results?.length) break;
    movies.push(...data.results);
    if (page >= (data.total_pages ?? 1)) break;
  }
  return movies.slice(0, limit);
}

/**
 * People, for director night — the parameter half of a parametric vibe.
 *
 * Sorted so people who actually direct come first. TMDB's own ordering is by
 * popularity alone, which for a common surname puts an actor above the
 * director being looked for; `known_for_department` is the field that
 * separates them, and it costs nothing because search returns it already.
 */
export async function searchPerson(query, { limit = 8 } = {}) {
  const data = await request('/search/person', {
    query,
    language: 'en-US',
    include_adult: false,
  });
  return (data?.results ?? [])
    .map((person) => ({
      id: person.id,
      name: person.name,
      directs: person.known_for_department === 'Directing',
      popularity: person.popularity ?? 0,
      profile_path: person.profile_path ?? null,
      known_for: (person.known_for ?? [])
        .map((credit) => credit.title || credit.name)
        .filter(Boolean)
        .slice(0, 3),
    }))
    .sort((a, b) => Number(b.directs) - Number(a.directs) || b.popularity - a.popularity)
    .slice(0, limit);
}

/**
 * The films a person actually DIRECTED.
 *
 * Deliberately not `with_crew` on discover. Measured against the live API:
 * `with_crew=<Kurosawa>` returns 112 films because it matches any crew role,
 * and his crew credits include 13 "Assistant Director" and 11 "Third Assistant
 * Director" entries on other people's films. This route returns 32, which is
 * his actual filmography. Recorded in ROADMAP section 2 as a reversal; do not
 * re-propose the discover route.
 *
 * Deduplicated by id, because one film can carry the same person twice in the
 * crew list under different department spellings. Sorted oldest first, which
 * is how a filmography reads.
 */
export async function getDirectorCredits(personId) {
  const data = await request(`/person/${personId}/movie_credits`, { language: 'en-US' });
  const seen = new Set();
  return (data?.crew ?? [])
    .filter((credit) => credit.job === 'Director')
    .filter((credit) => (seen.has(credit.id) ? false : seen.add(credit.id)))
    .map((credit) => ({
      id: credit.id,
      title: credit.title,
      year: credit.release_date ? Number(credit.release_date.slice(0, 4)) : null,
      poster_path: credit.poster_path ?? null,
    }))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
}

export async function getTopRated(count = 100) {
  const movies = [];
  for (let page = 1; movies.length < count && page <= 10; page += 1) {
    const data = await request('/movie/top_rated', { language: 'en-US', page });
    if (!data?.results?.length) break;
    movies.push(...data.results);
  }
  return movies.slice(0, count);
}

/** Normalises a TMDB movie payload into the shape the `movies` table stores. */
export function toMovie(data) {
  const directors = (data.credits?.crew ?? [])
    .filter((person) => person.job === 'Director')
    .map((person) => person.name);

  return {
    tmdb_id: data.id,
    media_type: 'movie',
    title: data.title || data.original_title,
    // Kept distinct from `title` (which prefers the English/localised name)
    // so the UI can show it as a subtitle when a foreign film's original
    // title was replaced by an English one — never shown when identical.
    original_title: data.original_title || null,
    year: yearOf(data.release_date),
    poster_path: data.poster_path ?? null,
    director: directors.length ? directors.join(', ') : null,
    runtime: data.runtime ?? null,
    overview: data.overview || null,
    original_language: data.original_language ?? null,
    vote_average: typeof data.vote_average === 'number' ? data.vote_average : null,
    // `original_language` (a single code) stays as the filterable field;
    // `languages` is the full spoken-language list, for display only.
    countries: (data.production_countries ?? []).map((c) => c.name).join(', ') || null,
    languages: (data.spoken_languages ?? []).map((l) => l.english_name || l.name).join(', ') || null,
    trailer_key: pickTrailer(data.videos?.results),
    genres: (data.genres ?? []).map((genre) => ({ id: genre.id, name: genre.name })),
  };
}

/**
 * Resolve one raw `{title, year}` entry to a TMDB movie.
 * Never drops a title silently: anything not confidently matched comes back as
 * `needs_review` carrying its top candidates for the reconciliation screen.
 */
export async function resolveEntry({ title, year, tmdb_id: knownId }) {
  if (knownId) {
    const movie = await getMovie(knownId);
    if (movie) return { status: 'resolved', movie, candidates: [] };
  }

  const results = await searchMovie({ title, year });
  if (results.length === 0) {
    return { status: 'unmatched', movie: null, candidates: [] };
  }

  const ranked = results
    .map((candidate) => ({ candidate, ...scoreCandidate({ title, year }, candidate) }))
    .sort((a, b) => b.score - a.score);

  const candidates = ranked.slice(0, 5).map(({ candidate, candidateYear }) => ({
    tmdb_id: candidate.id,
    title: candidate.title,
    year: candidateYear,
    poster_path: candidate.poster_path ?? null,
    overview: candidate.overview || null,
  }));

  const best = ranked[0];
  // Two equally exact title matches means we genuinely can't tell which film the
  // list meant — send it to review rather than guessing on popularity.
  const ambiguous =
    ranked.length > 1 && ranked[1].confident && ranked[1].score === best.score;

  if (best.confident && !ambiguous) {
    const movie = await getMovie(best.candidate.id);
    if (movie) return { status: 'resolved', movie, candidates };
  }

  return { status: 'needs_review', movie: null, candidates };
}
