#!/usr/bin/env node
/**
 * Box office Spain, from the ICAA Catálogo de Películas.
 *
 *   node scripts/fetch-icaa.mjs 1955 1965 1975   # named years, sampled
 *   node scripts/fetch-icaa.mjs 1950..2026        # an inclusive range
 *
 * The ICAA is the Spanish film institute's own register: official, admissions
 * rather than revenue, and seventy years deep. It is also the ONLY list in this
 * repo whose identity is a guess — it carries no TMDB id and no Wikidata QID,
 * so titles are matched. Every guard rail below exists because of that.
 *
 * Three things about this source, each of which cost time to find and none of
 * which fails loudly:
 *
 *   1. Box-office data is served ONLY in the Spanish locale. The English pages
 *      render the same film with no Recaudación and no Espectadores at all.
 *   2. Pagination is ignored without a session cookie AND an XHR header —
 *      every page returns page 1, with a 200.
 *   3. `SoloEspana` is 1 or 0, not `true`. Sent as `true` it is silently
 *      dropped and you enumerate the whole catalogue.
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { request as httpsRequest } from 'node:https';

import { ROOT } from '../server/config.js';
import { searchMovie, scoreCandidate, normalizeTitle } from '../server/tmdb.js';
// One definition of "which box-office years may be taken", shared rather than
// restated — see the comment on it. Importing is safe: that script only runs
// its main() when invoked directly.
import { lastSettledYear } from './fetch-seed-lists.mjs';

const BASE = 'https://sede.mcu.gob.es/CatalogoICAA';
const PER_PAGE = 24;
// A government server, and the whole build is thousands of requests. Four in
// flight is brisk enough to finish and slow enough to be polite.
const CONCURRENCY = 4;
// Only the top of each year is worth resolving, ranking or drawing.
const TOP_N = 20;
const CACHE = process.env.ICAA_CACHE_DIR ? join(ROOT, process.env.ICAA_CACHE_DIR) : null;

let cookie = '';

/**
 * The ICAA host serves an INCOMPLETE certificate chain — it omits an
 * intermediate — so Node rejects it while browsers and `curl -k` do not. That
 * is the server's misconfiguration, not a bug here, and BACKLOG recorded it
 * about both government hosts before this script existed.
 *
 * The exception is scoped to these requests rather than set globally with
 * NODE_TLS_REJECT_UNAUTHORIZED, which would also disable verification for the
 * TMDB calls this same script makes. Written against node:https rather than by
 * adding undici: this repo has two runtime dependencies, and that is worth
 * more than the few lines it would save.
 *
 * What is at risk is nil — a public catalogue, no credentials sent, and the
 * output is eyeballed before anything is seeded.
 */
function icaaOnce(path, extraHeaders, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      BASE + path,
      { rejectUnauthorized: false, headers: extraHeaders, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('ETIMEDOUT')));
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One dropped connection must not cost the whole run.
 *
 * This is a slow public server and the full build is ~16,000 requests, so a
 * timeout somewhere is not a risk, it is a certainty — the first attempt at
 * this build died on `read ETIMEDOUT` at 1959 and threw away the fourteen
 * years before it. The France fetcher has had retry and a per-year alarm from
 * the start; this had neither.
 *
 * Backoff is generous rather than aggressive: if the server is struggling,
 * hammering it is both rude and counter-productive.
 */
async function icaaGet(path, extraHeaders = {}, { retries = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await icaaOnce(path, extraHeaders, 30_000);
      // 5xx is worth retrying; 4xx is not — it will say the same thing again.
      if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(2000 * 2 ** attempt);
    }
  }
  throw new Error(`${path} failed after ${retries + 1} attempts: ${lastError.message}`);
}

/** Establishes the Spanish locale, which is what makes box office visible. */
async function openSession() {
  const response = await icaaGet('/es-es?q=true');
  cookie = (response.headers['set-cookie'] ?? []).map((line) => line.split(';')[0]).join('; ');
  if (!cookie) throw new Error('ICAA gave no session cookie; box office will be missing');
}

