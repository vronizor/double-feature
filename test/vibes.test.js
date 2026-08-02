import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb, ensureBuiltinVibes } from '../server/db.js';
import {
  resolveVibe,
  createVibe,
  updateVibe,
  deleteVibe,
  allVibes,
  tagCounts,
} from '../server/vibes.js';

function seed() {
  const db = createTestDb();
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES
    (1, 'Criterion', 'seed', 1),
    (2, 'TSPDT', 'seed', 1),
    (3, 'Ghibli', 'seed', 1),
    (4, 'Oscars', 'seed', 1),
    (5, 'Custom untagged', 'custom', 0)`);

  const tag = (listId, ...tags) => {
    for (const t of tags) {
      db.prepare('INSERT INTO list_tags (list_id, tag) VALUES (?, ?)').run(listId, t);
    }
  };
  // The case that broke the old single-category model: Criterion is both.
  tag(1, 'collection', 'canon');
  tag(2, 'canon');
  tag(3, 'collection', 'family', 'animation');
  tag(4, 'awards');
  return db;
}

test('a list can carry several tags, which is the whole point', () => {
  // Under one-category-per-list, "Cinephile" resolved on canon alone and
  // silently dropped Criterion — 1,227 films — because it was filed as a
  // collection. This is the regression test for that.
  const db = seed();
  const vibe = createVibe(db, { name: 'Cinephile', tags: ['canon'] });
  assert.deepEqual(vibe.resolved_lists, [1, 2], 'Criterion is in the canon vibe');
});

test('a vibe resolves to the union of its tags and its pinned lists', () => {
  const db = seed();
  const vibe = createVibe(db, { name: 'Mixed', tags: ['awards'], lists: [3] });
  assert.deepEqual(vibe.resolved_lists, [3, 4]);
});

test('a tag-driven vibe picks up a newly tagged list without being edited', () => {
  // This is why tags exist alongside pinned lists: "Awards night" should
  // absorb a new award list on its own.
  const db = seed();
  const vibe = createVibe(db, { name: 'Awards', tags: ['awards'] });
  assert.deepEqual(vibe.resolved_lists, [4]);

  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (6, 'BAFTA', 'seed', 1)`);
  db.prepare('INSERT INTO list_tags (list_id, tag) VALUES (6, ?)').run('awards');
  assert.deepEqual(resolveVibe(db, vibe.id), [4, 6]);
});

test('a pinned list does NOT drift when the library grows', () => {
  const db = seed();
  const vibe = createVibe(db, { name: 'Kids', lists: [3] });
  db.exec(`INSERT INTO lists (id, name, origin, is_active) VALUES (7, 'Disney', 'seed', 1)`);
  db.prepare('INSERT INTO list_tags (list_id, tag) VALUES (7, ?)').run('family');
  assert.deepEqual(resolveVibe(db, vibe.id), [3], 'still exactly what was pinned');
});

test('a vibe with neither tags nor lists is refused', () => {
  const db = seed();
  assert.throws(() => createVibe(db, { name: 'Empty' }), /at least one list or tag/);
});

test('an unknown tag is rejected and leaves nothing behind', () => {
  // Regression: the insert used to happen before membership was validated, so
  // a rejected tag left an orphan vibe that resolved to no lists at all.
  const db = seed();
  assert.throws(() => createVibe(db, { name: 'Bad', tags: ['nonsense'] }), /Unknown tag/);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM vibes WHERE name = 'Bad'").get().c, 0);
});

test('duplicate names are refused case-insensitively', () => {
  const db = seed();
  createVibe(db, { name: 'Family', tags: ['family'] });
  assert.throws(() => createVibe(db, { name: 'family', tags: ['family'] }), /already a vibe/);
});

test('updating membership replaces rather than appends', () => {
  const db = seed();
  const vibe = createVibe(db, { name: 'V', tags: ['canon'] });
  const updated = updateVibe(db, vibe.id, { tags: ['awards'] });
  assert.deepEqual(updated.tags, ['awards']);
  assert.deepEqual(updated.resolved_lists, [4]);
});

test('a failed update rolls back, leaving the vibe as it was', () => {
  const db = seed();
  const vibe = createVibe(db, { name: 'V', tags: ['canon'] });
  assert.throws(() => updateVibe(db, vibe.id, { tags: ['nope'] }), /Unknown tag/);
  assert.deepEqual(resolveVibe(db, vibe.id), [1, 2], 'original tags survived');
});

test('deleting a vibe leaves the lists untouched', () => {
  const db = seed();
  const vibe = createVibe(db, { name: 'V', tags: ['canon'], lists: [3] });
  deleteVibe(db, vibe.id);
  assert.equal(allVibes(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM lists').get().c, 5);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM list_tags').get().c, 7);
});

test('deleting a vibe that does not exist is a 404, not a silent success', () => {
  const db = seed();
  assert.throws(() => deleteVibe(db, 999), (error) => error.status === 404);
});

test('tag counts report the whole vocabulary, including unused tags', () => {
  // So the picker's chips stay stable rather than appearing and vanishing as
  // lists are retagged.
  const db = seed();
  const counts = new Map(tagCounts(db).map((entry) => [entry.tag, entry.count]));
  assert.equal(counts.get('canon'), 2);
  assert.equal(counts.get('collection'), 2);
  assert.equal(counts.get('comedy'), 0, 'unused tags are still listed');
  assert.ok(counts.has('box-office'));
});

