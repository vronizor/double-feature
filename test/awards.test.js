import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from '../server/config.js';
import { createTestDb } from '../server/db.js';
import { awardsByTmdbId, recordEntry } from '../server/movies.js';
import { awardLabel, awardYearLabel, shortAwardName } from '../public/dom.js';

const SEEDS = join(ROOT, 'seeds');

function seed() {
  const db = createTestDb();
  // Deliberately NO `category` on any of these: category is the legacy column
  // and nothing added after v2 sets it. Awards must resolve on the tag alone.
  db.exec(`INSERT INTO lists (id, name, origin, is_active, short_name) VALUES
    (1, 'Cannes — Palme d’Or', 'seed', 1, 'Palme d’Or'),
    (2, 'Oscar — Best Picture', 'seed', 1, 'Oscar'),
    (3, 'BAFTA — Best Film', 'seed', 1, 'BAFTA'),
    (4, 'TSPDT 1,000 Greatest Films', 'seed', 1, NULL)`);
  db.exec(`INSERT INTO list_tags (list_id, tag) VALUES
    (1, 'awards'), (1, 'festivals'),
    (2, 'awards'),
    (3, 'awards'),
    (4, 'canon')`);

  const add = (tmdbId, title) =>
    db.prepare('INSERT INTO movies (tmdb_id, title, year) VALUES (?, ?, 2019)').run(tmdbId, title);
  add(1, 'Parasite');
  add(2, 'Unawarded Film');

  const link = (listId, tmdbId, awardYear, status = 'resolved') =>
    db
      .prepare(
        `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, award_year, status)
         VALUES (?, ?, 'x', 2019, ?, ?)`,
      )
      .run(listId, tmdbId, awardYear, status);

  link(1, 1, 2019); // Palme d'Or 2019
  link(2, 1, 2020); // Oscar 2020
  link(3, 1, null); // BAFTA, year unknown
  link(4, 1, null); // canon list — must NOT appear as an award
  link(4, 2, null);
  return db;
}

test('awards are limited to award-tagged lists', () => {
  const db = seed();
  const awards = awardsByTmdbId(db, [1]).get(1);
  assert.equal(awards.length, 3, 'the canon list is not an award');
  assert.ok(!awards.some((a) => a.name.includes('TSPDT')));
});

test('a list carrying the awards tag but no legacy category still badges', () => {
  // The regression this guards: awardsByTmdbId used to join on
  // `lists.category = 'awards'`, which v2 superseded with list_tags. Any award
  // list added after that — tagged, but with category left NULL — produced no
  // badge at all, silently.
  const db = seed();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (5, 'Prix Louis-Delluc', 'seed', 1)`);
  db.exec(`INSERT INTO list_tags (list_id, tag) VALUES (5, 'awards')`);
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, award_year, status)
     VALUES (5, 1, 'x', 2019, 2019, 'resolved')`,
  ).run();

  const names = awardsByTmdbId(db, [1]).get(1).map((a) => a.name);
  assert.ok(names.includes('Prix Louis-Delluc'), names.join(', '));
});

