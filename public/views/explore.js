import { h, clear, plural, toast, preserveFocus } from '../dom.js';
import { api } from '../api.js';
import {
  renderFilterPanel,
  selectionLabel,
  renderListPicker,
  renderAwardsToggle,
  renderRatingToggle,
  createPoolDestination,
  renderTagFilter,
  movieCard,
} from '../browse.js';
import { lineup } from '../lineup.js';
import { poolState } from '../pool-state.js';

const PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_INPUT_ID = 'explore-search';

const SORTS = [
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'rating', label: 'Rating (highest)' },
  { value: 'year_desc', label: 'Year (newest)' },
  { value: 'year_asc', label: 'Year (oldest)' },
  { value: 'runtime', label: 'Runtime (longest)' },
];

/**
 * Browse the library outside of drawing: same filters and cards as the Draw
 * tab (shared via browse.js), but a sorted, paginated page of everything that
 * matches rather than a random N-sized sample to vote on.
 */
export async function renderExplore(container) {
  const state = {
    lists: [],
    facets: null,
    // Explore's own, deliberately NOT in the shared pool state: it's a
    // transient "find me this thing" action, and sharing it would mean typing
    // a title here silently shrank the Draw pool with no visible cause.
    search: '',
    openGroups: new Set(),
    tagFilter: null,
    vocabulary: [],
    sort: 'title',
    movies: [],
    total: 0,
    offset: 0,
    loading: false,
  };

  async function refreshData() {
    const [{ lists }, facets, { tags }] = await Promise.all([
      api.lists(),
      api.facets(poolState.selectedLists()),
      api.tags(),
    ]);
    state.lists = lists;
    state.facets = facets;
    state.vocabulary = tags;
    poolState.seedFrom(lists);
  }

  /** `reset: true` replaces the grid (filters/sort changed); otherwise appends the next page ("Load more"). */
  async function loadPage({ reset = false } = {}) {
    state.loading = true;
    if (reset) state.offset = 0;
    paint();

    try {
      const { movies, total } = await api.poolMovies(poolState.setupFor({ search: state.search }), {
        sort: state.sort,
        limit: PAGE_SIZE,
        offset: state.offset,
      });
      state.movies = reset ? movies : [...state.movies, ...movies];
      state.total = total;
      state.offset = state.movies.length;
    } finally {
      state.loading = false;
      paint();
    }
  }

  // Same reasoning as draw.js: refetch facets when the list SELECTION changes,
  // not when a filter does.
  let facetToken = 0;
  async function refreshFacets() {
    const token = ++facetToken;
    try {
      const facets = await api.facets(poolState.selectedLists());
      if (token === facetToken) {
        state.facets = facets;
        paint();
      }
    } catch {
      // Stale chip counts are survivable.
    }
  }

  function listPicker() {
    if (state.lists.length === 0) return null;
    return renderListPicker(
      state.lists,
      state.openGroups,
      () => {
        refreshFacets();
        loadPage({ reset: true });
      },
      { vocabulary: state.vocabulary, tagFilter: state.tagFilter },
    );
  }

  /**
   * The pool controls, for the rail or the sheet. Same three panels the Draw
   * tab shows, in the same order — which is what its own subtitle has always
   * promised and the chrome did not deliver: Explore laid its picker out flat
   * and expanded while Draw had folded it away behind a summary.
   */
  function poolSetupContent() {
    return h(
      'div',
      { class: 'stack' },
      h('div', { class: 'field-label' }, 'Lists in play'),
      renderTagFilter(state.vocabulary, state.tagFilter, (tag) => {
        state.tagFilter = tag;
        paint();
      }),
      listPicker(),
      filterPanel(),
    );
  }

  const poolDestination = createPoolDestination({
    content: () => poolSetupContent(),
    repaint: () => paint(),
  });

  let searchDebounce = null;
  function searchBox() {
    return h(
      'div',
      { class: 'row' },
      h('input', {
        type: 'search',
        id: SEARCH_INPUT_ID,
        placeholder: 'Search by title or director…',
        value: state.search,
        style: 'max-width:340px',
        onInput: (event) => {
          state.search = event.target.value;
          clearTimeout(searchDebounce);
          // Debounced rather than firing per keystroke — this repaints (the
          // results grid has to update), and a repaint mid-keystroke would
          // otherwise drop focus out of the very box being typed into.
          searchDebounce = setTimeout(() => loadPage({ reset: true }), SEARCH_DEBOUNCE_MS);
        },
      }),
    );
  }

  function filterPanel() {
    if (!state.facets) return null;
    return renderFilterPanel(poolState.filters, state.facets, {
      lists: state.lists,
      onTopNChange: () => loadPage({ reset: true }),
      onChipChange: () => {
        poolState.markCustom();
        loadPage({ reset: true });
      },
      onValueChange: () => {
        poolState.markCustom();
        loadPage({ reset: true });
      },
      onClear: () => {
        poolState.clearFilters();
        state.search = '';
        loadPage({ reset: true });
      },
    });
  }

  function sortControl() {
    return h(
      'div',
      { class: 'row' },
      h('div', { class: 'field-label' }, 'Sort'),
      h(
        'select',
        {
          style: 'max-width:220px',
          onChange: (event) => {
            state.sort = event.target.value;
            loadPage({ reset: true });
          },
        },
        SORTS.map((option) =>
          h(
            'option',
            { value: option.value, selected: option.value === state.sort },
            option.label,
          ),
        ),
      ),
      renderAwardsToggle(paint),
      renderRatingToggle(paint),
      h('span', { class: 'spacer' }),
      h(
        'span',
        { class: 'pool-count muted' },
        // Without this, choosing a director shows ten films and nothing says
        // whose they are — it reads as the library having changed.
        selectionLabel(state.lists)
          ? h('span', { class: 'selection-label' }, selectionLabel(state.lists), ' · ')
          : null,
        state.total === 0 && !state.loading
          ? 'No films match'
          : // plural() ALREADY prefixes the count, so wrapping the number in its
            // own element beside it printed "1750 1750 films match" on every
            // load. The number is emphasised by splitting the string here
            // rather than by counting it twice.
            h(
              'span',
              {},
              h('strong', {}, state.total.toLocaleString()),
              ` ${state.total === 1 ? 'film' : 'films'} match`,
            ),
      ),
    );
  }

  // Mirrors draw.js's own lineup cards — same lineup, just added from here
  // instead of by drawing or searching TMDB directly.
  function addToLineup(movie) {
    if (!lineup.add(movie)) return;
    toast(`Added ${movie.title} to the lineup`, 'ok');
    paint();
  }

  function resultsGrid() {
    if (state.loading && state.movies.length === 0) {
      return h('div', { class: 'loading' }, 'Loading…');
    }
    if (state.movies.length === 0) {
      return h('div', { class: 'empty' }, 'Nothing matches those filters.');
    }

    return h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'movie-grid' },
        state.movies.map((movie) =>
          movieCard(movie, {
            extraAction: {
              label: lineup.has(movie.tmdb_id) ? 'In lineup ✓' : '+ Add to lineup',
              disabled: lineup.has(movie.tmdb_id),
              onClick: () => addToLineup(movie),
            },
          }),
        ),
      ),
      state.movies.length < state.total
        ? h(
            'div',
            { class: 'row', style: 'justify-content:center' },
            h(
              'button',
              { disabled: state.loading, onClick: () => loadPage() },
              state.loading ? 'Loading…' : `Load more (${state.total - state.movies.length} left)`,
            ),
          )
        : null,
    );
  }

  function paint() {
    // Every control the host might be mid-edit on has to survive this, not just
    // the search box. `browse.js` documents that range inputs must never be
    // repainted; Explore cannot honour that literally, because a filter change
    // has to redraw the results grid, so it repaints and puts the caret back
    // instead. Before this, typing "1960" into the year field landed the 1 and
    // sent "960" to `<body>`.
    const restoreFocus = preserveFocus(container);

    clear(container).append(
      h(
        'div',
        { class: 'draw-shell' },
        h(
          'div',
          { class: 'stack draw-main' },
          h('h2', {}, 'Explore the library'),
          h(
            'p',
            { class: 'muted' },
            'Browse every film across your active lists — same filters as Draw, no voting involved.',
          ),
          // The controls left the column entirely: there used to be ~1,600px of
          // them above the first poster, on a tab whose heading is an
          // instruction to look at the library.
          poolDestination.opener(),
          searchBox(),
          sortControl(),
          resultsGrid(),
        ),
        poolDestination.rail(),
      ),
    );

    poolDestination.sync();
    restoreFocus();
  }

  await refreshData();
  await loadPage({ reset: true });
}
