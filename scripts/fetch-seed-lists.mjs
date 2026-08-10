#!/usr/bin/env node
/**
 * Builds seeds/*.json from their canonical public sources.
 *
 * The build spec assumed all six lists live on Wikipedia. Only two of the six
 * really do, so each list here is pointed at the best source that actually
 * exists — see README "Where the seed lists come from" for the details:
 *
 *   Criterion       Wikidata (spine number P12279) — also carries TMDB ids
 *   Sight & Sound   bfi.org.uk, the poll's publisher
 *   TSPDT 1000      theyshootpictures.com, the list's publisher
 *   Disney canon    Wikidata (the "WDAS feature film" series item)
 *   Studio Ghibli   Wikidata (the "Studio Ghibli Feature Films" series item)
 *   TMDB Top Rated  the TMDB API (needs credentials; skipped without them)
 *
 * Run with `npm run fetch-seeds`. Results are committed, so a normal install
 * never needs to touch these sources.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = join(ROOT, 'seeds');

const UA = 'DoubleFeature/1.0 (self-hosted movie night app; seed list builder)';
const THIS_YEAR = new Date().getFullYear();

/**
 * The most recent box-office year that has SETTLED, and so the last one a
 * fetcher may take.
 *
 * A box-office year does not close on 31 December. Measured off the revision
 * histories of both the French and the US pages, the shape is the same for
 * both: the just-closed year is rewritten heavily through March and goes quiet
 * in April. Before then the chart is still moving.
 *
 * Why that matters more here than it would elsewhere: `seedList` is
 * INSERT-ONLY and `recordEntry` writes `rank` on the insert path alone, so a
 * film seeded at rank 4 cannot later be demoted to 7. A part-year chart is not
 * a value that will be corrected on the next run — it is permanent. Taking the
 * live year in August seeds a half-year top-20 that is simply wrong by
 * January, and the only repair is teaching the seeder to delete, which trades
 * a small correctness win for a path that can remove films from a list
 * somebody is drawing from tonight.
 *
 * So: never the running year, and not the just-closed one until April. Takes
 * `now` rather than reading the clock so the rule can be tested at a date
 * rather than only on the day someone runs the suite.
 */
export function lastSettledYear(now = new Date()) {
  // getMonth() is 0-based, so >= 3 is April onwards.
  return now.getMonth() >= 3 ? now.getFullYear() - 1 : now.getFullYear() - 2;
}

async function getText(url, headers = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': UA, ...headers },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  frac12: '½', frac14: '¼', frac34: '¾', ccedil: 'ç', eacute: 'é', egrave: 'è',
  agrave: 'à', uuml: 'ü', ouml: 'ö', auml: 'ä', ntilde: 'ñ', oslash: 'ø',
  aring: 'å', aelig: 'æ', szlig: 'ß', iacute: 'í', oacute: 'ó', uacute: 'ú',
  aacute: 'á', ocirc: 'ô', ecirc: 'ê', acirc: 'â', icirc: 'î', ucirc: 'û',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z][a-z0-9]*);/gi, (match, name) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? match);
}

const stripTags = (html) => html.replace(/<[^>]+>/g, ' ');
const collapse = (text) => text.replace(/\s+/g, ' ').trim();

// --- Wikidata -------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * query.wikidata.org is a free shared endpoint and rate-limits accordingly:
 * 429 when you go too fast, and an occasional 502 when the service itself is
 * busy. Both are transient, and both were hit while building the award lists,
 * so retry with exponential backoff rather than failing a whole fetch run over
 * one unlucky request.
 */
async function sparql(query, attempt = 0) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  try {
    const body = await getText(url, { accept: 'application/sparql-results+json' });
    return JSON.parse(body).results.bindings;
  } catch (error) {
    const transient = /responded (429|502|503|504)/.test(error.message);
    if (!transient || attempt >= 4) throw error;
    await sleep(2000 * 2 ** attempt);
    return sparql(query, attempt + 1);
  }
}

/**
 * Collapses the multiple rows Wikidata returns per film (one per release date
 * or per identifier) into one entry, keeping the earliest release year.
 */
function foldWikidataRows(rows) {
  const films = new Map();
  for (const row of rows) {
    const key = row.film.value;
    const entry = films.get(key) ?? { title: row.name.value, year: null, tmdb_id: null };
    if (row.date?.value) {
      const year = Number(row.date.value.slice(0, 4));
      if (Number.isInteger(year) && (entry.year === null || year < entry.year)) entry.year = year;
    }
    if (row.tmdb?.value && !entry.tmdb_id) entry.tmdb_id = Number(row.tmdb.value);
    if (row.spine?.value && entry.spine === undefined) entry.spine = row.spine.value;
    films.set(key, entry);
  }
  return [...films.values()];
}

async function fetchCriterion() {
  const rows = await sparql(`
    SELECT ?film ?name ?spine ?date ?tmdb WHERE {
      ?film wdt:P12279 ?spine .
      ?film rdfs:label ?name . FILTER(LANG(?name) = "en")
      OPTIONAL { ?film wdt:P577 ?date . }
      OPTIONAL { ?film wdt:P4947 ?tmdb . }
    }`);

  const entries = foldWikidataRows(rows)
    .map(({ spine, ...entry }) => entry)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title));

  return {
    slug: 'criterion-collection',
    name: 'The Criterion Collection',
    tags: ['collection', 'canon'],
    category: 'collection',
    source: 'Wikidata — Criterion Collection spine number (P12279)',
    // The data comes from Wikidata, but query.wikidata.org isn't somewhere a
    // host can browse to cross-reference a title — criterion.com's own
    // catalogue is. It 403s to curl (a Cloudflare JS challenge, confirmed via
    // the `cf-mitigated: challenge` response header) but resolves fine for an
    // actual browser, which is what a host will be using.
    source_url: 'https://www.criterion.com/shop/browse/list?sort=spine',
    note: 'Wikipedia deleted its Criterion release list; Wikidata is the structured stand-in and supplies TMDB ids directly.',
    entries,
  };
}

/**
 * Films that received a given award (P166), e.g. the Palme d'Or.
 *
 * The `wdt:P31 wd:Q11424` (instance of: film) constraint is load-bearing, not
 * decoration: producers receive Best Picture too, so without it the query
 * returns a mix of films and people — 228 "winners" for an award with 98
 * actual films.
 *
 * These lists are unranked on purpose — an award has no internal ordering.
 *
 * They DO carry an award_year, taken from the point-in-time (P585) qualifier
 * on the award-received statement. That was originally judged unnecessary on
 * the grounds that the ceremony year is release year + 1, but that reasoning
 * only holds for filtering ("winners from the 90s", which movies.year already
 * answers). It breaks for display: Cannes awards a film in its own release
 * year while the Oscars and national awards run the following February, so a
 * derived year would confidently print "Palme d'Or 2020" for a 2019 winner.
 */
async function fetchWikidataAward(awardQid, meta) {
  // p:/ps:/pq: rather than the plain wdt: shortcut, because the ceremony year
  // is a QUALIFIER (point in time, P585) hanging off the award-received
  // statement — it isn't reachable through the truthy-value shortcut at all.
  const rows = await sparql(`
    SELECT ?film ?name ?date ?tmdb ?awarded WHERE {
      ?film p:P166 ?statement ; wdt:P31 wd:Q11424 .
      ?statement ps:P166 wd:${awardQid} .
      OPTIONAL { ?statement pq:P585 ?awarded . }
      ?film rdfs:label ?name . FILTER(LANG(?name) = "en")
      OPTIONAL { ?film wdt:P577 ?date . }
      OPTIONAL { ?film wdt:P4947 ?tmdb . }
    }`);

  const byFilm = new Map();
  for (const row of rows) {
    const key = row.film.value;
    const entry = byFilm.get(key) ?? { title: row.name.value, year: null, award_year: null, tmdb_id: null };
    if (row.date?.value) {
      const year = Number(row.date.value.slice(0, 4));
      if (Number.isInteger(year) && (entry.year === null || year < entry.year)) entry.year = year;
    }
    if (row.awarded?.value && entry.award_year === null) {
      const awarded = Number(row.awarded.value.slice(0, 4));
      if (Number.isInteger(awarded)) entry.award_year = awarded;
    }
    if (row.tmdb?.value && !entry.tmdb_id) entry.tmdb_id = Number(row.tmdb.value);
    byFilm.set(key, entry);
  }

  const entries = [...byFilm.values()]
    .filter((entry) => entry.year === null || entry.year <= THIS_YEAR)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title));

  return { tags: ['awards'], category: 'awards', ...meta, entries };
}

// --- Wikipedia categories -------------------------------------------------

/** Thrown for throttling specifically, so callers can tell it from a bad page. */
class RateLimited extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimited';
  }
}

