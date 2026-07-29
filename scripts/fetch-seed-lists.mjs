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

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS = join(ROOT, 'seeds');

const UA = 'DoubleFeature/1.0 (self-hosted movie night app; seed list builder)';
const THIS_YEAR = new Date().getFullYear();

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

  return { category: 'awards', ...meta, entries };
}

// --- Wikipedia categories -------------------------------------------------

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
    if (attempt >= 4) throw new Error(`${lang}.wikipedia responded ${response.status}`);
    await sleep(3000 * 2 ** attempt);
    return wikipediaApi(lang, params, attempt + 1);
  }
  if (!response.ok) throw new Error(`${lang}.wikipedia responded ${response.status}`);
  return response.json();
}

/**
 * Award winners taken from a Wikipedia category rather than Wikidata's P166.
 *
 * For the national awards, Wikidata's award-received data is badly incomplete —
 * measured at 32 films for BAFTA Best Film, 26 for the César and 12 for the
 * Goya, against many decades of ceremonies. The language Wikipedias curate
 * their own awards properly, and a category is already exactly the list we
 * want, so this walks:
 *
 *     category members  ->  each page's Wikidata QID  ->  that item's TMDB id
 *
 * which yields 79 / 51 / 41 films at 98-100% TMDB coverage. Going through the
 * QID rather than the page title means no fuzzy title matching at all, and it
 * sidesteps the localisation problem entirely: the French page for a film is
 * linked to the same Wikidata item as the English one.
 *
 * The category also contains the award's own article ("BAFTA Award for Best
 * Film"), which naturally drops out for having no TMDB id.
 */
async function fetchWikipediaCategoryAward(lang, category, awardQid, meta) {
  // 1. Category members, following continuation.
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

  // 2. Page titles -> Wikidata QIDs (50 titles per request is the API limit).
  const qids = [];
  for (let i = 0; i < titles.length; i += 50) {
    const data = await wikipediaApi(lang, {
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      titles: titles.slice(i, i + 50).join('|'),
    });
    for (const page of data.query?.pages ?? []) {
      if (page.pageprops?.wikibase_item) qids.push(page.pageprops.wikibase_item);
    }
    await sleep(400);
  }

  // 3. QIDs -> TMDB id, English title, release year, and the ceremony year
  //    where Wikidata happens to record it. That last one is patchy for these
  //    three awards (28-39%) — it comes from the same sparse P166 data that
  //    made the category route necessary in the first place — so a missing
  //    award_year is expected here and the UI simply omits the year.
  const entries = [];
  for (let i = 0; i < qids.length; i += 120) {
    const values = qids.slice(i, i + 120).map((q) => `wd:${q}`).join(' ');
    const rows = await sparql(`
      SELECT ?item ?name ?date ?tmdb ?awarded WHERE {
        VALUES ?item { ${values} }
        OPTIONAL { ?item wdt:P4947 ?tmdb . }
        OPTIONAL { ?item wdt:P577 ?date . }
        OPTIONAL {
          ?item p:P166 ?statement .
          ?statement ps:P166 wd:${awardQid} .
          ?statement pq:P585 ?awarded .
        }
        OPTIONAL { ?item rdfs:label ?name . FILTER(LANG(?name) = "en") }
      }`);

    const byQid = new Map();
    for (const row of rows) {
      const qid = row.item.value.split('/').pop();
      const entry = byQid.get(qid) ?? { title: null, year: null, award_year: null, tmdb_id: null };
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

  const films = entries
    // No TMDB id means either the award's own article or a film TMDB doesn't
    // carry; either way there's nothing to draw, and the id is the whole point
    // of taking this route.
    .filter((entry) => entry.tmdb_id && entry.title)
    .filter((entry) => entry.year === null || entry.year <= THIS_YEAR)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title));

  return { category: 'awards', ...meta, entries: films };
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
        category: 'collection',
        name: 'Studio Ghibli',
        source: 'Wikidata — "Studio Ghibli Feature Films" series (Q104830727)',
        source_url: 'https://en.wikipedia.org/wiki/List_of_Studio_Ghibli_works',
        note: 'Feature films only; the Wikipedia "works" page also lists pre-Ghibli staff credits.',
      }),
  },
  { label: 'TMDB Top Rated 100', run: fetchTmdbTopRated },

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
  {
    label: 'Oscar Best Picture',
    run: () =>
      fetchWikidataAward('Q102427', {
        slug: 'award-oscar-best-picture',
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
        name: 'Palme d’Or (Cannes)',
        source: 'Wikidata — award received (P166), Palme d’Or (Q179808)',
        source_url: 'https://en.wikipedia.org/wiki/Palme_d%27Or',
        note: 'The most redundant of the award lists against a canon-heavy library (58% already present) — included for the axis rather than the additions.',
      }),
  },
  {
    label: 'Golden Lion',
    run: () =>
      fetchWikidataAward('Q209459', {
        slug: 'award-golden-lion',
        name: 'Golden Lion (Venice)',
        source: 'Wikidata — award received (P166), Golden Lion (Q209459)',
        source_url: 'https://en.wikipedia.org/wiki/Golden_Lion',
      }),
  },
  {
    label: 'Golden Bear',
    run: () =>
      fetchWikidataAward('Q154590', {
        slug: 'award-golden-bear',
        name: 'Golden Bear (Berlin)',
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
        name: 'BAFTA — Best Film',
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
        name: 'César — Meilleur Film',
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
          name: 'Goya — Mejor Película',
          source: 'es.wikipedia category "Películas ganadoras del Premio Goya a la mejor película", resolved to TMDB ids via Wikidata',
          source_url: 'https://es.wikipedia.org/wiki/Premio_Goya_a_la_mejor_pel%C3%ADcula',
          note: "Wikidata's award-received data only covers 12 of these; the Spanish Wikipedia category covers 41.",
        },
      ),
  },
];

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

      const payload = {
        name: list.name,
        // Must be carried through: seed.mjs reads it to group the list in the
        // picker, and omitting it here would silently strip the category from
        // an existing seed file on the next fetch run.
        category: list.category ?? null,
        source: list.source,
        source_url: list.source_url,
        note: list.note,
        fetched_at: new Date().toISOString().slice(0, 10),
        count: list.entries.length,
        entries: list.entries,
      };

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

main();
