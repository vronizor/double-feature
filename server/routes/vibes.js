import { Router } from 'express';

import { getDb, TAGS, TAG_LABELS } from '../db.js';
import { allVibes, createVibe, updateVibe, deleteVibe, tagCounts } from '../vibes.js';

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

router.delete('/vibes/:id', (req, res) => {
  res.json(deleteVibe(getDb(), Number(req.params.id)));
});

export default router;