async function wikipediaApi(lang, params, attempt = 0) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 429 || response.status >= 500) {
    // Honour Retry-After when the server sends it — guessing shorter than it
    // asked for is what turns a pause into a ban. Eight attempts with a 4s base
    // gives up after ~8 minutes of trying, which suits a build-time script
    // walking 80+ pages far better than the 45 seconds four attempts allowed.
    if (attempt >= 8) {
      throw new RateLimited(`${lang}.wikipedia responded ${response.status} after ${attempt} retries`);
    }
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 4000 * 2 ** attempt);
    return wikipediaApi(lang, params, attempt + 1);
  }
  if (!response.ok) throw new Error(`${lang}.wikipedia responded ${response.status}`);

  // The rate limiter answers with HTTP 200 and a PLAIN TEXT body — "You are
  // making too many requests to the API." — so a bare response.json() throws a
  // JSON syntax error that looks nothing like throttling. Hit repeatedly while
  // building the box-office fetcher, which walks 82 pages in one run.
  const body = await response.text();
  if (/^You are making too many requests/i.test(body)) {
    if (attempt >= 8) throw new RateLimited(`${lang}.wikipedia is rate limiting this client`);
    await sleep(4000 * 2 ** attempt);
    return wikipediaApi(lang, params, attempt + 1);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${lang}.wikipedia returned a non-JSON body (${body.slice(0, 80)})`);
  }
}

/**
 * Where a run may cache what it downloads, when SEED_CACHE_DIR is set.
 *
 * **Off by default on purpose**: a committed seed file should come from a fresh
 * fetch, and a cache that silently served stale data would be a worse bug than
 * the waste it saves. It exists for the case that actually hurts — iterating on
 * a parser across 82 articles and ~3,400 TMDB lookups, where every run after
 * the first re-downloads identical data.
 *
 *   SEED_CACHE_DIR=.cache npm run fetch-seeds -- box-office
 */
const cacheDir = () => process.env.SEED_CACHE_DIR?.trim() || null;

// Politeness between article requests. It lives HERE rather than in the
// per-year loops that used to carry it, because those slept whether or not a
// request had actually happened — so a fully cached re-run of an 81-year
// source still took three minutes to read 81 files off a local disk. Throttle
// the thing being throttled, not the loop around it.
const WIKI_THROTTLE_MS = 1500;

/** One page's raw wikitext, optionally served from the cache. */
async function fetchWikitext(lang, title) {
  const dir = cacheDir() ? join(cacheDir(), 'wiki') : null;
  const cacheFile = dir
    ? join(dir, `${lang}-${title.replace(/[^\w.-]+/g, '_')}.wikitext`)
    : null;

  if (cacheFile) {
    try {
      return await readFile(cacheFile, 'utf8');
    } catch {
      // Not cached yet — fall through and fetch it.
    }
  }

  const data = await wikipediaApi(lang, {
    action: 'parse',
    page: title,
    prop: 'wikitext',
    redirects: '1',
  });
  const wikitext = data.parse?.wikitext ?? null;

  if (cacheFile && wikitext) {
    await mkdir(dir, { recursive: true });
    await writeFile(cacheFile, wikitext);
  }
  await sleep(WIKI_THROTTLE_MS);
  return wikitext;
}

// TMDB's terms cap cached data at six months, which is why the app's own
// refresh job runs at 150 days. This dev cache holds ONE field per film — the
// original language — and expires far sooner than that, so it never drifts near
// the limit. It is not redistributed: .cache/ is gitignored.
const LANGUAGE_CACHE_DAYS = 30;

/**
 * original_language for many tmdb ids, reusing anything already known.
 *
 * Caches the ANSWER, not the response. A full /movie detail payload is tens of
 * kilobytes and we need one field of it, so storing responses would mean ~120MB
 * to avoid re-reading ~60KB of actual information.
 */
async function originalLanguages(tmdbIds, getMovie, { log = () => {} } = {}) {
  const dir = cacheDir();
  const cacheFile = dir ? join(dir, 'tmdb-language.json') : null;
  const cutoff = Date.now() - LANGUAGE_CACHE_DAYS * 24 * 60 * 60 * 1000;

  const known = new Map();
  if (cacheFile) {
    try {
      const raw = JSON.parse(await readFile(cacheFile, 'utf8'));
      for (const [id, entry] of Object.entries(raw)) {
        if (entry && Date.parse(entry.at) > cutoff) known.set(Number(id), entry.lang);
      }
    } catch {
      // No cache yet, or it is unreadable — refetch everything.
    }
  }

  const missing = tmdbIds.filter((id) => !known.has(id));
  if (cacheFile) log(`\n  ${known.size} language(s) from cache, ${missing.length} to fetch`);

  let done = 0;
  await Promise.all(
    missing.map(async (id) => {
      // Through server/tmdb.js, whose semaphore caps this at 8 in flight.
      // Firing them unthrottled loses ~40% to rate limiting.
      const movie = await getMovie(id).catch(() => null);
      known.set(id, movie?.original_language ?? null);
      done += 1;
      if (done % 250 === 0) process.stdout.write(`${done} `);
    }),
  );

  if (cacheFile && missing.length) {
    const at = new Date().toISOString();
    const payload = Object.fromEntries([...known].map(([id, lang]) => [id, { lang, at }]));
    await mkdir(dir, { recursive: true });
    await writeFile(cacheFile, JSON.stringify(payload));
  }
  return known;
}

// --- The Wikipedia -> Wikidata -> TMDB pipeline ----------------------------
//
// Three steps that used to be one function. They are split because the middle
// two are the reusable part: any list of Wikipedia page titles — an award
// category, a box-office table, whatever comes next — resolves to TMDB ids the
// same way, and only the way the TITLES are gathered differs.
//
//     titles  ->  Wikidata QIDs  ->  TMDB ids
//
// Going through the QID rather than the page title means no fuzzy title
// matching anywhere, and it sidesteps localisation entirely: the French page
// for a film points at the same Wikidata item as the English one.

/** Step 1a: every page in a Wikipedia category, following continuation. */
export async function fetchCategoryMembers(lang, category) {
  const titles = [];
  let cont;
  do {
    const data = await wikipediaApi(lang, {
      action: 'query',
      list: 'categorymembers',
      cmtitle: category,
      cmnamespace: '0',
      cmlimit: '500',
      ...(cont ? { cmcontinue: cont } : {}),
    });
    titles.push(...(data.query?.categorymembers ?? []).map((m) => m.title));
    cont = data.continue?.cmcontinue;
    if (cont) await sleep(400);
  } while (cont);

  if (titles.length === 0) throw new Error(`category "${category}" is empty or missing`);
  return titles;
}

/**
 * Step 2: page titles -> Wikidata QIDs, keyed by the title as it was PASSED IN.
 *
 * The API normalises titles and follows redirects, so what comes back is often
 * spelled differently from what went out. Box office needs the round trip to
 * survive — each film's admissions figure is held against the original title —
 * so the normalised/redirected names are mapped back before returning.
 * 50 titles per request is the API limit.
 */
/**
 * A small JSON cache for the identity steps, on the same switch as the rest.
 *
 * The wikitext cache already spares the 81 article downloads, but iterating on
 * a PARSER re-resolves every title through Wikipedia and Wikidata each run —
 * which is the slow half, and the half that made re-running a fetcher an
 * afternoon rather than a coffee. A page title's QID and a QID's TMDB id are
 * both effectively immutable, so unlike the language cache these need no
 * expiry: the whole point of resolving through identifiers is that they do not
 * drift the way titles do.
 */
async function readJsonCache(name) {
  const dir = cacheDir();
  if (!dir) return null;
  try {
    return JSON.parse(await readFile(join(dir, name), 'utf8'));
  } catch {
    return {};
  }
}

async function writeJsonCache(name, data) {
  const dir = cacheDir();
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), JSON.stringify(data));
}

export async function titlesToQidMap(lang, titles) {
  const cacheName = `wikidata-qid-${lang}.json`;
  const cached = await readJsonCache(cacheName);
  const byTitle = new Map();
  if (cached) {
    for (const title of titles) {
      if (cached[title] !== undefined) byTitle.set(title, cached[title]);
    }
    titles = titles.filter((title) => cached[title] === undefined);
    if (byTitle.size) {
      console.log(`\n  ${byTitle.size} qid(s) from cache, ${titles.length} to resolve`);
    }
  }

  for (let i = 0; i < titles.length; i += 50) {
    const data = await wikipediaApi(lang, {
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      titles: titles.slice(i, i + 50).join('|'),
      redirects: '1',
    });
    const original = new Map();
    for (const entry of data.query?.normalized ?? []) original.set(entry.to, entry.from);
    for (const entry of data.query?.redirects ?? []) {
      original.set(entry.to, original.get(entry.from) ?? entry.from);
    }
    for (const page of data.query?.pages ?? []) {
      if (page.pageprops?.wikibase_item) {
        byTitle.set(original.get(page.title) ?? page.title, page.pageprops.wikibase_item);
      }
    }
    await sleep(400);
  }

  if (cached) {
    // Store the misses too, as null. A title that resolves to nothing is a
    // redirect to a non-item or a page Wikidata has never linked, and asking
    // again next run costs the same round trip for the same answer.
    for (const title of titles) cached[title] = byTitle.get(title) ?? null;
    await writeJsonCache(cacheName, cached);
  }
  for (const [title, qid] of byTitle) if (qid === null) byTitle.delete(title);
  return byTitle;
}

/** The same step, when only the set of QIDs matters (the award lists). */
export async function titlesToQids(lang, titles) {
  return [...new Set((await titlesToQidMap(lang, titles)).values())];
}

/**
 * Step 3: QIDs -> TMDB id, English title and release year.
 *
 * `awardQid`, when given, additionally pulls the ceremony year from the
 * point-in-time (P585) qualifier on that award's statement. Optional because
 * it is the one award-specific thing in this pipeline — box office has no
 * ceremony — and because the data is patchy anyway: 28-39% for the three
 * national awards, since it comes from the same sparse P166 statements that
 * made the category route necessary in the first place.
 */
export async function qidsToFilms(qids, { awardQid = null } = {}) {
  const entries = [];
  for (let i = 0; i < qids.length; i += 120) {
    const values = qids.slice(i, i + 120).map((q) => `wd:${q}`).join(' ');
    const awardClause = awardQid
      ? `OPTIONAL {
          ?item p:P166 ?statement .
          ?statement ps:P166 wd:${awardQid} .
          ?statement pq:P585 ?awarded .
        }`
      : '';
    const rows = await sparql(`
      SELECT ?item ?name ?date ?tmdb ${awardQid ? '?awarded' : ''} WHERE {
        VALUES ?item { ${values} }
        OPTIONAL { ?item wdt:P4947 ?tmdb . }
        OPTIONAL { ?item wdt:P577 ?date . }
        ${awardClause}
        OPTIONAL { ?item rdfs:label ?name . FILTER(LANG(?name) = "en") }
      }`);

    const byQid = new Map();
    for (const row of rows) {
      const qid = row.item.value.split('/').pop();
      const entry = byQid.get(qid) ?? { qid, title: null, year: null, award_year: null, tmdb_id: null };
      if (row.tmdb?.value && !entry.tmdb_id) entry.tmdb_id = Number(row.tmdb.value);
      if (row.name?.value && !entry.title) entry.title = row.name.value;
      if (row.date?.value) {
        const year = Number(row.date.value.slice(0, 4));
        if (Number.isInteger(year) && (entry.year === null || year < entry.year)) entry.year = year;
      }
      if (row.awarded?.value && entry.award_year === null) {
        const awarded = Number(row.awarded.value.slice(0, 4));
        if (Number.isInteger(awarded)) entry.award_year = awarded;
      }
      byQid.set(qid, entry);
    }
    entries.push(...byQid.values());
    if (i + 120 < qids.length) await sleep(1200);
  }
  return entries;
}

/**
 * Award winners taken from a Wikipedia category rather than Wikidata's P166.
 *
 * For the national awards, Wikidata's award-received data is badly incomplete —
 * measured at 32 films for BAFTA Best Film, 26 for the César and 12 for the
 * Goya, against many decades of ceremonies. The language Wikipedias curate
 * their own awards properly, and a category is already exactly the list we
 * want, so this walks the pipeline above and yields 79 / 51 / 41 films at
 * 98-100% TMDB coverage.
 *
 * The category also contains the award's own article ("BAFTA Award for Best
 * Film"), which naturally drops out for having no TMDB id.
 */
// --- Ceremony years -------------------------------------------------------
//
// The category route gives us the winners but not when they won: award_year
// comes from a P585 qualifier on the film's award statement, which is thin for
// exactly these three awards (28-39%) — the same sparseness that made the
// category route necessary.
//
// The fix is to read the award's own article for WHO won at WHICH ceremony,
// then take the year from the ceremony's Wikidata item. Neither half is
// guessed. Two structural routes were tried first and both looked like dead
// ends on their own: ceremony items carry a date but no winner, and there are
// no per-ceremony categories. Together they are the answer.
//
// What NOT to do — and this took a wrong turn to learn: do not read the year
// printed in the article. Two of the three editions tabulate by year-of-films
// rather than year-of-ceremony, and the offset is not constant. The 1st BAFTAs
// were held in 1949 and honoured 1947 releases, a gap of two. Taking the
// printed year would write confidently wrong ceremony years, which is exactly
// why deriving from the release year was rejected in the first place.

const BOLD_ITALIC_FILM = /'''''\[\[(?!Fichier:|File:|Image:|Catégorie:|Category:)([^\]|#]+?)(?:\|([^\]]*))?\]\]/;

/**
 * How each edition announces a ceremony. Group 1 must capture the ceremony's
 * article title — never a year off the page.
 */
export const CEREMONY_ANCHORS = {
  // Winners are single-"*" list items; nominees use "**". A LOOKAHEAD is what
  // rejects a nominee, and consuming that character instead was the bug: the
  // two newest lines are written "*[[50e cérémonie…" with no space after the
  // bullet, so [^*\n] ate the first "[" and the "[[" it then looked for was no
  // longer there. Two ceremonies went missing and the run still reported
  // success, because the only loud path here is parsing NOTHING — an award
  // list grows by one film a year, so no proportional guard can see 49 of 51.
  cesar: /^\*(?!\*).*?\[\[([^\]|\n]*?cérémonie[^\]|\n]*?)\|[^\]\n]*\]\]/gim,
  // The year cell rowspans the winner and its nominees.
  bafta: /\{\{center\|'''\d{4}'''.*?\[\[([^\]|\n]*?British Academy Film Awards)(?:\|[^\]\n]*)?\]\]/g,
  // A full-width header row introduces each ceremony.
  goya: /!\s*colspan=[^|\n]*\|\s*'''\[\[(Anexo:[^\]|\n]*?edición de los Premios Goya)\|[^\]\n]*\]\]'''/g,
};

/**
 * [{ ceremonyPage, winnerPage }] from an award article, in article order.
 *
 * A ceremony's block runs from its anchor to the next one, and the winner is
 * the first BOLD-ITALIC film link inside it. That marker is the one thing all
 * three editions genuinely share — the nominees around it are never bold-italic.
 */
export function parseCeremonyWinners(wikitext, anchor) {
  const re = new RegExp(anchor.source, anchor.flags);
  const anchors = [...wikitext.matchAll(re)].map((m) => ({ page: m[1].trim(), at: m.index }));

  const seen = new Set();
  const pairs = [];
  for (let i = 0; i < anchors.length; i += 1) {
    const end = i + 1 < anchors.length ? anchors[i + 1].at : wikitext.length;
    const winner = BOLD_ITALIC_FILM.exec(wikitext.slice(anchors[i].at, end));
    if (!winner) continue;
    const winnerPage = winner[1].trim();
    // First occurrence wins: a film re-listed in a "most awarded" summary table
    // must not overwrite the ceremony it actually won at.
    if (seen.has(winnerPage)) continue;
    seen.add(winnerPage);
    pairs.push({ ceremonyPage: anchors[i].page, winnerPage });
  }
  return pairs;
}

/** Ceremony QIDs -> year, from P585. */
async function ceremonyYearByQid(qids) {
  const years = new Map();
  for (let i = 0; i < qids.length; i += 100) {
    const values = qids.slice(i, i + 100).map((q) => `wd:${q}`).join(' ');
    const rows = await sparql(`SELECT ?item ?date WHERE { VALUES ?item { ${values} } ?item wdt:P585 ?date }`);
    for (const row of rows) {
      const qid = row.item.value.split('/').pop();
      const year = Number(row.date.value.slice(0, 4));
      // Earliest wins: a few ceremonies carry more than one point-in-time.
      if (Number.isInteger(year) && (!years.has(qid) || year < years.get(qid))) years.set(qid, year);
    }
    if (i + 100 < qids.length) await sleep(1200);
  }
  return years;
}

/** Map of tmdb_id -> ceremony year, for one award's article. */
async function fetchCeremonyYears(lang, article, anchorKey) {
  const wikitext = await fetchWikitext(lang, article);
  if (!wikitext) {
    console.log(`\n  ⚠️  ${article}: could not be fetched — award years left as they are`);
    return new Map();
  }
  const pairs = parseCeremonyWinners(wikitext, CEREMONY_ANCHORS[anchorKey]);
  if (pairs.length === 0) {
    console.log(`\n  ⚠️  ${article}: no ceremonies parsed — the article layout probably changed`);
    return new Map();
  }

  const ceremonyQid = await titlesToQidMap(lang, [...new Set(pairs.map((p) => p.ceremonyPage))]);
  const years = await ceremonyYearByQid([...new Set(ceremonyQid.values())]);
  const filmQid = await titlesToQidMap(lang, [...new Set(pairs.map((p) => p.winnerPage))]);
  const films = await qidsToFilms([...new Set(filmQid.values())]);
  const byQid = new Map(films.map((film) => [film.qid, film]));

  const byTmdb = new Map();
  let rejected = 0;
  for (const { ceremonyPage, winnerPage } of pairs) {
    const year = years.get(ceremonyQid.get(ceremonyPage));
    const film = byQid.get(filmQid.get(winnerPage));
    if (!year || !film?.tmdb_id) continue;
    // Sanity check, because the whole point of this route over a derived year
    // is a specific TRUE fact: a ceremony sits 0-3 years after the release.
    // Anything outside that is a mis-parse and is dropped rather than written.
    if (film.year && (year - film.year < 0 || year - film.year > 3)) {
      rejected += 1;
      console.log(`\n  ⚠️  ${winnerPage}: released ${film.year} but ceremony ${year} — rejected`);
      continue;
    }
    byTmdb.set(film.tmdb_id, year);
  }
  console.log(`\n  ${byTmdb.size} ceremony year(s) from ${article}${rejected ? ` (${rejected} rejected)` : ''}`);
  return byTmdb;
}

async function fetchWikipediaCategoryAward(lang, category, awardQid, meta) {
  const titles = await fetchCategoryMembers(lang, category);
  const qids = await titlesToQids(lang, titles);
  const entries = await qidsToFilms(qids, { awardQid });

  // Fill in the ceremony years the category route cannot supply on its own.
  const ceremonyYears = meta.article
    ? await fetchCeremonyYears(lang, meta.article, meta.anchor)
    : new Map();

  const films = entries
    // No TMDB id means either the award's own article or a film TMDB doesn't
    // carry; either way there's nothing to draw, and the id is the whole point
    // of taking this route.
    .filter((entry) => entry.tmdb_id && entry.title)
    .filter((entry) => entry.year === null || entry.year <= THIS_YEAR)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title))
    .map(({ qid, ...entry }) => {
      const fromCeremony = ceremonyYears.get(entry.tmdb_id);
      // The ceremony's own date WINS over the film's P585 qualifier where they
      // differ. The qualifier is inconsistently populated — measured, 13 of the
      // existing values recorded the film's year rather than the ceremony's
      // (Schindler's List as 1993 against the 47th BAFTAs held in 1994) —
      // whereas a ceremony item's date is the ceremony by definition.
      return fromCeremony ? { ...entry, award_year: fromCeremony } : entry;
    });

  const { article, anchor, ...rest } = meta;
  return { tags: ['awards'], category: 'awards', ...rest, entries: films };
}

// --- Box office -----------------------------------------------------------
//
// fr.wikipedia keeps one "Box-office France <year>" article per year, verified
// present for all 82 years 1945-2026 with no gaps. Each carries a wikitable of
// that year's releases above the page's own admissions threshold (usually one
// million), with the film title as a wikilink — so identity goes through the
// QID, never through title matching.
//
// The all-time page was rejected as the source: it is cumulative and dominated
// by recent Hollywood, which is exactly what this list exists NOT to be. See
// BACKLOG.md for the measurement.

const BOX_OFFICE_FIRST_YEAR = 1945;

// Column headers vary across the corpus. These were read off a survey of all 82
// pages rather than guessed, which is why "Box-Office France" appears twice —
// the capitalisation genuinely changes in 2013.
const BOX_OFFICE_COLUMNS = {
  title: ['titre', 'film'],
  admissions: ['entrées', 'entrees', 'box-office france', 'box office france', 'spectateurs'],
};

const ADMISSIONS_TEMPLATE = /\{\{\s*(?:unité|nombre|formatnum:)\s*\|?\s*([\d][\d\s .,  ]*)/i;
// Not (?:Fichier|File) alone: the pre-1970s pages use "Image:", and missing
// that left a third of all rows looking as though they had no country.
const FILM_LINK = /\[\[(?!Fichier:|File:|Image:|Catégorie:|Category:)([^\]|#]+?)(?:\|([^\]]*))?\]\]/;

function normalizeHeaderCell(cell) {
  return cell
    // Footnotes ride ON the header: `Entrées<ref>Selon les sites…</ref>`.
    // Stripping only the tags leaves the footnote TEXT glued to the column
    // name, which no longer matches "entrées" — that silently emptied 1976-1982
    // once matching was tightened to exact.
    .replace(/<ref[\s\S]*?(?:\/>|<\/ref>)/gi, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/\b(?:scope|style|width|align|colspan|rowspan|class|bgcolor|data-sort-type)\s*=\s*"?[^"|\s]*"?/gi, ' ')
    .replace(/'''/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Splits one wikitable row into cells, handling both `| a || b` and
 * one-cell-per-line.
 *
 * Each cell is tagged with whether it came from `!` (header) markup. Counting
 * header LINES instead would misread the single-line form
 * `! Rang !! Titre !! Entrées` as one cell and skip the table — that form does
 * not appear anywhere in the current 82 pages, but it is perfectly valid
 * wikitable syntax, so relying on its absence would be relying on a formatting
 * convention nobody promised us.
 */
function splitRowCells(rowText) {
  const cells = [];
  for (const line of rowText.split('\n')) {
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('!');
    // `|+` is the table CAPTION, not a cell. On the 2013+ pages the header row
    // follows the caption with no `|-` between them, so counting it as a cell
    // shifted every column index by one — which did not drop rows, it read the
    // WRONG COLUMN and reported 2022's Avatar at 2.7M against a real 14.0M.
    if (trimmed.startsWith('|+')) continue;
    if (!trimmed.startsWith('|') && !isHeader) {
      // A ref or template spilling onto its own line belongs to the cell above.
      if (cells.length) cells[cells.length - 1].text += `\n${line}`;
      continue;
    }

    const body = trimmed.replace(/^[|!]+/, '');
    let depth = 0;
    let current = '';
    for (let i = 0; i < body.length; i += 1) {
      const pair = body.slice(i, i + 2);
      if (pair === '[[' || pair === '{{') { depth += 1; current += pair; i += 1; continue; }
      if (pair === ']]' || pair === '}}') { depth -= 1; current += pair; i += 1; continue; }
      if (depth === 0 && (pair === '||' || pair === '!!')) { cells.push({ text: current, isHeader }); current = ''; i += 1; continue; }
      current += body[i];
    }
    cells.push({ text: current, isHeader });
  }

  // A `style="…" |` prefix inside a single cell is markup, not content.
  return cells.map((cell) => {
    const prefix = /^[^|[{]*?(?:scope|style|width|align|colspan|rowspan|class|bgcolor)\s*=\s*[^|]*\|(?!\|)/i.exec(cell.text);
    return { text: (prefix ? cell.text.slice(prefix[0].length) : cell.text).trim(), isHeader: cell.isHeader };
  });
}

export function parseAdmissions(cell) {
  // Strip everything that contains digits but is NOT the figure, before either
  // branch. External links are the dangerous one: a citation like
  // `[http://www.boxofficestory.com/paris-1972-c23262779/2]` handed the bare
  // fallback a 23-million "admissions" count, which then outranked every real
  // film in the list — three different films all landed on the same impossible
  // number, which is what gave it away.
  const cleaned = cell
    .replace(/<ref[\s\S]*?(?:\/>|<\/ref>)/gi, ' ')
    .replace(/\[https?:\/\/[^\]]*\]/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ');

  const templated = ADMISSIONS_TEMPLATE.exec(cleaned);
  if (templated) return Number(templated[1].replace(/[\s.,\u00a0\u202f]/g, ''));

  // The 2013+ pages write the figure bare ("10 830 209"). Anchor it to the whole
  // cell so a number embedded in prose is never mistaken for the count.
  const bare = /^\D{0,3}(\d[\d\s\u00a0\u202f]{4,}\d)\D{0,12}$/.exec(cleaned.trim());
  return bare ? Number(bare[1].replace(/[\s\u00a0\u202f]/g, '')) : null;
}

/**
 * Every film row on one year's page.
 *
 * Driven by each table's own header row, NEVER by "the first wikilink" or "the
 * first number" in a row. A quick version built that way produced plausible
 * wrong answers rather than obvious failures: it listed the director
 * Jean-Marie Poiré as a film, and put Fantomas se déchaîne at 0.1M against a
 * real 4.5M.
 */
export function parseBoxOfficePage(wikitext) {
  const films = [];
  for (const table of wikitext.split(/\n\{\|/).slice(1)) {
    const body = table.split(/\n\|\}/)[0];
    let columns = null;

    for (const chunk of body.split(/\n\|-+[^\n]*/)) {
      const cells = splitRowCells(chunk);
      if (cells.length === 0) continue;
      const text = cells.map((cell) => cell.text);

      // The rank cell is often itself a header cell (`! scope=row | 1.`), so
      // one header cell does not make a header row — require at least two.
      if (cells.filter((cell) => cell.isHeader).length >= 2) {
        const candidate = {};
        text.forEach((raw, index) => {
          const cell = normalizeHeaderCell(raw);
          if (!cell) return;
          for (const [field, synonyms] of Object.entries(BOX_OFFICE_COLUMNS)) {
            // EXACT match, never startsWith. These pages carry a second table,
            // "Box-office parisien par semaine", whose header `Film {{n°}}1`
            // normalises to "film 1" — startsWith accepted that as the title
            // column, so a weekly Paris chart was parsed as the annual list.
            if (candidate[field] === undefined && synonyms.includes(cell)) {
              candidate[field] = index;
            }
          }
        });
        if (candidate.title !== undefined && candidate.admissions !== undefined) columns = candidate;
        continue;
      }
      if (!columns) continue;

      const link = FILM_LINK.exec(text[columns.title] ?? '');
      if (!link) continue;
      const admissions = parseAdmissions(text[columns.admissions] ?? '');
      if (admissions === null) continue;

      films.push({ page: link[1].trim(), title: (link[2] ?? link[1]).trim(), admissions });
    }
  }
  return films;
}

// --- Box office, United States --------------------------------------------
//
// en.wikipedia keeps one "List of <year> box office number-one films in the
// United States" per year. Every page carries a WEEKLY number-one table, which
// is not what this list wants: a film that sat at #2 for ten weeks is excluded
// while one that won a quiet January weekend is in. What it wants is the
// annual table, which most pages also carry.
//
// Surveyed across all 81 pages rather than guessed, and the survey disagreed
// with the plan in two ways worth knowing.
//
// FIRST, there are usually TWO annual tables and they measure different
// things:
//
//   Calendar Gross    what a film earned DURING that calendar year, whenever
//                     it came out. Carries Actor(s)/Director(s) columns.
//   In-Year Release   films RELEASED that year, by domestic gross.
//
// A December release earns most of its money in January, so the two rank
// differently and neither is wrong — they answer different questions. This
// list takes the release-year table, because that is the rule Box-office
// France already follows and a list has to mean one thing. Calendar Gross is
// rejected by name.
//
// SECOND, the gaps are wider than recorded: 1946, 1948, 1975, 1976, 1977 and
// 1979 carry no annual table at all, only the weekly one. Six years, not the
// two the roadmap listed. Verified by reading those pages, not inferred from a
// parser returning nothing.
//
// Older pages (through the 1970s) use neither section name and simply say
// "Highest-grossing films". 1969 and 1970 put TWO tables under that heading —
// a 25-row gross chart and the 10-row Variety rental chart — so the section
// name alone cannot choose, and the money column breaks the tie.
const US_BOX_OFFICE_FIRST_YEAR = 1946;

// Where the number-one pages start carrying an "In-Year Release" section, and
// therefore where this list switches source. Verified rather than assumed:
// 1981's page has no such section, 1982's has, and the survey counted exactly
// 45 of them across the corpus — which is 1982 to 2026 inclusive.
//
// The switch exists because the two sources measure different things and only
// one of them is available for the whole range. Before 1982 the number-one
// pages carry a CALENDAR-year chart: 1974's top five are The Exorcist, The
// Sting, Papillon, Serpico and American Graffiti, every one a 1973 release.
// Ranking those against a modern in-year-release chart would put two meanings
// in one column, which is the same objection that rejects Calendar Gross for
// the years where both exist. `<year> in film` publishes release-year charts
// for the whole early range, so the list can mean one thing throughout.
const US_IN_YEAR_FIRST = 1982;

// Case genuinely varies across the corpus ("In-Year Release" 41 times,
// "In-year release" 4), so these are compared lowercased.
const US_SECTION_REJECT = ['calendar gross'];
const US_SECTION_ACCEPT = ['in-year release', 'highest-grossing films', 'highest grossing films'];

// Preference order, best first, and every value here was read off the corpus
// rather than guessed — the first attempt matched only "gross" and "rental"
// and silently lost 1968-1974, whose pages write the unit into the header as
// "Gross ($)" and "Rental ($)".
//
// The order carries a decision as well as a spelling. 1969 and 1970 offer both
// a 25-row "Gross ($)" chart and the 10-row Variety "Rental ($)" one; rental
// ranks higher here so those years take the same chart as the rest of that
// era, rather than switching measure for two years in the middle of it.
const US_MONEY_COLUMNS = ['domestic gross', 'rental', 'rental ($)', 'gross ($)', 'gross'];

const US_TITLE_COLUMNS = ['title', 'film'];

// One page writes `!| Domestic gross`, leaving a pipe on the front of the cell
// once the row is split. Everything else is handled by normalizeHeaderCell.
const usHeaderCell = (raw) => normalizeHeaderCell(raw).replace(/^[|\s]+/, '');

/**
 * The annual chart from one US year page, or [] when the page has none.
 *
 * Returns rows in page order carrying the page's own rank, because the rank is
 * the only figure this list keeps: the money itself is deliberately discarded.
 * Rentals are a distributor's share and grosses are a box-office take, and the
 * two swap over around 1980 — so the numbers are not comparable across the
 * corpus even before inflation. Position within a year is, because within one
 * year one unit is in use.
 */
export function parseUsBoxOfficePage(wikitext) {
  const candidates = [];
  let section = '';

  // Walk the page in order so each table knows the heading above it.
  const parts = wikitext.split(/\n(?==+[^=\n]+=+\s*$)/m);
  for (const part of parts) {
    const heading = /^(=+)\s*(.+?)\s*\1\s*$/m.exec(part);
    if (heading) section = heading[2].toLowerCase().trim();
    if (US_SECTION_REJECT.includes(section)) continue;
    if (!US_SECTION_ACCEPT.includes(section)) continue;

    for (const table of part.split(/\n\{\|/).slice(1)) {
      const body = table.split(/\n\|\}/)[0];
      let columns = null;
      const rows = [];

      for (const chunk of body.split(/\n\|-+[^\n]*/)) {
        const cells = splitRowCells(chunk);
        if (cells.length === 0) continue;
        const text = cells.map((cell) => cell.text);

        if (cells.filter((cell) => cell.isHeader).length >= 2) {
          const candidate = {};
          text.forEach((raw, index) => {
            const cell = usHeaderCell(raw);
            if (!cell) return;
            if (candidate.title === undefined && US_TITLE_COLUMNS.includes(cell)) {
              candidate.title = index;
            }
            // Exact match, and the earliest-listed synonym wins, so a table
            // carrying both "gross" and "domestic gross" is scored on the
            // better one rather than on whichever column came first.
            const money = US_MONEY_COLUMNS.indexOf(cell);
            if (money !== -1 && (candidate.money === undefined || money < candidate.money)) {
              candidate.money = money;
            }
          });
          if (candidate.title !== undefined && candidate.money !== undefined) columns = candidate;
          continue;
        }
        if (!columns) continue;

        const link = FILM_LINK.exec(text[columns.title] ?? '');
        if (!link) continue;
        rows.push({ page: link[1].trim(), title: (link[2] ?? link[1]).trim() });
      }

      if (columns && rows.length) candidates.push({ money: columns.money, rows });
    }
  }

  if (candidates.length === 0) return [];
  // Lowest money index wins: domestic gross, then rental, then bare gross.
  candidates.sort((a, b) => a.money - b.money);
  return candidates[0].rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/**
 * The Box-office France list: francophone films that French audiences actually
 * went to see, ranked by admissions.
 *
 * "Francophone" is decided by TMDB's `original_language`, NOT by the country
 * column on the page. Measured across all 82 years, a country rule admitted 69
 * films beyond French-produced ones and they were almost all Hollywood
 * blockbusters carrying Canadian co-production credits (Dune, X-Men 3, Man of
 * Steel). `original_language` reads the thing itself, agrees with the app's own
 * language filter by construction, and — verified — still keeps the
 * English-DIALOGUE French productions (Léon, Le Cinquième Élément, Le Grand
 * Bleu), because TMDB tracks the production's origin language rather than the
 * spoken one.
 */
async function fetchBoxOfficeFrance(meta) {
  const lastYear = lastSettledYear();
  const perYear = [];
  const best = new Map();

  for (let year = BOX_OFFICE_FIRST_YEAR; year <= lastYear; year += 1) {
    let rows = [];
    try {
      const wikitext = await fetchWikitext('fr', `Box-office France ${year}`);
      if (wikitext) rows = parseBoxOfficePage(wikitext);
    } catch (error) {
      // A rate limit is not a bad page, it is "slow down" — skipping the year
      // would silently drop its films and still report success. Only genuine
      // page/layout problems are survivable here; throttling aborts the source
      // so the run can be repeated rather than half-written.
      if (error instanceof RateLimited) throw error;
      // One bad year must not cost the other 81. Warn loudly and carry on.
      console.log(`\n  ⚠️  ${year}: ${error.message} — skipped`);
    }
    perYear.push({ year, count: rows.length });

    for (const row of rows) {
      // The same film can chart in more than one year (re-releases). Keep its
      // best showing rather than double-counting it.
      const previous = best.get(row.page);
      if (!previous || row.admissions > previous.admissions) best.set(row.page, { ...row, year });
    }
  }

  // A year that parses to far fewer rows than its neighbours means the page
  // layout moved, not that cinema stopped. Warn — never fail — so a single
  // restyled page is visible without costing the whole run. The seed-level
  // shrink guard still refuses a mass failure at write time.
  const counts = perYear.map((entry) => entry.count).sort((a, b) => a - b);
  const median = counts[counts.length >> 1] ?? 0;
  const floor = Math.max(3, Math.floor(median * 0.25));
  const thin = perYear.filter((entry) => entry.count < floor);
  if (thin.length) {
    console.log(
      `\n  ⚠️  ${thin.length} year(s) parsed unusually thin (under ${floor} rows, median ${median}): ` +
        thin.map((entry) => `${entry.year}:${entry.count}`).join(' '),
    );
  }

  // Wikipedia page title -> QID -> TMDB id, the same pipeline the award lists
  // use, so there is no fuzzy title matching anywhere.
  const pages = [...best.keys()];
  const qidByTitle = await titlesToQidMap('fr', pages);
  const films = await qidsToFilms([...new Set(qidByTitle.values())]);
  const byQid = new Map(films.map((film) => [film.qid, film]));

  const candidates = [];
  for (const page of pages) {
    const film = byQid.get(qidByTitle.get(page));
    if (!film?.tmdb_id) continue;
    const row = best.get(page);
    candidates.push({ title: film.title ?? row.title, year: film.year ?? row.year, tmdb_id: film.tmdb_id, admissions: row.admissions });
  }

  // The language cut. Needs TMDB, so this source is skipped without credentials
  // exactly as the TMDB top-rated one is.
  const { hasTmdbCredentials } = await import('../server/config.js');
  if (!hasTmdbCredentials()) {
    console.log('\n  ⚠️  no TMDB credentials — cannot apply the language filter');
    return null;
  }
  const { getMovie } = await import('../server/tmdb.js');

  const languages = await originalLanguages(
    candidates.map((candidate) => candidate.tmdb_id),
    getMovie,
    { log: (message) => process.stdout.write(message) },
  );

  const entries = candidates
    .filter((candidate) => languages.get(candidate.tmdb_id) === 'fr')
    .map(({ title, year, tmdb_id, admissions }) => ({ title, year, tmdb_id, admissions }));

  // Ranked by admissions across the whole list, not within each year: with
  // per-year ranks topping out around 60, a "top 100" cut would select
  // everything and the Top-N control would do nothing. Global ranks also match
  // how TSPDT and Sight & Sound behave, so "top 100" means the same kind of
  // thing on every ranked list.
  entries.sort((a, b) => b.admissions - a.admissions);
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
    delete entry.admissions;
  });

  return { tags: ['box-office'], category: 'box-office', ...meta, entries };
}

