/**
 * The pool the host is working with tonight: which lists are in play, the
 * filters over them, and which vibe (if any) produced that combination.
 *
 * A module-level singleton for the same reason `lineup.js` is one — each view
 * is torn down and rebuilt on every tab switch, so anything held in view state
 * is silently lost when you wander over to Explore and back. Picking a vibe and
 * finding it forgotten a moment later would be worse than not having vibes at
 * all.
 *
 * Deliberately NOT stored in the database. `lists.is_active` remains the
 * "in play by default when the app opens" preference, written only from the
 * Lists tab; what you pick for tonight is ephemeral and must never silently
 * rewrite that preference or leak into another host's view.
 *
 * **A list selection is not a filter.** The two used to live in one flat
 * object, which is why `clearFilters()` needed a comment explaining that it
 * deliberately did not clear the lists. They are peers here, and on the wire —
 * see the header of `server/pool.js`.
 */

// The empty filter shape: facets over film metadata, nothing about which lists
// are in play.
export const emptyFilters = () => ({
  genres: { include: [], exclude: [] },
  languages: { include: [], exclude: [] },
  // Production countries, by TMDB's full names. Declared here even though the
  // only control that sets it today is the national-cinema chip: this object is
  // the one place the filter shape is stated, and "Clear filters" clearing the
  // country should be a consequence of the shape rather than an accident of
  // what happens to be listed.
  countries: { include: [], exclude: [] },
  year: { min: null, max: null },
  runtime: { min: null, max: null },
  includeWatched: true,
  awardWinners: false,
  // Only surfaced in the UI on the Explore tab. Deliberately NOT shared
  // between views via this singleton — see `poolState.setupFor()`.
  search: '',
});

// The whole pool definition. `lists: null` means "not chosen yet", which the
// API reads as "fall back to is_active" — distinct from `[]`, which means an
// explicitly empty pool.
export const emptySetup = () => ({
  lists: null,
  topN: null,
  filters: emptyFilters(),
});

const state = {
  setup: emptySetup(),
  vibe: null,
  seeded: false,
};

export const poolState = {
  /** The filters alone — what the filter panel edits. */
  get filters() {
    return state.setup.filters;
  },

  /** The whole pool setup: selection, top-N cut, and filters. */
  get setup() {
    return state.setup;
  },

  get vibe() {
    return state.vibe;
  },

  /**
   * First load only: adopt whatever the Lists tab says is active by default.
   * Guarded by `seeded` so that deselecting every list doesn't get quietly
   * undone the next time a view mounts — an empty selection is a real choice.
   */
  seedFrom(lists) {
    if (state.seeded) return;
    state.seeded = true;
    state.setup.lists = lists.filter((list) => list.is_active).map((list) => list.id);
  },

  /** The ids currently in play, or null if nothing has been chosen yet. */
  selectedLists() {
    return state.setup.lists;
  },

  isSelected(listId) {
    return state.setup.lists?.includes(listId) ?? false;
  },

  setSelected(listId, on) {
    const current = state.setup.lists ?? [];
    const next = on
      ? current.includes(listId)
        ? current
        : [...current, listId]
      : current.filter((id) => id !== listId);
    state.setup.lists = next;
    this.markCustom();
  },

  setMany(listIds, on) {
    const current = new Set(state.setup.lists ?? []);
    for (const id of listIds) {
      if (on) current.add(id);
      else current.delete(id);
    }
    state.setup.lists = [...current];
    this.markCustom();
  },

  setTopN(value) {
    state.setup.topN = Number.isInteger(value) && value > 0 ? value : null;
    this.markCustom();
  },

  /**
   * Any hand-edit drops the vibe label. Without this the UI would go on
   * claiming "Awards" while showing a pool the host has since changed, which
   * is worse than showing no label at all.
   */
  markCustom() {
    state.vibe = null;
  },

  /**
   * Adopts a vibe's {lists, filters} as tonight's pool setup.
   *
   * structuredClone, not a spread. A spread is shallow, so
   * `state.setup.filters.genres` would BE the caller's `genres` object — and
   * the filter panel mutates those in place (`group.include.push(key)` in
   * `browse.js`, `filters[key][edge] = …` in its range inputs). The cached vibe
   * list from `/api/vibes` is therefore edited by ordinary chip clicks: apply
   * Family, click the Animation chip, apply something else, apply Family again,
   * and Family now means Family-plus-Animation while the chip still reads
   * "Family". Deep-copying here rather than at the call site because this is
   * the single point every vibe comes through.
   */
  applyVibe(id, setup) {
    state.setup = structuredClone({ ...emptySetup(), ...setup });
    state.vibe = id;
  },

  clearFilters() {
    // The list selection is not a filter and is untouched. Top-N IS reset,
    // even though it lives beside `lists` in the API rather than inside
    // `filters` -- because it is now rendered in the Filters card, and a
    // "Clear filters" button that visibly leaves a control set is lying about
    // what it did. Placement decides the expectation, not the data shape.
    state.setup.filters = emptyFilters();
    state.setup.topN = null;
    state.vibe = null;
  },

  /**
   * The pool setup to send for a request. `search` is merged in per-view rather
   * than held here on purpose: it's a transient "find me this thing" action on
   * Explore, and sharing it would mean typing a title there silently shrank the
   * Draw pool to one film with no visible cause.
   */
  setupFor({ search = '' } = {}) {
    return { ...state.setup, filters: { ...state.setup.filters, search } };
  },
};
