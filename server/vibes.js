/**
 * Vibes — saved starting points for a draw.
 *
 * A vibe is "which lists are in play, plus the filters that go with them",
 * stored as data so adding one is a button rather than a redeploy. That is the
 * whole point: different viewing companions want different nights, and the set
 * of them grows over time.
 *
 * A vibe resolves through tags, through pinned lists, or both. Those answer
 * different needs and neither subsumes the other:
 *
 *   tags   — "Awards night" should pick up a newly added award list on its own
 *   lists  — "Sunday with the kids" is three named lists that shouldn't drift
 *
 * Resolution is the union, so a vibe can be mostly tag-driven with one or two
 * extras pinned on.
 */

import { TAGS } from './db.js';

const clean = (value) => String(value ?? '').trim();

export function listTags(db, listId) {
  return db
    .prepare('SELECT tag FROM list_tags WHERE list_id = ? ORDER BY tag')
    .all(listId)
    .map((row) => row.tag);
}

/** tag -> how many lists carry it, for the picker's filter chips. */
export function tagCounts(db) {
  const rows = db
    .prepare('SELECT tag, COUNT(*) AS n FROM list_tags GROUP BY tag')
    .all();
  const counts = new Map(rows.map((row) => [row.tag, row.n]));
  // Report the whole vocabulary, including tags nothing carries yet, so the
  // UI can show them consistently rather than having options appear and
  // vanish as lists are retagged.
  return TAGS.map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));
}

/** The list ids a vibe resolves to: tag matches ∪ pinned lists. */
export function resolveVibe(db, vibeId) {
  const rows = db
    .prepare(
      `SELECT DISTINCT lt.list_id AS id
         FROM vibe_tags vt JOIN list_tags lt ON lt.tag = vt.tag
        WHERE vt.vibe_id = ?
       UNION
       SELECT list_id AS id FROM vibe_lists WHERE vibe_id = ?`,
    )
    .all(vibeId, vibeId);
  return rows.map((row) => row.id).sort((a, b) => a - b);
}

function hydrate(db, vibe) {
  let filters = null;
  if (vibe.filters_json) {
    try {
      filters = JSON.parse(vibe.filters_json);
    } catch {
      // A corrupt blob shouldn't take the whole tab down; the vibe just
      // applies its lists and no filters.
      filters = null;
    }
  }
  return {
    id: vibe.id,
    name: vibe.name,
    is_builtin: Boolean(vibe.is_builtin),
    position: vibe.position,
    tags: db.prepare('SELECT tag FROM vibe_tags WHERE vibe_id = ? ORDER BY tag').all(vibe.id).map((r) => r.tag),
    lists: db.prepare('SELECT list_id FROM vibe_lists WHERE vibe_id = ?').all(vibe.id).map((r) => r.list_id),
    resolved_lists: resolveVibe(db, vibe.id),
    filters,
  };
}

export function allVibes(db) {
  return db
    .prepare('SELECT * FROM vibes ORDER BY position, name COLLATE NOCASE')
    .all()
    .map((vibe) => hydrate(db, vibe));
}

export function getVibe(db, id) {
  const vibe = db.prepare('SELECT * FROM vibes WHERE id = ?').get(id);
  return vibe ? hydrate(db, vibe) : null;
}

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function writeMembership(db, vibeId, { tags, lists }) {
  if (Array.isArray(tags)) {
    db.prepare('DELETE FROM vibe_tags WHERE vibe_id = ?').run(vibeId);
    for (const tag of tags) {
      // Silently ignoring an unknown tag would make a vibe quietly resolve to
      // fewer lists than the user picked.
      if (!TAGS.includes(tag)) throw fail(`Unknown tag: ${tag}`);
      db.prepare('INSERT INTO vibe_tags (vibe_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(vibeId, tag);
    }
  }
  if (Array.isArray(lists)) {
    db.prepare('DELETE FROM vibe_lists WHERE vibe_id = ?').run(vibeId);
    for (const rawId of lists) {
      const listId = Number(rawId);
      if (!Number.isInteger(listId)) continue;
      if (!db.prepare('SELECT 1 FROM lists WHERE id = ?').get(listId)) {
        throw fail(`Unknown list: ${listId}`);
      }
      db.prepare('INSERT INTO vibe_lists (vibe_id, list_id) VALUES (?, ?) ON CONFLICT DO NOTHING')
        .run(vibeId, listId);
    }
  }
}

/**
 * Writes that touch several tables run in a transaction.
 *
 * Without one, a create whose tag list is rejected leaves the vibe row behind
 * with no tags — a vibe that resolves to nothing and that the user never
 * successfully made. Observed, not hypothetical.
 */
function inTransaction(db, work) {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createVibe(db, { name, tags = [], lists = [], filters = null }) {
  const cleanName = clean(name);
  if (!cleanName) throw fail('A vibe needs a name');
  if (db.prepare('SELECT 1 FROM vibes WHERE name = ? COLLATE NOCASE').get(cleanName)) {
    throw fail(`There is already a vibe called "${cleanName}"`);
  }
  if (tags.length === 0 && lists.length === 0) {
    throw fail('A vibe needs at least one list or tag, or it would draw from nothing');
  }

  return inTransaction(db, () => {
    const { max } = db.prepare('SELECT MAX(position) AS max FROM vibes').get();
    const { lastInsertRowid } = db
      .prepare('INSERT INTO vibes (name, is_builtin, filters_json, position) VALUES (?, 0, ?, ?)')
      .run(cleanName, filters ? JSON.stringify(filters) : null, (max ?? 0) + 1);

    const id = Number(lastInsertRowid);
    writeMembership(db, id, { tags, lists });
    return getVibe(db, id);
  });
}

export function updateVibe(db, id, patch) {
  const existing = db.prepare('SELECT * FROM vibes WHERE id = ?').get(id);
  if (!existing) throw fail('No such vibe', 404);

  return inTransaction(db, () => {
    if (patch.name !== undefined) {
      const cleanName = clean(patch.name);
      if (!cleanName) throw fail('A vibe needs a name');
      const clash = db
        .prepare('SELECT 1 FROM vibes WHERE name = ? COLLATE NOCASE AND id <> ?')
        .get(cleanName, id);
      if (clash) throw fail(`There is already a vibe called "${cleanName}"`);
      db.prepare('UPDATE vibes SET name = ? WHERE id = ?').run(cleanName, id);
    }

    if (patch.filters !== undefined) {
      db.prepare('UPDATE vibes SET filters_json = ? WHERE id = ?')
        .run(patch.filters ? JSON.stringify(patch.filters) : null, id);
    }

    writeMembership(db, id, patch);
    return getVibe(db, id);
  });
}

export function deleteVibe(db, id) {
  // Built-ins are deletable on purpose: protecting them would mean two kinds
  // of vibe and a rule to explain. They come back only if the row is gone AND
  // ensureBuiltinVibes runs on a database that never had it.
  const result = db.prepare('DELETE FROM vibes WHERE id = ?').run(id);
  if (result.changes === 0) throw fail('No such vibe', 404);
  return { deleted: true };
}