/**
 * The fallback for years whose number-one page carries no annual chart.
 *
 * `<year> in film` was rejected as the MAIN source for a stated reason: its
 * tables switch to worldwide gross in 1988, so the modern half is not a US
 * list at all. That objection does not reach the years that need it — every
 * gap is 1979 or earlier — and the pages label the measure in the heading, so
 * this can be checked rather than assumed.
 *
 * **The section name must claim the United States.** 1946 and 1948 say
 * "Top-grossing films (U.S.)", 1976 and 1977 "Highest-grossing films (U.S.)".
 * 1975's only chart is headed "Worldwide gross" and is therefore refused by
 * the same rule that accepts the others, rather than by a hardcoded exception
 * — which is the point: the rule is what keeps the list meaning one thing, and
 * a rule you can state is one a later reader can check.
 */
export function parseYearInFilmPage(wikitext) {
  let section = '';
  for (const part of wikitext.split(/\n(?==+[^=\n]+=+\s*$)/m)) {
    const heading = /^(=+)\s*(.+?)\s*\1\s*$/m.exec(part);
    if (heading) section = heading[2].toLowerCase().trim();
    // Reject before accept, and the order is load-bearing: 1966 heads its two
    // tables "North America" and "Outside North America", so a plain substring
    // test for the region would take the international chart as well.
    if (/outside|international|worldwide|overseas/.test(section)) continue;
    if (!/\(u\.s\.\)|north america|united states/.test(section)) continue;

    for (const table of part.split(/\n\{\|/).slice(1)) {
      const body = table.split(/\n\|\}/)[0];
      let columns = null;
      const rows = [];

      for (const chunk of body.split(/\n\|-+[^\n]*/)) {
        const cells = splitRowCells(chunk);
        if (cells.length === 0) continue;
        const text = cells.map((cell) => cell.text);

        if (cells.filter((cell) => cell.isHeader).length >= 2) {
          const candidate = {};
          text.forEach((raw, index) => {
            const cell = usHeaderCell(raw);
            if (!cell) return;
            if (candidate.title === undefined && US_TITLE_COLUMNS.includes(cell)) {
              candidate.title = index;
            }
            if (candidate.money === undefined && US_FALLBACK_MONEY_COLUMNS.includes(cell)) {
              candidate.money = index;
            }
          });
          if (candidate.title !== undefined && candidate.money !== undefined) columns = candidate;
          continue;
        }
        if (!columns) continue;

        const link = FILM_LINK.exec(text[columns.title] ?? '');
        if (!link) continue;
        rows.push({ page: link[1].trim(), title: (link[2] ?? link[1]).trim() });
      }

      if (columns && rows.length) return rows.map((row, index) => ({ ...row, rank: index + 1 }));
    }
  }
  return [];
}

