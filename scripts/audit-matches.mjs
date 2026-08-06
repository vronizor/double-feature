#!/usr/bin/env node
/**
 * Finds resolved rows that a working ambiguity guard would have sent to review.
 *
 *   npm run audit-matches                  # a 300-row sample, the default
 *   npm run audit-matches -- --all         # every resolved row
 *   npm run audit-matches -- --list espana # only lists whose name matches
 *   npm run audit-matches -- --sample 50
 *
 * READ-ONLY, AND DELIBERATELY SO. It runs no UPDATE, no INSERT, no DELETE. It
 * prints pairs and a count and stops. That is the whole design: v9's
 * ambiguity guard could not fire (see the comment in `server/tmdb.js`), so
 * every list resolved by title may be carrying rows where a second candidate
 * was equally confident and the more popular one silently won. Those rows are
 * stored as `resolved`, which means the reconciliation screen has never shown
 * them and never will.
 *
 * The temptation is to have this script fix what it finds. It must not, and
 * the reason is recorded in `DECISIONS.md` §3: the migration that back-filled
 * `overall_rank` rewrote rows before anyone had looked at the values, and it
 * produced a column that was fully populated, densely numbered, and wrong.
 * **Look at the pairs first.** A second confident candidate means the matcher
 * could not tell them apart, not that it chose wrongly — on a remake, or on
 * TMDB's own duplicate entries, the row it picked is often right.
 *
 * IT SAMPLES BY DEFAULT. One TMDB search per row, and the library holds
 * thousands of resolved rows, so a full pass is minutes of API traffic to
 * answer a question a sample answers well enough. `--all` when the sample says
 * it is worth it.
 */

import { pathToFileURL } from 'node:url';

import { getDb, closeDb } from '../server/db.js';
import { hasTmdbCredentials } from '../server/config.js';
import { searchMovie, scoreCandidate } from '../server/tmdb.js';

const DEFAULT_SAMPLE = 300;

function parseArgs(argv) {
  const args = { all: false, sample: DEFAULT_SAMPLE, list: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--sample') args.sample = Number(argv[++i]) || DEFAULT_SAMPLE;
    else if (arg === '--list') args.list = String(argv[++i] ?? '').toLowerCase();
  }
  return args;
}

/**
 * The rows worth asking about: resolved, attached to a film, and carrying the
 * raw title the matcher originally worked from.
 *
 * Manual entries are excluded because they never went through the matcher —
 * somebody typed them, so there is no second candidate to have missed.
 */
function candidateRows(db, { list }) {
  return db
    .prepare(
      `SELECT lm.id, lm.raw_title, lm.raw_year, lm.tmdb_id,
              l.name AS list_name, m.title, m.year, m.director
         FROM list_movies lm
         JOIN lists  l ON l.id = lm.list_id
         LEFT JOIN movies m ON m.tmdb_id = lm.tmdb_id
        WHERE lm.status = 'resolved'
          AND lm.tmdb_id IS NOT NULL
          AND COALESCE(m.is_manual, 0) = 0
          ${list ? 'AND LOWER(l.name) LIKE ?' : ''}
        ORDER BY l.name, lm.raw_title`,
    )
    .all(...(list ? [`%${list}%`] : []));
}

/**
 * Asks the question the guard should have asked: was there more than one
 * confident candidate for this title and year?
 *
 * Uses the matcher's OWN scorer rather than a second opinion invented here —
 * the question is "would today's matcher call this ambiguous", and a bespoke
 * heuristic could disagree in either direction without either answer meaning
 * anything. Same reasoning as `looksUnsure` in `server/routes/lists.js`.
 */
