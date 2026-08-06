/**
 * Whose device this is, and which films they have saved.
 *
 * A module-level singleton for the same reason `lineup.js` is one — every view
 * is torn down and rebuilt on each tab switch, so the Save button on a card in
 * Explore and the one on a card in the lineup have to read the same store or
 * they will disagree about whether a film is already saved.
 *
 * **Pure state. It makes no requests.** A caller does the API call and then
 * tells this module what happened, exactly as the lineup does. That keeps the
 * one thing worth testing here — the identity rules — hermetic, and it keeps
 * the network in the view where every other call in this app already sits.
 *
 * Deliberately NOT part of `prefs.js`, which is scoped to "how things are
 * shown, never what gets drawn". Who you are is neither: it decides where a
 * Save goes, and getting it wrong writes to another person's list.
 */

// Separate from the prefs blob so that clearing display preferences cannot
// take a device's identity with it, and so a future prefs reset does not
// silently orphan someone's watchlist.
const OWNER_KEY = 'double-feature:owner';

function read() {
  try {
    return localStorage.getItem(OWNER_KEY) || null;
  } catch {
    // Private-mode Safari throws on access rather than returning null, the
    // same case `prefs.js` handles. An unclaimed device is a working device:
    // it just gets asked who it is again.
    return null;
  }
}

const state = {
  owner: read(),
  // The id of THIS device owner's watchlist, once it has been found in a
  // /api/lists payload. Null means either unclaimed or not looked up yet, and
  // the two are distinguished by `owner`.
  listId: null,
  ids: new Set(),
};

export const watchlist = {
  get owner() {
    return state.owner;
  },

  /** Whether this device knows who is using it. */
  get claimed() {
    return state.owner !== null;
  },

  /** The list id, or null if this device has no watchlist on the server yet. */
  get listId() {
    return state.listId;
  },

  get size() {
    return state.ids.size;
  },

  /**
   * Records who is using this device. Returns the trimmed name.
   *
   * Trimmed and refused when empty for the same reason the server refuses an
   * empty owner: a blank identity would match every other blank one, so two
   * people who both skipped the question would silently share a watchlist.
   */
  claim(name) {
    const owner = String(name ?? '').trim();
    if (!owner) throw new Error('A name is required');
    state.owner = owner;
    try {
      localStorage.setItem(OWNER_KEY, owner);
    } catch {
      // Not persisting is survivable — the identity holds for this session and
      // the device asks again next time, which is annoying rather than wrong.
    }
    return owner;
  },

  /**
   * Finds this device's watchlist in a /api/lists payload.
   *
   * Matched on `owner` and never on the list's name, which is the whole reason
   * the server stores the owner as a column. This project has twice shipped a
   * name serving as identity — `builtin_key` for vibes, `seed_key` for lists —
   * and both times a rename detached the row from whatever was looking for it.
   * Renaming "Alice's watchlist" to "Alice's pile" must not make this device
   * think it has none and offer to create a second.
   *
   * Returns the list, or null when this person has not saved anything yet.
   */
  adopt(lists) {
    if (!state.owner) return null;
    const mine = (lists ?? []).find((list) => list.owner === state.owner) ?? null;
    state.listId = mine?.id ?? null;
    // A watchlist that has gone (deleted from the Lists tab) takes its films
    // with it, or the Save buttons would go on claiming a film is saved to a
    // list that no longer exists.
    if (!mine) state.ids.clear();
    return mine;
  },

  /** Replaces the saved set — what a fresh read of the list's entries gives. */
  fill(tmdbIds) {
    state.ids = new Set(tmdbIds ?? []);
  },

  has(tmdbId) {
    return state.ids.has(tmdbId);
  },

  /** After a successful save. Idempotent, matching the endpoint it follows. */
  remember(tmdbId) {
    state.ids.add(tmdbId);
  },

  /** After a successful removal. */
  forget(tmdbId) {
    state.ids.delete(tmdbId);
  },

  /**
   * The name a newly created watchlist gets.
   *
   * Here rather than at the call site so the string is written once: the
   * server enforces UNIQUE on `lists.name`, so two call sites disagreeing by
   * an apostrophe would produce a 400 nobody could explain. The host can
   * rename it afterwards from the Lists tab like any other list — the owner
   * is what this module matches on, so a rename costs nothing.
   */
  nameFor(owner = state.owner) {
    return `${owner}’s watchlist`;
  },

  /** Test seam, and the "not me" path if a device is ever handed over. */
  reset() {
    state.owner = null;
    state.listId = null;
    state.ids.clear();
    try {
      localStorage.removeItem(OWNER_KEY);
    } catch {
      // Same as claim(): failing to persist does not make the reset untrue.
    }
  },
};