// Read off the four pages that need it: 1946 and 1948 and 1976 say "Domestic
// rentals", 1977 says "Box-office gross".
const US_FALLBACK_MONEY_COLUMNS = ['domestic rentals', 'box-office gross', 'domestic gross', 'rental'];

/**
 * The Box-office US list: what America actually turned out for, year by year.
 *
 * No language or country cut, unlike France. This list exists to answer "was
 * this film big in America", and a Hollywood blockbuster is the most honest
 * possible answer to that — filtering it out would leave the axis measuring
 * something else entirely.
 *
 * **`overall_rank` is deliberately not written, and that is a departure from
 * France and Spain.** Both of those rank on ADMISSIONS, which count people and
 * are therefore comparable across eighty years. This source has only money:
 * rentals until about 1980 and domestic gross after, neither adjusted for
 * inflation. An overall rank would sort 2019 above 1975 for reasons that have
 * nothing to do with how many people went, and would do it invisibly, under a
 * column name that promises otherwise. Ranking within the year is the whole of
 * what the data supports, so it is the whole of what gets stored — the Top-N
 * control reads `rank`, which means "the top five of each year" still works.
 */
async function fetchBoxOfficeUS(meta) {
  const perYear = [];
  const best = new Map();

  for (let year = US_BOX_OFFICE_FIRST_YEAR; year <= lastSettledYear(); year += 1) {
    let rows = [];
    try {
      if (year < US_IN_YEAR_FIRST) {
        // Release-year charts, from the article that publishes them as such:
        // "The top ten 1975 released films by box office gross in North
        // America are as follows".
        const wikitext = await fetchWikitext('en', `${year} in film`);
        if (wikitext) rows = parseYearInFilmPage(wikitext);
      } else {
        const wikitext = await fetchWikitext(
          'en',
          `List of ${year} box office number-one films in the United States`,
        );
        if (wikitext) rows = parseUsBoxOfficePage(wikitext);
      }
    } catch (error) {
      if (error instanceof RateLimited) throw error;
      console.log(`\n  ⚠️  ${year}: ${error.message} — skipped`);
    }
    perYear.push({ year, count: rows.length });

    for (const row of rows) {
      // A re-release charts again in a later year. Keep the better showing,
      // matching France — the same film should not appear twice.
      const previous = best.get(row.page);
      if (!previous || row.rank < previous.rank) best.set(row.page, { ...row, year });
    }
  }

  // Six years genuinely have no annual table, so a zero there is expected and
  // must not be reported as a fault. Anything ELSE at zero means the layout
  // moved, which is worth saying out loud.
  // Every year in range should now yield a chart. There is no known-empty
  // list any more, which is the point of the restructure: a year that comes
  // back empty is a layout change, not an expected hole.
  const KNOWN_EMPTY = new Set();
  const unexpectedlyEmpty = perYear.filter((e) => e.count === 0 && !KNOWN_EMPTY.has(e.year));
  if (unexpectedlyEmpty.length) {
    console.log(
      `\n  ⚠️  ${unexpectedlyEmpty.length} year(s) parsed to nothing and were expected to have a ` +
        `table: ${unexpectedlyEmpty.map((e) => e.year).join(' ')}`,
    );
  }

  const pages = [...best.keys()];
  const qidByTitle = await titlesToQidMap('en', pages);
  const films = await qidsToFilms([...new Set(qidByTitle.values())]);
  const byQid = new Map(films.map((film) => [film.qid, film]));

  const entries = [];
  for (const page of pages) {
    const film = byQid.get(qidByTitle.get(page));
    if (!film?.tmdb_id) continue;
    const row = best.get(page);
    entries.push({
      title: film.title ?? row.title,
      year: film.year ?? row.year,
      tmdb_id: film.tmdb_id,
      rank: row.rank,
    });
  }

  entries.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.rank - b.rank);
  return { tags: ['box-office'], category: 'box-office', ...meta, entries };
}