async function inspect(row) {
  const results = await searchMovie({ title: row.raw_title, year: row.raw_year });
  const confident = results
    .map((candidate) => ({ candidate, ...scoreCandidate({ title: row.raw_title, year: row.raw_year }, candidate) }))
    .filter((entry) => entry.confident)
    .sort((a, b) => b.score - a.score);

  if (confident.length < 2) return null;
  return {
    ...row,
    // Whether the row points at the candidate the OLD code would have picked.
    // It usually will — that is how it got here — but not always, because the
    // row may predate a title correction or a re-match by hand.
    picked_top: confident[0].candidate.id === row.tmdb_id,
    contenders: confident.map(({ candidate }) => ({
      tmdb_id: candidate.id,
      title: candidate.title,
      year: (candidate.release_date ?? '').slice(0, 4),
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!hasTmdbCredentials()) {
    console.error('TMDB credentials are not configured (see .env.example). Nothing to do.');
    process.exitCode = 1;
    return;
  }

  const db = getDb();
  const all = candidateRows(db, args);
  if (all.length === 0) {
    console.log('No resolved rows to audit.');
    closeDb();
    return;
  }

  // A deterministic stride rather than a random pick, so two runs of the same
  // sample size look at the same rows and the number is comparable. Random
  // sampling would make "did it get better" unanswerable.
  const rows = args.all
    ? all
    : all.filter((_, i) => i % Math.max(1, Math.ceil(all.length / args.sample)) === 0);

  console.log(
    `Auditing ${rows.length} of ${all.length} resolved rows` +
      `${args.all ? '' : ` (sample — use --all for every row)`}` +
      `${args.list ? `, lists matching "${args.list}"` : ''}\n`,
  );

  const flagged = [];
  let done = 0;
  let failed = 0;
  const CONCURRENCY = 8;
  let cursor = 0;

  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        const hit = await inspect(row);
        if (hit) flagged.push(hit);
      } catch {
        // One bad lookup must not abandon the audit. Counted, not swallowed:
        // a run that quietly checked half the rows would report a low number
        // and read as good news.
        failed += 1;
      }
      done += 1;
      if (done % 25 === 0) process.stdout.write(`  ${done}/${rows.length}\r`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // The pairs, because §6 says inspect values and not volumes. A count alone
  // cannot tell you whether these are wrong matches or harmless duplicates,
  // and that is the only question worth answering here.
  console.log(`\n${flagged.length} row(s) had more than one confident candidate.\n`);
  for (const hit of flagged.sort((a, b) => a.list_name.localeCompare(b.list_name))) {
    console.log(`  ${hit.list_name} — "${hit.raw_title}"${hit.raw_year ? ` (${hit.raw_year})` : ''}`);
    console.log(`    now points at ${hit.tmdb_id}: ${hit.title ?? '?'} (${hit.year ?? '?'})${hit.director ? ` — ${hit.director}` : ''}`);
    for (const c of hit.contenders) {
      const mark = c.tmdb_id === hit.tmdb_id ? '*' : ' ';
      console.log(`    ${mark} ${String(c.tmdb_id).padStart(8)}  ${c.title} (${c.year})`);
    }
    console.log('');
  }

  const byList = {};
  for (const hit of flagged) byList[hit.list_name] = (byList[hit.list_name] ?? 0) + 1;
  const sampled = {};
  for (const row of rows) sampled[row.list_name] = (sampled[row.list_name] ?? 0) + 1;

  console.log('Per list:');
  for (const [name, n] of Object.entries(byList).sort((a, b) => b[1] - a[1])) {
    const of = sampled[name] ?? 0;
    console.log(`  ${name.slice(0, 38).padEnd(39)} ${n} of ${of} audited`);
  }

  if (failed) console.log(`\n${failed} lookup(s) failed and were not audited.`);
  if (!args.all) {
    // Stated as a rate rather than a projected count, on purpose. A projection
    // invites the number to be quoted as though rows had been inspected.
    const rate = ((flagged.length / rows.length) * 100).toFixed(1);
    console.log(`\n${rate}% of the sampled rows. Run with --all before acting on that.`);
  }
  console.log('\nNothing was written. This script only reads.');

  closeDb();
}

// Only when invoked as a script, so the helpers above can be unit-tested
// without opening the real database or spending a TMDB call.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { candidateRows, inspect, parseArgs };
