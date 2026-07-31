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

const BASE = 'https://sede.mcu.gob.es/CatalogoICAA';
const PER_PAGE = 24;
// A government server, and the whole build is thousands of requests. Four in
// flight is brisk enough to finish and slow enough to be polite.
const CONCURRENCY = 4;
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
function icaaGet(path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      BASE + path,
      { rejectUnauthorized: false, headers: extraHeaders },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
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
  const results = await searchMovie({ title, year: film.year });
  let best = null;
  for (const candidate of results) {
    const scored = scoreCandidate({ title, year: film.year }, candidate);
    if (!best || scored.score > best.scored.score) best = { candidate, scored };
  }
  return { ...film, title, best };
}

async function main() {
  // Years are given individually so a probe can SAMPLE across decades rather
  // than take one contiguous block. Coverage is not uniform in time — TMDB
  // knows 2015 far better than 1955 — so a single decade would report a match
  // rate that says nothing about the years it did not touch.
  const years = [];
  for (const arg of process.argv.slice(2)) {
    const range = /^(\d{4})\.\.(\d{4})$/.exec(arg);
    if (range) for (let y = Number(range[1]); y <= Number(range[2]); y += 1) years.push(y);
    else if (/^\d{4}$/.test(arg)) years.push(Number(arg));
  }
  if (years.length === 0) throw new Error('usage: fetch-icaa.mjs <year> [year…] | <from>..<to>');
  if (CACHE) await mkdir(CACHE, { recursive: true });

  await openSession();

  const films = [];
  for (const year of years) {
    const listed = await enumerateYear(year);
    films.push(...listed);
    console.log(`${year}: ${listed.length} Spanish features`);
  }
  console.log(`\n${films.length} films listed, fetching admissions…`);

  const withAdmissions = await inBatches(films, async (film) => ({
    ...film,
    ...(await admissionsFor(film.id).catch(() => ({ admissions: null, revenue: null }))),
  }));

  // No threshold of our own — same rule as France. But a film with NO figure
  // recorded cannot be ranked, so it cannot be on a box-office list.
  const ranked = withAdmissions.filter((film) => film.admissions !== null && film.admissions > 0);
  console.log(`\n${ranked.length} carry an admissions figure, ${films.length - ranked.length} do not`);

  console.log('\nresolving against TMDB…');
  const resolved = await inBatches(ranked, (film) => resolve(film).catch(() => ({ ...film, best: null })));

  const confident = resolved.filter((film) => film.best?.scored.confident);
  const rate = ((confident.length / resolved.length) * 100).toFixed(1);
  console.log(`\n\nconfident matches: ${confident.length}/${resolved.length} (${rate}%)`);
  console.log(`the declared floor is 90% — ${rate >= 90 ? 'CLEARED' : 'NOT met, do not seed'}`);

  // Per-year rates matter more than the overall one: an 80% decade hiding
  // inside a 92% average is the finding, and the average would bury it.
  const byYear = new Map();
  for (const film of resolved) {
    const cell = byYear.get(film.year) ?? { n: 0, ok: 0 };
    cell.n += 1;
    if (film.best?.scored.confident) cell.ok += 1;
    byYear.set(film.year, cell);
  }
  console.log('\nper year:');
  for (const [year, cell] of [...byYear].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${year}: ${cell.ok}/${cell.n} (${((cell.ok / cell.n) * 100).toFixed(0)}%)`);
  }

  const out = join(ROOT, 'seeds', `icaa-${years[0]}-${years[years.length - 1]}.probe.json`);
  await writeFile(
    out,
    JSON.stringify(
      {
        years,
        perYear: Object.fromEntries([...byYear].map(([y, c]) => [y, c])),
        listed: films.length,
        withAdmissions: ranked.length,
        confident: confident.length,
        rate: Number(rate),
        sample: resolved.slice(0, 400).map((film) => ({
          icaa: film.rawTitle,
          title: film.title,
          year: film.year,
          admissions: film.admissions,
          tmdb_id: film.best?.candidate.id ?? null,
          matched: film.best?.candidate.title ?? null,
          confident: Boolean(film.best?.scored.confident),
        })),
      },
      null,
      2,
    ),
  );
  console.log(`wrote ${out}`);
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