async function fetchWikidataSeries(seriesQid, meta) {
  const rows = await sparql(`
    SELECT ?film ?name ?date ?tmdb WHERE {
      ?film wdt:P179 wd:${seriesQid} .
      ?film rdfs:label ?name . FILTER(LANG(?name) = "en")
      OPTIONAL { ?film wdt:P577 ?date . }
      OPTIONAL { ?film wdt:P4947 ?tmdb . }
    }`);

  const entries = foldWikidataRows(rows)
    // Announced-but-unreleased sequels are on the series item too; they have no
    // release year yet, or one in the future, and would only clutter a draw.
    .filter((entry) => entry.year !== null && entry.year <= THIS_YEAR)
    .sort((a, b) => a.year - b.year);

  // `meta.source_url` is supplied by each call site — the Wikidata entity page
  // itself is just metadata about the series (no film list to browse), so it
  // is never the right link here even though it's where the data came from.
  return { ...meta, entries };
}

// --- Sight & Sound (BFI) --------------------------------------------------

async function fetchSightAndSound() {
  const html = await getText('https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time');

  const entries = [];
  for (const article of html.match(/<article\b[\s\S]*?<\/article>/g) ?? []) {
    const title = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(article);
    const rank = /ResultsPage__Rank[^>]*>(?:=<!-- -->)?(\d+)/.exec(article);
    const year = /ResultsPage__P[^>]*>(\d{4})/.exec(article);
    const director = /Directed by <!-- -->([\s\S]*?)<\/p>/.exec(article);
    if (!title || !rank) continue;

    entries.push({
      title: collapse(decodeEntities(stripTags(title[1]))),
      year: year ? Number(year[1]) : null,
      rank: Number(rank[1]),
      director: director ? collapse(decodeEntities(stripTags(director[1]))) : null,
    });
  }

  if (entries.length < 100) {
    throw new Error(`BFI page yielded only ${entries.length} films — the page layout probably changed`);
  }

  entries.sort((a, b) => a.rank - b.rank);
  return {
    slug: 'sight-and-sound',
    name: 'Sight & Sound Greatest Films (2022 critics’ poll)',
    tags: ['canon'],
    category: 'canon',
    source: 'British Film Institute — Sight and Sound 2022 critics’ poll',
    source_url: 'https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time',
    note: "Wikipedia lists only the top 10 in prose; the BFI's own page carries the full ranking.",
    entries,
  };
}

