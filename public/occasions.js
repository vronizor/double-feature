/**
 * "Tonight is…" — applying and creating vibes.
 *
 * Vibes now live in the database rather than being hardcoded here, because the
 * set of them is personal and grows: different viewing companions want
 * different nights, and adding one should be a button rather than a redeploy.
 * What remains in this file is the client-side half — turning a vibe into pool
 * state, and turning the current pool state back into a saveable vibe.
 *
 * A vibe is a STARTING POINT, never a mode. Applying one fills in the pool
 * setup; editing anything afterwards demotes the chip to "Custom" rather than
 * letting the UI keep claiming a vibe it no longer matches.
 */

import { poolState, emptyFilters } from './pool-state.js';

/**
 * Applies a vibe: its resolved lists become the selection, and its filters
 * replace the current ones.
 *
 * `resolved_lists` is computed server-side (tag matches ∪ pinned lists) so the
 * client never has to reimplement that union — and so a tag-driven vibe picks
 * up a newly added list without the frontend knowing anything changed.
 */
export function applyVibe(vibe) {
  poolState.applyOccasion(vibe.id, {
    ...emptyFilters(),
    ...(vibe.filters ?? {}),
    lists: [...vibe.resolved_lists],
  });
}

/**
 * The payload for saving the current pool setup as a new vibe.
 *
 * Deliberately saves the CONCRETE list selection rather than trying to infer
 * which tags the user "meant". Guessing would make the saved vibe drift later
 * in ways they never asked for; if they want tag-driven behaviour they can say
 * so explicitly. Search is excluded — it's a transient find-a-title action,
 * not part of a night's shape.
 */
export function currentAsVibe(name) {
  const { search, lists, ...filters } = poolState.filters;
  return {
    name,
    tags: [],
    lists: lists ?? [],
    filters,
  };
}

/** Whether a vibe exactly matches the current pool selection. */
export function vibeMatchesCurrent(vibe) {
  const selected = poolState.selectedLists();
  if (selected === null) return false;
  const a = [...selected].sort((x, y) => x - y).join(',');
  const b = [...vibe.resolved_lists].sort((x, y) => x - y).join(',');
  return a === b;
}