async function get(path) {
  const response = await icaaGet(path, {
    cookie,
    'x-requested-with': 'XMLHttpRequest',
    accept: 'text/html',
  });
  if (response.status !== 200) throw new Error(`${path} -> ${response.status}`);
  return response.body;
}

const strip = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

/**
 * Undoes the catalogue's storage convention: titles are upper-cased and
 * article-last, so "EL VERDUGO" is filed as "VERDUGO, EL".
 *
 * Exported because it is the one place identity is guessed, and a rule nobody
 * can test is a rule nobody should trust.
 */
export function icaaTitle(raw) {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  // Only a trailing article, and only when something precedes it — "LOS
  // OTROS, LOS" is not a thing, but a title genuinely ending in a comma-word
  // ("PARIS, TEXAS") must not be rearranged.
  const match = /^(.*),\s*(EL|LA|LOS|LAS|UN|UNA|UNOS|UNAS|LE|LES|THE|A|AN)$/i.exec(text);
  const ordered = match ? `${match[2]} ${match[1]}` : text;
  // Sentence case: the catalogue shouts, TMDB does not, and normalizeTitle
  // lowercases both anyway — this is only so the seed file reads like a title.
  return ordered
    .toLowerCase()
    .replace(/(^|[\s(¿¡"'-])([a-záéíóúüñ])/g, (_, pre, ch) => pre + ch.toUpperCase());
}

/** Every Spanish feature film classified in a given year. */
async function enumerateYear(year) {
  const query = `?Ano=${year}&SoloEspana=1&Metraje=LA&T_General=&sortOrder=&page=`;
  const first = await get(query + '1');
  // Take the HIGHEST page number the pager offers rather than looking for a
  // "Last page" link by name: that label is localised, and in the Spanish
  // locale — which is the only one that serves box office at all — it is not
  // "Last page". Matching the label silently yielded one page per year, so
  // every year returned exactly PER_PAGE films and looked plausible.
  const last = Math.max(
    1,
    ...[...first.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1])).filter(Number.isFinite),
  );

  const films = [];
  const take = (html) => {
    // class comes BEFORE href in this markup — the obvious ordering matches
    // nothing and reports zero films rather than failing.
    for (const m of html.matchAll(
      /class="\s*list-pro-title"\s+href="[^"]*Pelicula=(\d+)"[^>]*>([^<]*)</g,
    )) {
      films.push({ id: Number(m[1]), rawTitle: strip(m[2]).trim(), year });
    }
  };
  take(first);
  for (let page = 2; page <= last; page += 1) take(await get(query + page));

  // The listing repeats each film in a grid view and a list view, so ids
  // duplicate. Dedupe on the id, which is the catalogue's own key.
  const seen = new Set();
  return films.filter((film) => (seen.has(film.id) ? false : seen.add(film.id)));
}

/** Admissions for one film. Null when the catalogue simply has no figure. */
async function admissionsFor(id) {
  const cached = CACHE ? await readFile(join(CACHE, `${id}.txt`), 'utf8').catch(() => null) : null;
  const text = cached ?? strip(await get(`/Peliculas/Detalle?Pelicula=${id}`));
  if (CACHE && !cached) await writeFile(join(CACHE, `${id}.txt`), text).catch(() => {});

  const admissions = /Espectadores:\s*([\d.]+)/.exec(text);
  const revenue = /Recaudaci[oó]n:\s*([\d.,]+)/.exec(text);
  return {
    admissions: admissions ? Number(admissions[1].replace(/\./g, '')) : null,
    revenue: revenue ? revenue[1] : null,
  };
}

async function inBatches(items, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(worker))));
    process.stdout.write(`\r  ${Math.min(i + CONCURRENCY, items.length)}/${items.length}   `);
  }
  return out;
}

/**
 * Title + year against TMDB. Confident means an exact normalised title within
 * a year, which is `scoreCandidate`'s own definition — reused rather than
 * reinvented so this list matches the way every other resolution does.
 */