// --- TSPDT ----------------------------------------------------------------

async function fetchTspdt() {
  const html = await getText('https://www.theyshootpictures.com/gf1000_all1000films.htm');

  const text = collapse(
    decodeEntities(
      stripTags(
        html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, ''),
      ),
    ),
  );

  // "12. (13) JEANNE DIELMAN… (Chantal Akerman, 1975, Belgium-France, 201m, Col)"
  // Titles may contain their own brackets — HISTOIRE(S) DU CINÉMA — and years may
  // be ranges, so the year group tolerates a "1988-98" style span.
  const pattern =
    /(\d{1,4})\.\s*\((?:\d+|-+|new|n\/a)\)\s*(.+?)\s*\(([^()]*?),\s*(\d{4})(?:\s*[-–]\s*\d{2,4})?\s*[,)]/gi;

  const entries = [];
  for (const match of text.matchAll(pattern)) {
    entries.push({
      title: collapse(match[2]),
      year: Number(match[4]),
      rank: Number(match[1]),
      director: collapse(match[3]),
    });
  }

  if (entries.length < 900) {
    throw new Error(`TSPDT page yielded only ${entries.length} films — the page layout probably changed`);
  }

  entries.sort((a, b) => a.rank - b.rank);
  return {
    slug: 'tspdt-1000',
    name: 'TSPDT 1,000 Greatest Films',
    tags: ['canon'],
    category: 'canon',
    source: "They Shoot Pictures, Don't They? — the list's publisher",
    source_url: 'https://www.theyshootpictures.com/gf1000_all1000films.htm',
    note: 'Not on Wikipedia in any form; sourced from the publisher. Titles are upper-case at source and are matched case-insensitively.',
    entries,
  };
}

