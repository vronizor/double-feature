import { h, clear, plural, toast } from '../dom.js';
import { api } from '../api.js';
import { emptyFilters, renderFilterPanel, movieCard } from '../browse.js';
import { lineup } from '../lineup.js';

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
    filters: emptyFilters(),
    sort: 'title',
    movies: [],
    total: 0,
    offset: 0,
    loading: false,
  };

  async function refreshData() {
    const [{ lists }, facets] = await Promise.all([api.lists(), api.facets()]);
    state.lists = lists;
    state.facets = facets;
  }

  /** `reset: true` replaces the grid (filters/sort changed); otherwise appends the next page ("Load more"). */
  async function loadPage({ reset = false } = {}) {
    state.loading = true;
    if (reset) state.offset = 0;
    paint();

    try {
      const { movies, total } = await api.poolMovies(state.filters, {
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

  function listPicker() {
    if (state.lists.length === 0) return null;

    return h(
      'div',
      { class: 'list-picker-grid' },
      state.lists.map((list) =>
        h(
          'div',
          { class: `list-row list-row--picker${list.is_active ? ' is-active' : ''}` },
          h(
            'label',
            { class: 'check' },
            h('input', {
              type: 'checkbox',
              checked: Boolean(list.is_active),
              onChange: async (event) => {
                await api.updateList(list.id, { is_active: event.target.checked });
                await refreshData();
                await loadPage({ reset: true });
              },
            }),
            h('span', { class: 'list-name' }, list.name),
          ),
          h(
            'div',
            { class: 'list-row-badges' },
            h('span', { class: 'badge' }, `${list.resolved_count} films`),
            list.review_count > 0
              ? h('span', { class: 'badge badge-warn' }, `${list.review_count} to review`)
              : null,
          ),
        ),
      ),
    );
  }

  let searchDebounce = null;
  function searchBox() {
    return h(
      'div',
      { class: 'row' },
      h('input', {
        type: 'search',
        id: SEARCH_INPUT_ID,
        placeholder: 'Search by title or director…',
        value: state.filters.search,
        style: 'max-width:340px',
        onInput: (event) => {
          state.filters.search = event.target.value;
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
    return renderFilterPanel(state.filters, state.facets, {
      onChipChange: () => loadPage({ reset: true }),
      onValueChange: () => loadPage({ reset: true }),
      onClear: () => {
        state.filters = emptyFilters();
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
      h('span', { class: 'spacer' }),
      h(
        'span',
        { class: 'pool-count muted' },
        state.total === 0 && !state.loading
          ? 'No films match'
          : h('span', {}, h('strong', {}, String(state.total)), ` ${plural(state.total, 'film', 'films')} match`),
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
    // The search box is the one control here a host might pause mid-typing on
    // and then continue — a full repaint (needed either way, since the grid
    // has to update) would otherwise silently kick focus out of it.
    const active = document.activeElement;
    const focusedSearch =
      active?.id === SEARCH_INPUT_ID
        ? { selectionStart: active.selectionStart, selectionEnd: active.selectionEnd }
        : null;

    clear(container).append(
      h(
        'div',
        { class: 'stack' },
        h('h2', {}, 'Explore the library'),
        h(
          'p',
          { class: 'muted' },
          'Browse every film across your active lists — same filters as Draw, no voting involved.',
        ),
        listPicker(),
        searchBox(),
        filterPanel(),
        sortControl(),
        resultsGrid(),
      ),
    );

    if (focusedSearch) {
      const input = container.querySelector(`#${SEARCH_INPUT_ID}`);
      input?.focus();
      input?.setSelectionRange(focusedSearch.selectionStart, focusedSearch.selectionEnd);
    }
  }

  await refreshData();
  await loadPage({ reset: true });
}