async function resolve(film) {
  const title = icaaTitle(film.rawTitle);
  const query = searchTitle(title);
  // Asked in Spanish so `title` comes back as the Spanish release title.
  // Without it, a film TMDB found perfectly well via its ES alternative title
  // returns as its English one and fails the exact-title check — which is what
  // "La Ciudad de los Niños Perdidos" was doing while TMDB returned it as the
  // single top hit.
  // Searched WITHOUT the year on purpose. ICAA records the classification year,
  // so passing it narrows TMDB to the wrong twelve months: `Volver` under 2005
  // returns unrelated films while the real one is dated 2006, and the "retry
  // without a year" fallback never fires because it only triggers on ZERO
  // results, not on wrong ones. The year still disambiguates -- it is applied
  // below as a tolerance rather than as a filter.
  const results = await searchMovie({ title: query, language: 'es-ES' });

  let best = null;
  for (const candidate of results) {
    const scored = scoreCandidate({ title: query, year: film.year }, candidate);
    // `confident` from scoreCandidate is deliberately NOT reused: it hardcodes
    // ±1, and ICAA's year means something different. Everything else about the
    // comparison — accent folding, article stripping, original_title — is
    // reused exactly, so this list resolves the same way as every other one in
    // every respect but the window.
    const withinYear =
      scored.candidateYear === null
        ? false
        : Math.abs(scored.candidateYear - film.year) <= YEAR_TOLERANCE;
    const titleOk =
      scored.titleExact ||
      titlesMatch(query, candidate.title) ||
      titlesMatch(query, candidate.original_title ?? '');
    const confident = titleOk && withinYear;

    // Every film on this list is by definition Spanish cinema, so when two
    // candidates are otherwise equally good the Spanish-language one wins.
    //
    // A PREFERENCE and never a filter: some of the biggest Spanish films are
    // shot in English -- Los Otros, Lo Imposible, Two Much -- and filtering on
    // language would throw exactly those away.
    //
    // It exists because a short generic title matches a foreign film of the
    // same year and nothing catches it: "Marco" (2024) resolved to a Malayalam
    // action film with an identical title and identical year, and "Tierra de
    // Nadie" to the American thriller Mob Land, which carries no Spanish title
    // at all. Both were scored CONFIDENT, and a wrong confident match is
    // invisible afterwards -- the reconciliation screen only shows rows that
    // failed to match.
    const spanish = SPANISH_LANGUAGES.has(candidate.original_language) ? 1 : 0;
    const rankKey = [confident ? 1 : 0, spanish, scored.score];
    const better =
      !best ||
      rankKey[0] > best.rankKey[0] ||
      (rankKey[0] === best.rankKey[0] &&
        (rankKey[1] > best.rankKey[1] ||
          (rankKey[1] === best.rankKey[1] && rankKey[2] > best.rankKey[2])));
    if (better) best = { candidate, scored, confident, rankKey };
  }
  return { ...film, title, best };
}

/**
 * The title to SEARCH with, as distinct from the one to display.
 *
 * ICAA appends disambiguators in parentheses — "Flamenco (De Carlos Saura)",
 * "Flash-Back (El Apartamento)" — which are catalogue apparatus, not part of
 * the title. Searching with them attached matches nothing, or worse, matches
 * the parenthetical: "Flash-Back (El Apartamento)" found Billy Wilder's
 * The Apartment.
 */