// --- TMDB top rated -------------------------------------------------------

async function fetchTmdbTopRated() {
  const { config, hasTmdbCredentials } = await import('../server/config.js');
  if (!hasTmdbCredentials()) return null;

  const auth = config.tmdb.accessToken
    ? { headers: { authorization: `Bearer ${config.tmdb.accessToken}` } }
    : { key: config.tmdb.apiKey };

  const entries = [];
  for (let page = 1; page <= 5 && entries.length < 100; page += 1) {
    const url = new URL('https://api.themoviedb.org/3/movie/top_rated');
    url.searchParams.set('language', 'en-US');
    url.searchParams.set('page', String(page));
    if (auth.key) url.searchParams.set('api_key', auth.key);

    const body = await getText(url.toString(), auth.headers ?? {});
    for (const movie of JSON.parse(body).results ?? []) {
      entries.push({
        title: movie.title,
        year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
        tmdb_id: movie.id,
        rank: entries.length + 1,
      });
    }
  }

  return {
    slug: 'tmdb-top-rated',
    name: 'TMDB Top Rated 100',
    source: 'TMDB /movie/top_rated',
    source_url: 'https://www.themoviedb.org/movie/top-rated',
    note:
      'Stands in for the spec\'s "IMDb Top 100": the IMDb API is commercially priced and scraping IMDb is out, ' +
      'so an IMDb-ranked list has no legitimate source. This is labelled for what it actually is.',
    entries: entries.slice(0, 100),
  };
}

// --- Runner ---------------------------------------------------------------

const SOURCES = [
  { label: 'Criterion Collection', run: fetchCriterion },
  { label: 'Sight & Sound 2022', run: fetchSightAndSound },
  { label: 'TSPDT 1,000', run: fetchTspdt },
  {
    label: 'Disney Animated Canon',
    run: () =>
      fetchWikidataSeries('Q56070713', {
        slug: 'disney-animated-canon',
        tags: ['collection', 'family', 'animation'],
        category: 'collection',
        name: 'Disney Animated Canon',
        source: 'Wikidata — "Walt Disney Animation Studios feature film" series (Q56070713)',
        source_url: 'https://en.wikipedia.org/wiki/List_of_Walt_Disney_Animation_Studios_films',
        note: 'Unreleased announced titles are filtered out.',
      }),
  },
  {
    label: 'Studio Ghibli',
    run: () =>
      fetchWikidataSeries('Q104830727', {
        slug: 'studio-ghibli',
        tags: ['collection', 'family', 'animation'],
        category: 'collection',
        name: 'Studio Ghibli',
        source: 'Wikidata — "Studio Ghibli Feature Films" series (Q104830727)',
        source_url: 'https://en.wikipedia.org/wiki/List_of_Studio_Ghibli_works',
        note: 'Feature films only; the Wikipedia "works" page also lists pre-Ghibli staff credits.',
      }),
  },
  { label: 'TMDB Top Rated 100', run: fetchTmdbTopRated },

  {
    label: 'Box-office France',
    // 82 pages walked at ~0.7s each plus ~3,400 TMDB lookups, so this is by far
    // the slowest source. Run it on its own: `npm run fetch-seeds -- box-office`.
    minCount: 400,
    run: () =>
      fetchBoxOfficeFrance({
        slug: 'box-office-france',
        name: 'Box-office France',
        source: 'fr.wikipedia "Box-office France <year>", 1945-2026, resolved to TMDB ids via Wikidata',
        source_url: 'https://fr.wikipedia.org/wiki/Liste_des_plus_gros_succ%C3%A8s_du_box-office_en_France',
        note:
          'Admissions, not revenue, so ticket-price inflation never enters. Francophone films only, ' +
          'decided by TMDB original_language rather than the page\'s country column — a country rule ' +
          'admitted Hollywood blockbusters carrying Canadian co-production credits. Ranked by admissions.',
      }),
  },

  // --- Awards -------------------------------------------------------------
  //
  // TMDB carries no awards data at all (its "oscar" keyword tags 9 films), so
  // Wikidata is the only structured source. Each of these was measured against
  // the existing pool before being included — the point of an awards list is
  // the films it ADDS, not the label:
  //
  //     Golden Bear      86 films, 21% overlap  → 68 new
  //     Best Picture     98 films, 43% overlap  → 56 new
  //     Golden Lion      67 films, 40% overlap  → 40 new
  //     Best International 71 films, 45% overlap → 39 new
  //     Palme d'Or       83 films, 58% overlap  → 35 new
  //
  // BAFTA, César and Goya come from Wikipedia categories instead — see
  // fetchWikipediaCategoryAward for why (Wikidata's P166 has 32/26/12 films
  // for them; the categories have 79/51/41).
  //
  // NAMING. Every award list is "Ceremony — Prize", both halves in the
  // ceremony's own language:
  //
  //     Oscar — Best Picture          Cannes  — Palme d’Or
  //     BAFTA — Best Film             Venezia — Leone d’Oro
  //     César — Meilleur Film         Berlin  — Goldener Bär
  //
  // Left is the ceremony it comes from, right is which prize. There used to be
  // two grammars in this column — academies as "Body — Category" and festivals
  // as "Prize (City)" — which is what put "Golden Lion (Venice) 1987" next to
  // "César — Meilleur Film 1988" in the same overlay. Adding an award list
  // means picking a side of the dash, not inventing a shape.
  //
  // The `short_name` names the AWARD ITSELF, in the same language — which is
  // the LEFT of the dash for an academy (the statuette, or the body: Oscar,
  // César, Goya, BAFTA) and the RIGHT for a festival (the prize: Palme d’Or,
  // Leone d’Oro). So it is not derivable from the full name by any rule a
  // regex can hold, which is exactly why it is stored rather than parsed.
  //
  // What it is NOT is the ceremony: "Venezia" and "Cannes" are places, and a
  // card reading "Venezia 1987" would name where the film went rather than
  // what it won.
  {
    label: 'Oscar Best Picture',
    run: () =>
      fetchWikidataAward('Q102427', {
        slug: 'award-oscar-best-picture',
        short_name: 'Oscar',
        name: 'Oscar — Best Picture',
        source: 'Wikidata — award received (P166), Academy Award for Best Picture (Q102427)',
        source_url: 'https://en.wikipedia.org/wiki/Academy_Award_for_Best_Picture',
        note: 'Constrained to instance-of-film: the producers receive this award too, and without that constraint the query returns them alongside the films.',
      }),
  },
  {
    label: 'Oscar Best International',
    run: () =>
      fetchWikidataAward('Q105304', {
        slug: 'award-oscar-international',
        short_name: 'Oscar Intl.',
        name: 'Oscar — Best International Feature',
        source: 'Wikidata — award received (P166), Academy Award for Best International Feature Film (Q105304)',
        source_url: 'https://en.wikipedia.org/wiki/Academy_Award_for_Best_International_Feature_Film',
        note: 'Formerly Best Foreign Language Film; the Wikidata item covers both names.',
      }),
  },
  {
    label: 'Palme d’Or',
    run: () =>
      fetchWikidataAward('Q179808', {
        slug: 'award-palme-dor',
        short_name: 'Palme d’Or',
        name: 'Cannes — Palme d’Or',
        tags: ['awards', 'festivals'],
        source: 'Wikidata — award received (P166), Palme d’Or (Q179808)',
        source_url: 'https://en.wikipedia.org/wiki/Palme_d%27Or',
        note: 'The most redundant of the award lists against a canon-heavy library (58% already present) — included for the axis rather than the additions.',
      }),
  },
  {
    label: 'Box-office US',
    // 81 pages, one request each — as slow as the France source. Run it alone:
    // `npm run fetch-seeds -- box-office`.
    minCount: 500,
    run: () =>
      fetchBoxOfficeUS({
        slug: 'box-office-us',
        name: 'Box-office US',
        short_name: 'Box-office US',
        source:
          'en.wikipedia "List of <year> box office number-one films in the United States", ' +
          '1946-2026, annual chart only, resolved to TMDB ids via Wikidata',
        source_url:
          'https://en.wikipedia.org/wiki/List_of_2019_box_office_number-one_films_in_the_United_States',
        note:
          'Films RELEASED in a year, ranked by what they took in the US. Two sources, because ' +
          'neither covers the whole range: "<year> in film" through 1981, and the In-Year Release ' +
          'section of the number-one pages from 1982, which is where that section starts. The ' +
          'number-one pages own pre-1982 charts are CALENDAR-year and deliberately unused — 1974 ' +
          'tops out with The Exorcist, The Sting and Papillon, every one a 1973 release — because ' +
          'ranking those beside release-year charts would put two meanings in one column. The ' +
          'weekly number-one table is never used at all: it is a membership test, not a magnitude, ' +
          'so a film that sat at #2 all year would be missing while one that won a quiet January ' +
          'weekend would be in. Ranked WITHIN the year only, and carrying no overall rank: the ' +
          'source gives rentals before about 1980 and gross after, neither inflation-adjusted, so ' +
          'an all-time ranking would measure ticket prices rather than how many people went.',
      }),
  },
  {
    label: 'Cannes Grand Prix',
    minCount: 50,
    run: () =>
      fetchWikidataAward('Q844804', {
        slug: 'award-cannes-grand-prix',
        short_name: 'Grand Prix',
        name: 'Cannes — Grand Prix',
        tags: ['awards', 'festivals'],
        source: 'Wikidata — award received (P166), Cannes Film Festival Grand Prix (Q844804)',
        source_url: 'https://en.wikipedia.org/wiki/Grand_Prix_(Cannes_Film_Festival)',
        note:
          'The runner-up to the Palme d’Or, and a second bite at Cannes for films the ' +
          'Palme list cannot reach. Q844804 verified by counting films rather than by ' +
          'name: a label search for "Grand Prix" returns a 1982 video game first, and ' +
          'three other festivals also award a "grand prix". The name is historically ' +
          'overloaded — before 1955 and again in the 1960s the top prize at Cannes was ' +
          'itself called the Grand Prix — so treat an old entry here as "top prize of ' +
          'its year", not as a runner-up.',
      }),
  },
  {
    label: 'Golden Lion',
    run: () =>
      fetchWikidataAward('Q209459', {
        slug: 'award-golden-lion',
        short_name: 'Leone d’Oro',
        name: 'Venezia — Leone d’Oro',
        tags: ['awards', 'festivals'],
        source: 'Wikidata — award received (P166), Golden Lion (Q209459)',
        source_url: 'https://en.wikipedia.org/wiki/Golden_Lion',
      }),
  },
  {
    label: 'Golden Bear',
    run: () =>
      fetchWikidataAward('Q154590', {
        slug: 'award-golden-bear',
        short_name: 'Goldener Bär',
        name: 'Berlin — Goldener Bär',
        tags: ['awards', 'festivals'],
        source: 'Wikidata — award received (P166), Golden Bear (Q154590)',
        source_url: 'https://en.wikipedia.org/wiki/Golden_Bear',
        note: 'Q154590 is the Berlinale prize. Note that a plain search for "Golden Bear" returns a US training ship first (Q2512671) — the qid here is the award.',
      }),
  },

  // These three come from Wikipedia categories rather than Wikidata's P166,
  // which is badly incomplete for them. Each language Wikipedia curates its
  // own national award properly.
  {
    label: 'BAFTA Best Film',
    run: () =>
      fetchWikipediaCategoryAward('en', 'Category:Best Film BAFTA Award winners', 'Q139184', {
        slug: 'award-bafta-best-film',
        short_name: 'BAFTA',
        name: 'BAFTA — Best Film',
        article: 'BAFTA Award for Best Film',
        anchor: 'bafta',
        source: 'en.wikipedia category "Best Film BAFTA Award winners", resolved to TMDB ids via Wikidata',
        source_url: 'https://en.wikipedia.org/wiki/BAFTA_Award_for_Best_Film',
        note: "Wikidata's award-received data only covers 32 of these; the category covers 79.",
      }),
  },
  {
    label: 'César Best Film',
    run: () =>
      fetchWikipediaCategoryAward('fr', 'Catégorie:César du meilleur film', 'Q645595', {
        slug: 'award-cesar-best-film',
        short_name: 'César',
        name: 'César — Meilleur Film',
        article: 'César du meilleur film',
        anchor: 'cesar',
        source: 'fr.wikipedia category "César du meilleur film", resolved to TMDB ids via Wikidata',
        source_url: 'https://fr.wikipedia.org/wiki/C%C3%A9sar_du_meilleur_film',
        note: "Wikidata's award-received data only covers 26 of these; the French Wikipedia category covers 51.",
      }),
  },
  {
    label: 'Goya Best Film',
    run: () =>
      fetchWikipediaCategoryAward(
        'es',
        'Categoría:Películas ganadoras del Premio Goya a la mejor película',
        'Q1467554',
        {
          slug: 'award-goya-best-film',
          short_name: 'Goya',
          name: 'Goya — Mejor Película',
          article: 'Premio Goya a la mejor película',
          anchor: 'goya',
          source: 'es.wikipedia category "Películas ganadoras del Premio Goya a la mejor película", resolved to TMDB ids via Wikidata',
          source_url: 'https://es.wikipedia.org/wiki/Premio_Goya_a_la_mejor_pel%C3%ADcula',
          note: "Wikidata's award-received data only covers 12 of these; the Spanish Wikipedia category covers 41.",
        },
      ),
  },
];

