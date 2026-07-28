/**
 * The pool the host is working with tonight: which lists are in play, the
 * filters over them, and which "occasion" preset (if any) produced that
 * combination.
 *
 * A module-level singleton for the same reason `lineup.js` is one — each view
 * is torn down and rebuilt on every tab switch, so anything held in view state
 * is silently lost when you wander over to Explore and back. Picking an
 * occasion and finding it forgotten a moment later would be worse than not
 * having occasions at all.
 *
 * Deliberately NOT stored in the database. `lists.is_active` remains the
 * "in play by default when the app opens" preference, written only from the
 * Lists tab; what you pick for tonight is ephemeral and must never silently
 * rewrite that preference or leak into another host's view.
 */

// The empty filter shape, shared by every view. `lists` is a real selection of
// list ids; `null` means "not chosen yet", which the API reads as "fall back to
// is_active" — distinct from `[]`, which means an explicitly empty pool.
export const emptyFilters = () => ({
  genres: { include: [], exclude: [] },
  languages: { include: [], exclude: [] },
  year: { min: null, max: null },
  runtime: { min: null, max: null },
  includeWatched: true,
  lists: null,
  topN: null,
  // Only surfaced in the UI on the Explore tab. Deliberately NOT shared
  // between views via this singleton — see `poolState.filtersFor()`.
  search: '',
});

const state = {
  filters: emptyFilters(),
  occasion: null,
  seeded: false,
};

export const poolState = {
  get filters() {
    return state.filters;
  },

  get occasion() {
    return state.occasion;
  },

  /**
   * First load only: adopt whatever the Lists tab says is active by default.
   * Guarded by `seeded` so that deselecting every list doesn't get quietly
   * undone the next time a view mounts — an empty selection is a real choice.
   */
  seedFrom(lists) {
    if (state.seeded) return;
    state.seeded = true;
    state.filters.lists = lists.filter((list) => list.is_active).map((list) => list.id);
  },

  /** The ids currently in play, or null if nothing has been chosen yet. */
  selectedLists() {
    return state.filters.lists;
  },

  isSelected(listId) {
    return state.filters.lists?.includes(listId) ?? false;
  },

  setSelected(listId, on) {
    const current = state.filters.lists ?? [];
    const next = on
      ? current.includes(listId)
        ? current
        : [...current, listId]
      : current.filter((id) => id !== listId);
    state.filters.lists = next;
    this.markCustom();
  },

  setMany(listIds, on) {
    const current = new Set(state.filters.lists ?? []);
    for (const id of listIds) {
      if (on) current.add(id);
      else current.delete(id);
    }
    state.filters.lists = [...current];
    this.markCustom();
  },

  setTopN(value) {
    state.filters.topN = Number.isInteger(value) && value > 0 ? value : null;
    this.markCustom();
  },

  /**
   * Any hand-edit drops the occasion label. Without this the UI would go on
   * claiming "Awards" while showing a pool the host has since changed, which
   * is worse than showing no label at all.
   */
  markCustom() {
    state.occasion = null;
  },

  applyOccasion(id, filters) {
    state.filters = { ...emptyFilters(), ...filters };
    state.occasion = id;
  },

  clearFilters() {
    // Keeps the list selection: "clear filters" means the genre/year/runtime
    // narrowing, not "throw away which lists I'm drawing from".
    const lists = state.filters.lists;
    state.filters = { ...emptyFilters(), lists };
    state.occasion = null;
  },

  /**
   * The filter object to send for a request. `search` is merged in per-view
   * rather than held here on purpose: it's a transient "find me this thing"
   * action on Explore, and sharing it would mean typing a title there
   * silently shrank the Draw pool to one film with no visible cause.
   */
  filtersFor({ search = '' } = {}) {
    return { ...state.filters, search };
  },
};