test('a list with the legacy awards category but no tag is NOT an award', () => {
  // The other half of the same move: category is dead as a signal. A list
  // carrying only the old column must not sneak back in through it.
  const db = seed();
  db.exec(
    `INSERT INTO lists (id, name, origin, category, is_active) VALUES (6, 'Stale Category List', 'seed', 'awards', 1)`,
  );
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)
     VALUES (6, 1, 'x', 2019, 'resolved')`,
  ).run();

  const names = awardsByTmdbId(db, [1]).get(1).map((a) => a.name);
  assert.ok(!names.includes('Stale Category List'), names.join(', '));
});

test('awards read as a chronology, with unknown years last', () => {
  // SQLite sorts NULL lowest, so without the explicit `award_year IS NULL`
  // ordering the undated BAFTA would lead rather than trail.
  const db = seed();
  const awards = awardsByTmdbId(db, [1]).get(1);
  assert.deepEqual(
    awards.map((a) => a.year),
    [2019, 2020, null],
  );
});

test('a film with no awards is absent from the map rather than present and empty', () => {
  const db = seed();
  const map = awardsByTmdbId(db, [1, 2]);
  assert.ok(map.has(1));
  assert.ok(!map.has(2));
});

test('awardsByTmdbId tolerates an empty id list', () => {
  const db = seed();
  assert.equal(awardsByTmdbId(db, []).size, 0);
});

test('unresolved memberships never count as awards', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, category, is_active)
           VALUES (1, 'Cannes — Palme d’Or', 'seed', 'awards', 1)`);
  db.prepare('INSERT INTO movies (tmdb_id, title, year) VALUES (7, ?, 2000)').run('Pending');
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, award_year, status)
     VALUES (1, 7, 'Pending', 2000, 2000, 'needs_review')`,
  ).run();
  assert.equal(awardsByTmdbId(db, [7]).size, 0);
});

// --- Display helpers (dom.js is DOM-free at module scope) -------------------

test('the short name comes from the list, not from parsing its full name', () => {
  // Both Oscars collapse to "Oscar" under any naive parsing, and a film that
  // won both would read "Oscar 2020 · Oscar 2020". That is the whole reason the
  // value is stored on the list rather than derived.
  assert.equal(shortAwardName({ name: 'Oscar — Best Picture', short_name: 'Oscar' }), 'Oscar');
  assert.equal(
    shortAwardName({ name: 'Oscar — Best International Feature', short_name: 'Oscar Intl.' }),
    'Oscar Intl.',
  );
});

test('a list with no short name still shortens sensibly', () => {
  // Custom lists have none, and a seed list may not have been given one yet.
  assert.equal(shortAwardName({ name: 'Golden Frog (Camerimage)', short_name: null }), 'Golden Frog');
  assert.equal(shortAwardName({ name: 'Some Award — Best Thing' }), 'Some Award');
  assert.equal(shortAwardName({ name: 'Bare Name' }), 'Bare Name');
});

test('a bare string is still accepted, so the fallback path cannot crash', () => {
  assert.equal(shortAwardName('Golden Frog (Camerimage)'), 'Golden Frog');
  assert.equal(shortAwardName(null), '');
});

test('awardLabel omits the year entirely when it is unknown', () => {
  assert.equal(awardLabel({ name: 'Cannes — Palme d’Or', short_name: 'Palme d’Or', year: 2019 }), 'Palme d’Or 2019');
  assert.equal(awardLabel({ name: 'César — Meilleur Film', short_name: 'César', year: null }), 'César');
  // The 2020 ceremony honoured 2019 films — Parasite — so the full-name form
  // shifts too. It also proves the rule matches through the short-name
  // FALLBACK: this award carries no short_name, so "Oscar — Best Picture" is
  // stripped to "Oscar" before the rule is looked up.
  assert.equal(
    awardLabel({ name: 'Oscar — Best Picture', year: 2020 }, { short: false }),
    'Oscar — Best Picture 2019',
  );
});

test('the short name travels from the list row to the award payload', () => {
  // The end-to-end point of moving this out of the frontend: a list added to
  // the database with a short name gets it rendered, with no code change.
  const db = seed();
  db.exec(`INSERT INTO lists (id, name, origin, is_active, short_name)
           VALUES (7, 'Prix Louis-Delluc (France)', 'seed', 1, 'Delluc')`);
  db.exec(`INSERT INTO list_tags (list_id, tag) VALUES (7, 'awards')`);
  db.prepare(
    `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, award_year, status)
     VALUES (7, 1, 'x', 2019, 2019, 'resolved')`,
  ).run();

  const award = awardsByTmdbId(db, [1]).get(1).find((a) => a.name.startsWith('Prix Louis'));
  assert.equal(award.short_name, 'Delluc');
  assert.equal(awardLabel(award), 'Delluc 2019');
  // Without the stored value it would have string-mangled to "Prix Louis-Delluc".
  assert.equal(awardLabel({ ...award, short_name: null }), 'Prix Louis-Delluc 2019');
});

test('an unresolved entry keeps its rank, so reconciling it later restores a ranked film', () => {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (1, 'Box-office Test', 'seed', 1)`);

  // needs_review and unmatched rows used to be inserted without a rank at all.
  // These are precisely the rows a human fixes by hand later, so a film
  // reconciled on the Lists tab came back rankless and silently vanished from
  // every Top-N cut — "the top 10 of 1946" quietly becoming nine films.
  recordEntry(db, {
    listId: 1,
    rawTitle: 'Costa Brava',
    rawYear: 1946,
    rank: 1,
    overallRank: 900,
    result: { status: 'unmatched', movie: null, candidates: [] },
  });

  const row = db.prepare('SELECT rank, overall_rank, status FROM list_movies WHERE list_id = 1').get();
  assert.equal(row.status, 'unmatched');
  assert.equal(row.rank, 1, 'the per-year rank survives');
  assert.equal(row.overall_rank, 900, 'the overall rank survives too');
});

// --- The year an award is naturally called by ------------------------------
//
// The database stores the CEREMONY year, which is scraped and stays the truth.
// These cover only how it is spoken. Measured across the real library before
// being written: the constant holds for every award from the mid-1930s on, and
// the exceptions are the first BAFTA and the pre-calendar Oscar ceremonies.

const award = (short_name, year) => ({ name: short_name, short_name, year });

test('an academy is named for the films, not the ceremony', () => {
  // The 69th Academy Awards were held in March 1997 for 1996 films.
  assert.equal(awardYearLabel(award('Oscar', 1997)), 1996);
  assert.equal(awardLabel(award('Oscar', 1997)), 'Oscar 1996');
  assert.equal(awardYearLabel(award('BAFTA', 2010)), 2009);
  assert.equal(awardYearLabel(award('Goya', 2024)), 2023);
  assert.equal(awardYearLabel(award('Oscar Intl.', 1995)), 1994);
});