/** The committed seed file for a slug, if there is one. */
async function readExisting(slug) {
  try {
    return JSON.parse(await readFile(join(SEEDS, `${slug}.json`), 'utf8'));
  } catch {
    return null; // First fetch of this list.
  }
}

// List-level keys a re-fetch must never silently drop. `tags` is here because
// it already happened: the payload below was written without it while every
// committed seed file carried one, so a fetch run quietly deleted the tags from
// the JSON. Nothing failed — seed.mjs only syncs tags when the key is present,
// so an existing database kept its stale values — and it only surfaced on the
// next FRESH install, where every list came up untagged and therefore every
// vibe resolved to an empty pool. seeds/studio-ghibli.json had already lost its
// tags this way before anyone noticed.
//
// Same shape of protection as the shrink guard below, one level up: that one
// watches the entries, this one watches the metadata around them.
const PRESERVED_KEYS = ['tags', 'category', 'name', 'short_name'];

export function droppedKeys(existing, payload) {
  if (!existing) return [];
  return PRESERVED_KEYS.filter((key) => {
    const had = existing[key];
    if (had === undefined || had === null) return false;
    if (Array.isArray(had) && had.length === 0) return false;
    const now = payload[key];
    return now === undefined || now === null || (Array.isArray(now) && now.length === 0);
  });
}

async function main() {
  await mkdir(SEEDS, { recursive: true });
  const only = process.argv.slice(2);
  let failures = 0;

  for (const source of SOURCES) {
    if (only.length && !only.some((arg) => source.label.toLowerCase().includes(arg.toLowerCase()))) {
      continue;
    }

    process.stdout.write(`${source.label.padEnd(24)} `);
    try {
      const list = await source.run();
      if (!list) {
        console.log('skipped (no TMDB credentials)');
        continue;
      }

      // A source that returns almost nothing is far more likely to be having a
      // bad day than to have genuinely lost 90% of its films. Without this the
      // script writes the truncated result, prints it as a success, and the
      // next seed shrinks the list. The Sight & Sound and TSPDT scrapers have
      // had their own thresholds from the start; this covers everything else,
      // including every future fetcher.
      const existing = await readExisting(list.slug);
      const existingCount = Number.isInteger(existing?.count) ? existing.count : null;
      const guardFloor = Math.max(source.minCount ?? 1, Math.ceil((existingCount ?? 0) * 0.5));
      if (list.entries.length < guardFloor) {
        failures += 1;
        console.log(
          `REFUSED — ${list.entries.length} films, expected at least ${guardFloor}` +
            (existingCount ? ` (previous run had ${existingCount})` : '') +
            '. Existing seed file left untouched.',
        );
        continue;
      }

      const payload = {
        name: list.name,
        // Both of these must be carried through: seed.mjs reads them to group
        // the list in the picker, and omitting either here would silently strip
        // it from an existing seed file on the next fetch run. `tags` is the
        // live one — see PRESERVED_KEYS — and `category` is the legacy column
        // it replaced, kept in sync only so an old database still migrates.
        ...(list.tags ? { tags: list.tags } : {}),
        ...(list.short_name ? { short_name: list.short_name } : {}),
        category: list.category ?? null,
        source: list.source,
        source_url: list.source_url,
        note: list.note,
        fetched_at: new Date().toISOString().slice(0, 10),
        count: list.entries.length,
        entries: list.entries,
      };

      const dropped = droppedKeys(existing, payload);
      if (dropped.length) {
        failures += 1;
        console.log(
          `REFUSED — would drop ${dropped.join(', ')} from the existing seed file. ` +
            'Add it to this source in SOURCES, or remove it from PRESERVED_KEYS if the ' +
            'removal is deliberate. Existing seed file left untouched.',
        );
        continue;
      }

      await writeFile(join(SEEDS, `${list.slug}.json`), `${JSON.stringify(payload, null, 2)}\n`);
      const withIds = list.entries.filter((entry) => entry.tmdb_id).length;
      console.log(
        `${String(list.entries.length).padStart(5)} films` +
          (withIds ? `  (${withIds} with TMDB ids — no search needed)` : ''),
      );
    } catch (error) {
      failures += 1;
      console.log(`FAILED — ${error.message}`);
    }
  }

  if (failures) {
    console.error(`\n${failures} source(s) failed. Existing seeds/*.json were left untouched.`);
    process.exitCode = 1;
  }
}

// Only run when invoked as a script, so the guards above can be unit-tested by
// importing this module.
if (process.argv[1] && resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
