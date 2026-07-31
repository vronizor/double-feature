import { Router } from 'express';

import { getDb, TAGS, TAG_LABELS } from '../db.js';
import { allVibes, getVibe, createVibe, updateVibe, deleteVibe, tagCounts } from '../vibes.js';
import { applyParameter } from '../parametric.js';

const router = Router();

/** The tag vocabulary, with how many lists carry each. */
router.get('/tags', (req, res) => {
  res.json({
    tags: tagCounts(getDb()).map((entry) => ({ ...entry, label: TAG_LABELS[entry.tag] ?? entry.tag })),
    vocabulary: TAGS,
  });
});

router.get('/vibes', (req, res) => {
  res.json({ vibes: allVibes(getDb()) });
});

router.post('/vibes', (req, res) => {
  const vibe = createVibe(getDb(), {
    name: req.body?.name,
    tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
    lists: Array.isArray(req.body?.lists) ? req.body.lists : [],
    filters: req.body?.filters ?? null,
  });
  res.status(201).json({ vibe });
});

router.patch('/vibes/:id', (req, res) => {
  const id = Number(req.params.id);
  const patch = {};
  for (const key of ['name', 'tags', 'lists', 'filters']) {
    if (req.body?.[key] !== undefined) patch[key] = req.body[key];
  }
  res.json({ vibe: updateVibe(getDb(), id, patch) });
});

/**
 * Gives a parametric vibe its value — "director night, but Kurosawa".
 *
 * Returns the vibe re-resolved, so the client applies the result the same way
 * it applies any other vibe. The slot list it now points at is an ordinary
 * list, which is the entire trick: nothing downstream needs to know this vibe
 * was parametric.
 */
router.post('/vibes/:id/parameter', async (req, res) => {
  const db = getDb();
  const vibe = getVibe(db, Number(req.params.id));
  if (!vibe) return res.status(404).json({ error: 'No such vibe' });
  if (!vibe.param) return res.status(400).json({ error: `"${vibe.name}" takes no parameter` });

  const value = req.body?.value;
  if (!value?.id || !value?.name) {
    return res.status(400).json({ error: 'A parameter needs an id and a name' });
  }

  const applied = await applyParameter(db, vibe, value);
  res.json({ vibe: getVibe(db, vibe.id), applied });
});

router.delete('/vibes/:id', (req, res) => {
  res.json(deleteVibe(getDb(), Number(req.params.id)));
});

export default router;