test('built-in vibes are seeded once and never re-added after deletion', () => {
  const db = seed();
  ensureBuiltinVibes(db);
  const first = allVibes(db).map((v) => v.name).sort();
  assert.deepEqual(first, [
    "Actor's night",
    'Awards',
    'Box office',
    'Cinephile',
    'Director night',
    'Family',
    'Modern Classics',
  ]);

  // Idempotent.
  ensureBuiltinVibes(db);
  assert.equal(allVibes(db).length, 7);

  // Built-ins are ordinary rows, so deleting one works.
  const family = allVibes(db).find((v) => v.name === 'Family');
  deleteVibe(db, family.id);
  assert.equal(allVibes(db).length, 6);
});

test('the Box office built-in gathers the box-office lists and cuts to the top 5', () => {
  const db = seed();
  ensureBuiltinVibes(db);

  const boxOffice = allVibes(db).find((v) => v.name === 'Box office');
  assert.deepEqual(boxOffice.tags, ['box-office'], 'tag-driven, so a fourth country joins on its own');
  // The cut is what makes it a vibe rather than a tag shortcut: without it the
  // chip means "every box-office row we hold", which is not a night's shape.
  assert.equal(boxOffice.filters.topN, 5);
});

test('the Family built-in carries a filter, not just a list selection', () => {
  const db = seed();
  db.exec(`INSERT INTO genres (id, name) VALUES (27, 'Horror')`);
  ensureBuiltinVibes(db);
  const family = allVibes(db).find((v) => v.name === 'Family');
  assert.deepEqual(family.filters.genres.exclude, [27]);
});

test('a corrupt filters blob degrades to no filters instead of throwing', () => {
  const db = seed();
  const vibe = createVibe(db, { name: 'V', tags: ['canon'] });
  db.prepare('UPDATE vibes SET filters_json = ? WHERE id = ?').run('{not json', vibe.id);
  assert.equal(allVibes(db)[0].filters, null);
});

// --- Parametric vibes -----------------------------------------------------

test('a parametric vibe carries its parameter and resolves to nothing until given one', () => {
  const db = seed();
  ensureBuiltinVibes(db);
  const director = allVibes(db).find((v) => v.name === 'Director night');

  assert.deepEqual(director.param, { kind: 'person', job: 'Director', label: 'Director' });
  // No tags, no lists: until a person is chosen there is nothing to draw from,
  // and it must not silently fall back to the whole library.
  assert.deepEqual(director.resolved_lists, []);
});

test('an ordinary vibe has no parameter', () => {
  const db = seed();
  ensureBuiltinVibes(db);
  assert.equal(allVibes(db).find((v) => v.name === 'Cinephile').param, null);
});

test('applying a parameter fills one slot list, and re-applying replaces it', async () => {
  const db = seed();
  ensureBuiltinVibes(db);
  const vibe = allVibes(db).find((v) => v.name === 'Director night');

  const realFetch = globalThis.fetch;
  const credits = (films) => ({
    ok: true,
    status: 200,
    json: async () => ({ crew: films.map((f) => ({ ...f, job: 'Director' })), cast: [] }),
  });
  globalThis.fetch = async (input) =>
    String(input).includes('/movie_credits')
      ? credits(kurosawa)
      : { ok: true, status: 200, json: async () => ({ id: 1, title: 'x' }) };

  let kurosawa = [
    { id: 9001, title: 'Ikiru', release_date: '1952-10-09' },
    { id: 9002, title: 'Ran', release_date: '1985-06-01' },
  ];
  // Both already cached, so no detail fetch is needed and the stub above is
  // never asked for a movie.
  db.exec(`INSERT INTO movies (tmdb_id, title, year) VALUES (9001,'Ikiru',1952), (9002,'Ran',1985)`);

  const { applyParameter } = await import('../server/parametric.js');
  const first = await applyParameter(db, vibe, { id: 5026, name: 'Akira Kurosawa' });

  assert.equal(first.count, 2);
  assert.equal(first.name, 'Director night — Akira Kurosawa');
  assert.equal(
    db.prepare('SELECT name FROM lists WHERE id = ?').get(first.list_id).name,
    'Director night — Akira Kurosawa',
  );
  // Hidden, so it never appears in the picker.
  assert.equal(db.prepare('SELECT hidden FROM lists WHERE id = ?').get(first.list_id).hidden, 1);
  // And the vibe now resolves to it.
  assert.deepEqual(allVibes(db).find((v) => v.id === vibe.id).resolved_lists, [first.list_id]);

  // A second director REPLACES the first rather than accumulating: one slot
  // list forever, not one per person ever chosen.
  kurosawa = [{ id: 9003, title: 'Tokyo Story', release_date: '1953-11-03' }];
  db.exec(`INSERT INTO movies (tmdb_id, title, year) VALUES (9003,'Tokyo Story',1953)`);
  const second = await applyParameter(db, vibe, { id: 5027, name: 'Yasujiro Ozu' });

  assert.equal(second.list_id, first.list_id, 'the same slot list is reused');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lists WHERE hidden = 1').get().n, 1);
  assert.deepEqual(
    db.prepare('SELECT tmdb_id FROM list_movies WHERE list_id = ?').all(second.list_id)
      .map((r) => r.tmdb_id),
    [9003],
  );
  assert.equal(
    db.prepare('SELECT name FROM lists WHERE id = ?').get(second.list_id).name,
    'Director night — Yasujiro Ozu',
  );

  globalThis.fetch = realFetch;
});

test('a vibe that takes no parameter refuses one', async () => {
  const db = seed();
  ensureBuiltinVibes(db);
  const { applyParameter } = await import('../server/parametric.js');
  const cinephile = allVibes(db).find((v) => v.name === 'Cinephile');
  await assert.rejects(
    () => applyParameter(db, cinephile, { id: 1, name: 'Someone' }),
    /not a parametric vibe/,
  );
});