test('a festival is named for its own year', () => {
  // No gap to close: the Palme awarded at the 2019 festival is the 2019 Palme.
  for (const name of ['Palme d’Or', 'Golden Lion', 'Golden Bear', 'Grand Prix']) {
    assert.equal(awardYearLabel(award(name, 2019)), 2019, name);
  }
});

test('the César is named for its ceremony, as French usage has it', () => {
  // "César 2012" is the right label for a 2011 film — this one was already
  // correct and must not be shifted.
  assert.equal(awardYearLabel(award('César', 2012)), 2012);
});

test('the first BAFTA shows no year rather than a confident wrong one', () => {
  // The 1st BAFTAs, held 1949, honoured 1947 releases. The constant would
  // print 1948. The Best Years of Our Lives is the film this affects.
  assert.equal(awardYearLabel(award('BAFTA', 1949)), null);
  assert.equal(awardLabel(award('BAFTA', 1949)), 'BAFTA');
  // The second ceremony onwards is trustworthy again.
  assert.equal(awardYearLabel(award('BAFTA', 1950)), 1949);
});

test('an award with no recorded year stays unlabelled', () => {
  assert.equal(awardYearLabel(award('Oscar', null)), null);
  assert.equal(awardLabel(award('Oscar', null)), 'Oscar');
});

test('an unknown award labels by its ceremony year rather than guessing', () => {
  // The safer default: a new festival list added without touching the rules is
  // correct, and only a new academy award would need a line adding.
  assert.equal(awardYearLabel(award('Locarno', 2019)), 2019);
});

// --- The seed files, read from disk ----------------------------------------
//
// Two things about the award seeds cannot fail loudly on their own, and both
// are the shape DECISIONS.md §3 collects: they produce a wrong answer without
// throwing.
//
// 1. The year rules are keyed on the SHORT name. Change "Goya" to "Goya Award"
//    in a seed file and nothing breaks — the lookup simply misses, the rule
//    defaults to no shift, and every Goya silently starts printing its
//    ceremony year instead of its film year. One year out, on every row, with
//    a green test suite.
// 2. Since the full names became "Ceremony — Prize", an award list shipped
//    without a short_name falls back to stripping the qualifier and reads as a
//    CITY: "Venezia", not "Golden Lion".
//
// Hermetic — this reads the repo's own seed files, no network and no database.
const awardSeeds = readdirSync(SEEDS)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({ file, ...JSON.parse(readFileSync(join(SEEDS, file), 'utf8')) }))
  .filter((seed) => seed.category === 'awards');

test('there are award seeds to check at all', () => {
  // Guards the guard: a filter that quietly matches nothing would make every
  // assertion below vacuously true.
  assert.ok(awardSeeds.length >= 9, `expected the award seeds, found ${awardSeeds.length}`);
});

test('every award seed carries a short name', () => {
  for (const seed of awardSeeds) {
    assert.ok(seed.short_name, `${seed.file} has no short_name, so its card would read as a city`);
  }
});

test('every award seed is named "Ceremony — Prize"', () => {
  for (const seed of awardSeeds) {
    assert.match(
      seed.name,
      /^[^—()]+ — [^—()]+$/u,
      `${seed.file}: "${seed.name}" is not "Ceremony — Prize"`,
    );
  }
});

/**
 * What each award seed must print for a ceremony held in 2000.
 *
 * Written out per file rather than derived from the tags, because the obvious
 * derivation is WRONG and this is where that gets recorded: the César is an
 * academy by every structural test — it is not tagged "festivals" — and it
 * still must not shift, since French usage names the César for its ceremony.
 * A rule of "academies shift" would silently move all 51 of them by a year.
 *
 * Known limit, stated rather than papered over: the César's correct answer IS
 * the no-rule default, so renaming its short_name cannot be caught here. The
 * other four academies are caught, which is where the loss would be silent.
 */
const CEREMONY_2000_PRINTS = {
  'award-oscar-best-picture.json': 1999,
  'award-oscar-international.json': 1999,
  'award-bafta-best-film.json': 1999,
  'award-goya-best-film.json': 1999,
  'award-cesar-best-film.json': 2000,
  'award-palme-dor.json': 2000,
  'award-cannes-grand-prix.json': 2000,
  'award-golden-lion.json': 2000,
  'award-golden-bear.json': 2000,
};

test('every award seed still prints the year it is naturally called by', () => {
  for (const seed of awardSeeds) {
    const expected = CEREMONY_2000_PRINTS[seed.file];
    assert.ok(expected, `${seed.file} is a new award list — add it to CEREMONY_2000_PRINTS`);
    assert.equal(
      awardYearLabel(award(seed.short_name, 2000)),
      expected,
      `${seed.file}: short_name "${seed.short_name}" no longer matches its year rule, so every ` +
        'one of its films is printing the wrong year',
    );
  }
});
