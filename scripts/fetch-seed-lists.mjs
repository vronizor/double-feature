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

async function sparql(query) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const body = await getText(url, { accept: 'application/sparql-results+json' });
  return JSON.parse(body).results.bindings;
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
        name: 'Studio Ghibli',
        source: 'Wikidata — "Studio Ghibli Feature Films" series (Q104830727)',
        source_url: 'https://en.wikipedia.org/wiki/List_of_Studio_Ghibli_works',
        note: 'Feature films only; the Wikipedia "works" page also lists pre-Ghibli staff credits.',
      }),
  },
  { label: 'TMDB Top Rated 100', run: fetchTmdbTopRated },
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