export function searchTitle(title) {
  return String(title ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim() || String(title ?? '');
}

/**
 * How far ICAA's year may sit from TMDB's before a match is doubted.
 *
 * ICAA records the year a film was CLASSIFIED, not released, and the gap is
 * routine rather than exceptional — a film classified in December is released
 * the following year, and a re-classification can be later still. The ±1 that
 * `scoreCandidate` calls confident is calibrated for lists that carry release
 * years, and applying it here rejected correct matches systematically.
 *
 * Two years, not more: past that the year stops disambiguating remakes, which
 * is the only reason it is in the comparison at all.
 */
const YEAR_TOLERANCE = 2;

/**
 * The languages a Spanish film is actually made in. Catalan, Galician and
 * Basque are Spain's other official languages, not foreign ones.
 */
const SPANISH_LANGUAGES = new Set(['es', 'ca', 'gl', 'eu']);

/**
 * Spanish spells small numbers out where the catalogue writes digits, so
 * "8 Apellidos Vascos" and TMDB's "Ocho apellidos vascos" are the same film
 * and share not one comparable token. Only 1-20 plus the round hundreds are
 * worth carrying: past that, films use digits on both sides.
 */
const NUMBER_WORDS = {
  1: 'uno', 2: 'dos', 3: 'tres', 4: 'cuatro', 5: 'cinco', 6: 'seis', 7: 'siete',
  8: 'ocho', 9: 'nueve', 10: 'diez', 11: 'once', 12: 'doce', 13: 'trece',
  14: 'catorce', 15: 'quince', 16: 'dieciseis', 17: 'diecisiete',
  18: 'dieciocho', 19: 'diecinueve', 20: 'veinte', 100: 'cien', 1000: 'mil',
};

/**
 * Every way the same title can be written, for comparison only.
 *
 * Superscripts first: `[REC]²` normalises to "rec" because ² is not in the
 * a-z0-9 range `normalizeTitle` keeps, so the sequel number vanishes entirely
 * and it stops matching "Rec 2".
 */
function titleVariants(title) {
  const supers = { '\u00b2': '2', '\u00b3': '3', '\u00b9': '1' };
  const base = String(title).replace(/[\u00b2\u00b3\u00b9]/g, (c) => supers[c]);
  const out = new Set([base]);
  // Digits to words and back, so either side of the comparison can be the one
  // written differently.
  out.add(base.replace(/\b(\d{1,4})\b/g, (m, d) => NUMBER_WORDS[Number(d)] ?? m));
  for (const [n, word] of Object.entries(NUMBER_WORDS)) {
    out.add(base.replace(new RegExp(`\\b${word}\\b`, 'gi'), n));
  }
  return [...out];
}

/**
 * Whether two titles name the same film.
 *
 * Exact after normalisation, OR the candidate STARTS with the query at a word
 * boundary — because TMDB routinely carries a subtitle the Spanish release did
 * not: "Torrente 4" is listed as "Torrente 4: Lethal crisis", and "Padre no hay
 * mas que uno 4" as "... 4: Campanas de boda". A prefix is only accepted from
 * six characters up, so "Rec" cannot swallow "Rec 2".
 */
function titlesMatch(query, candidate) {
  for (const q of titleVariants(query).map(normalizeTitle)) {
    if (!q) continue;
    for (const c of titleVariants(candidate).map(normalizeTitle)) {
      if (q === c) return true;
      if (q.length >= 6 && c.startsWith(q + ' ')) return true;
    }
  }
  return false;
}

async function main() {
  // Years are given individually so a probe can SAMPLE across decades rather
  // than take one contiguous block. Coverage is not uniform in time — TMDB
  // knows 2015 far better than 1955 — so a single decade would report a match
  // rate that says nothing about the years it did not touch.
  let years = [];
  for (const arg of process.argv.slice(2)) {
    const range = /^(\d{4})\.\.(\d{4})$/.exec(arg);
    if (range) for (let y = Number(range[1]); y <= Number(range[2]); y += 1) years.push(y);
    else if (/^\d{4}$/.test(arg)) years.push(Number(arg));
  }
  if (years.length === 0) throw new Error('usage: fetch-icaa.mjs <year> [year…] | <from>..<to>');

  // Same rule as the other two box-office fetchers, and imported from there
  // rather than restated, because three copies of a date rule is three chances
  // for one of them to drift. A year still settling would seed a part-year
  // chart, and the seeder is insert-only so a rank once written cannot be
  // corrected. Dropped loudly rather than silently: a run that quietly did
  // less than it was asked reads as a run that found less.
  const settled = lastSettledYear();
  const unsettled = years.filter((year) => year > settled);
  if (unsettled.length) {
    console.log(
      `Skipping ${unsettled.join(', ')} — not settled yet. A box-office year is ` +
        `only taken from April of the following year (see lastSettledYear).`,
    );
  }
  years = years.filter((year) => year <= settled);
  if (years.length === 0) throw new Error('Every year given is still settling; nothing to fetch.');
  if (CACHE) await mkdir(CACHE, { recursive: true });

  await openSession();

  const films = [];
  const failedYears = [];
  for (const year of years) {
    try {
      const listed = await enumerateYear(year);
      films.push(...listed);
      console.log(`${year}: ${listed.length} Spanish features`);
    } catch (error) {
      // Loud, named, and survivable — the same rule the France fetcher uses.
      // Losing one year to a bad afternoon must not lose the other 81.
      failedYears.push(year);
      console.log(`${year}: FAILED — ${error.message}`);
    }
  }
  if (failedYears.length) console.log(`\n⚠️  years that failed entirely: ${failedYears.join(', ')}`);
  console.log(`\n${films.length} films listed, fetching admissions…`);

  // Failures are COUNTED, never swallowed. They used to be caught per film and
  // turned into "no admissions figure", which is indistinguishable from a film
  // that genuinely never reached cinemas -- so a network outage during this
  // phase silently deleted whole years. Films are processed in year order, so
  // an outage maps to contiguous missing years, and the run still reported
  // zero failures and a match rate above the floor. Six years of the 1960s
  // went missing exactly that way.
  const fetchErrors = [];
  const withAdmissions = await inBatches(films, async (film) => {
    try {
      return { ...film, ...(await admissionsFor(film.id)) };
    } catch (error) {
      fetchErrors.push({ film, message: error.message });
      // `undefined` rather than null: null means "the catalogue has no figure",
      // which is a real answer. This is the absence of an answer, and the two
      // must not look alike.
      return { ...film, admissions: undefined, revenue: null };
    }
  });

  if (fetchErrors.length) {
    const byYear = new Map();
    for (const e of fetchErrors) byYear.set(e.film.year, (byYear.get(e.film.year) ?? 0) + 1);
    console.log(`\n⚠️  ${fetchErrors.length} detail pages FAILED to fetch, by year:`);
    for (const [year, n] of [...byYear].sort((a, b) => a[0] - b[0])) {
      console.log(`     ${year}: ${n}`);
    }
    console.log('   Re-run to fill these — cached pages are skipped, so it is cheap.');
  }

  // A film with no figure was never released in cinemas — the catalogue carries
  // course recordings and televised zarzuela at feature LENGTH, and those are
  // what lack admissions. So this is ICAA's own inclusion rule, not a gap.
  const released = withAdmissions.filter(
    (film) => film.admissions !== null && film.admissions !== undefined && film.admissions > 0,
  );
  console.log(`\n${released.length} were released in cinemas, ${films.length - released.length} were not`);

  // Top N per year, because unlike the French pages ICAA applies no threshold
  // of its own: without a cut the list opens with films that sold 125 tickets.
  // Per year rather than a fixed floor, so it adapts to eras when cinema-going
  // collapsed instead of emptying them.
  const byYearRank = new Map();
  for (const film of released) {
    const list = byYearRank.get(film.year) ?? [];
    list.push(film);
    byYearRank.set(film.year, list);
  }
  const ranked = [];
  for (const [, list] of byYearRank) {
    list.sort((a, b) => b.admissions - a.admissions);
    list.slice(0, TOP_N).forEach((film, i) => ranked.push({ ...film, rank: i + 1 }));
  }
  // Both ranks are stored, because they answer different questions and neither
  // can be derived from the other once the admissions figure is discarded.
  // `rank` is the position within the year, which is what Top-N cuts on and
  // what keeps the list era-balanced. `overall_rank` orders the whole list by
  // admissions, which answers "the biggest Spanish films ever" — a question
  // per-year ranking cannot express.
  ranked.sort((a, b) => b.admissions - a.admissions);
  ranked.forEach((film, i) => { film.overallRank = i + 1; });
  console.log(`top ${TOP_N} per year -> ${ranked.length} films to resolve`);

  console.log('\nresolving against TMDB…');
  const resolved = await inBatches(ranked, (film) => resolve(film).catch(() => ({ ...film, best: null })));

  const confident = resolved.filter((film) => film.best?.confident);
  const rate = ((confident.length / resolved.length) * 100).toFixed(1);
  console.log(`\n\nconfident matches: ${confident.length}/${resolved.length} (${rate}%)`);
  console.log(`the declared floor is 90% — ${rate >= 90 ? 'CLEARED' : 'NOT met, do not seed'}`);

  // Per-year rates matter more than the overall one: an 80% decade hiding
  // inside a 92% average is the finding, and the average would bury it.
  const byYear = new Map();
  for (const film of resolved) {
    const cell = byYear.get(film.year) ?? { n: 0, ok: 0 };
    cell.n += 1;
    if (film.best?.confident) cell.ok += 1;
    byYear.set(film.year, cell);
  }
  console.log('\nper year:');
  for (const [year, cell] of [...byYear].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${year}: ${cell.ok}/${cell.n} (${((cell.ok / cell.n) * 100).toFixed(0)}%)`);
  }

  // EVERY top-20 film goes in the seed file, not only the ones that matched.
  // An unmatched entry carries no tmdb_id, so seed.mjs resolves it at seed
  // time and files it as needs_review with its candidates — the reconciliation
  // screen on the Lists tab already exists for exactly this.
  //
  // Dropping them would be silent and would bias the list in the worst
  // possible direction: the films that fail to match are disproportionately
  // the ones with awkward or ambiguous titles, and they earned their place by
  // ticket sales regardless of how hard they are to identify.
  const kept = resolved.slice().sort((a, b) => a.year - b.year || a.rank - b.rank);
  const perYearOut = new Map();
  const entries = kept.map((film) => {
    const n = (perYearOut.get(film.year) ?? 0) + 1;
    perYearOut.set(film.year, n);
    return {
      title: film.title,
      year: film.year,
      // Only when confident. A guessed id is worse than no id: no id means the
      // reconciliation screen asks, an id means nobody ever looks again.
      ...(film.best?.confident ? { tmdb_id: film.best.candidate.id } : {}),
      rank: n,
      overall_rank: film.overallRank ?? null,
    };
  });

  // Dedupe only among entries that HAVE an id — two unmatched rows are not
  // known to be the same film, and collapsing them would decide that silently.
  const seen = new Set();
  const deduped = entries.filter((e) =>
    e.tmdb_id === undefined ? true : seen.has(e.tmdb_id) ? false : seen.add(e.tmdb_id),
  );
  const unresolved = deduped.filter((e) => e.tmdb_id === undefined).length;

  if (rate < 90) {
    console.log('\nBelow the declared floor - writing a probe file, not a seed.');
    const probe = join(ROOT, 'seeds', `icaa-${years[0]}-${years.at(-1)}.probe.json`);
    await writeFile(probe, JSON.stringify({ years, rate, entries }, null, 2));
    console.log(`wrote ${probe}`);
    return;
  }

  const out = join(ROOT, 'seeds', 'box-office-spain.json');
  const note =
    'Spanish feature films by admissions, top 20 of each year. The ICAA is the ' +
    'Spanish film institute own register: official, and admissions rather than ' +
    'revenue. Unlike the French per-year pages it applies no threshold of its ' +
    'own, so the top-20 cut is ours - without it the list opens with films that ' +
    'sold a few hundred tickets. A film with no admissions figure was never ' +
    'released in cinemas: the catalogue also carries course recordings and ' +
    'televised zarzuela at feature length. This is the only list here resolved ' +
    'by TITLE rather than by id or QID; the sampled confident-match rate was ' +
    rate + '% against a declared floor of 90%. Entries with no tmdb_id did not ' +
    'match confidently and are left for the reconciliation screen on the Lists ' +
    'tab rather than dropped or guessed.';
  await writeFile(
    out,
    JSON.stringify(
      {
        name: 'Box-office España',
        tags: ['box-office'],
        category: 'box-office',
        source: 'ICAA Catalogo de Peliculas - espectadores, top 20 per year',
        source_url: 'https://sede.mcu.gob.es/CatalogoICAA',
        note,
        fetched_at: new Date().toISOString().slice(0, 10),
        count: deduped.length,
        entries: deduped,
      },
      null,
      2,
    ),
  );
  console.log(
    `\nwrote ${out} - ${deduped.length} films, ${unresolved} awaiting review ` +
      `(${entries.length - deduped.length} duplicate ids dropped)`,
  );
}

// Only as a script. Importing this file for `icaaTitle` must not start a
// multi-thousand-request crawl -- the same guard seed.mjs needed, and the same
// mistake made twice in one session.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
