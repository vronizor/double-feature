/**
 * Filter panel and movie card shared between the Draw tab (draw something to
 * vote on) and the Explore tab (just browse the library) — same filters,
 * same card, so a change to either only needs making once.
 */
import { h, posterUrl, toast, formatRating, openMovieModal, originalTitleLine } from './dom.js';
import { api } from './api.js';
import { poolState } from './pool-state.js';
import { availableOccasions } from './occasions.js';

// Re-exported so views can keep importing the filter shape from here alongside
// everything else they use; it lives in pool-state.js because the singleton
// owns it.
export { emptyFilters } from './pool-state.js';

// Display order and labels for the list picker's groups. A list's category is
// free text (no CHECK constraint — this codebase already learned that lesson
// with media_type), so anything unrecognised, including NULL, falls through to
// "Uncategorised" rather than vanishing from the picker.
const CATEGORY_ORDER = ['canon', 'awards', 'festivals', 'family', 'collection', 'dynamic'];
const CATEGORY_LABELS = {
  canon: 'The canon',
  awards: 'Awards',
  festivals: 'Festivals',
  family: 'Family',
  collection: 'Collections',
  dynamic: 'Auto-updating',
  __other: 'Uncategorised',
};

const categoryKeyOf = (list) =>
  CATEGORY_ORDER.includes(list.category) ? list.category : '__other';

export function groupListsByCategory(lists) {
  const groups = new Map();
  for (const list of lists) {
    const key = categoryKeyOf(list);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(list);
  }
  const order = [...CATEGORY_ORDER, '__other'];
  return [...groups.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, items]) => ({
      key,
      label: CATEGORY_LABELS[key] ?? key,
      lists: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * The grouped list picker, shared by Draw and Explore.
 *
 * Selection is held in `poolState`, NOT written to the database: `is_active` is
 * the "opens by default" preference and belongs to the Lists tab. Ticking a box
 * here therefore changes tonight's pool without rewriting that preference or
 * leaking the change into the other tab's idea of what's in play.
 *
 * `openGroups` is a Set owned by the calling view, so which groups are expanded
 * survives that view's repaints.
 */
export function renderListPicker(lists, openGroups, onChange) {
  if (lists.length === 0) {
    return h(
      'div',
      { class: 'empty' },
      'No lists yet. Add one on the ',
      h('a', { href: '#lists' }, 'Lists'),
      ' tab, or run the seed script.',
    );
  }

  const groups = groupListsByCategory(lists);
  const allIds = lists.map((list) => list.id);
  const selectedCount = lists.filter((list) => poolState.isSelected(list.id)).length;

  const bulk = (label, ids, on) =>
    h(
      'button',
      {
        class: 'btn-sm',
        onClick: () => {
          poolState.setMany(ids, on);
          onChange();
        },
      },
      label,
    );

  return h(
    'div',
    { class: 'stack', style: 'gap:10px' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'faint' }, `${selectedCount} of ${lists.length} lists selected`),
      h('span', { class: 'spacer' }),
      bulk('Select all', allIds, true),
      bulk('Deselect all', allIds, false),
    ),
    ...groups.map((group) => {
      const ids = group.lists.map((list) => list.id);
      const selected = ids.filter((id) => poolState.isSelected(id)).length;
      const films = group.lists.reduce((sum, list) => sum + (list.resolved_count ?? 0), 0);
      // A group the host is actually using stays open across repaints; the
      // rest stay out of the way. With ~20 lists this is what keeps the panel
      // readable at all.
      const isOpen = openGroups.has(group.key) || (selected > 0 && !openGroups.has(`!${group.key}`));

      // Interacting with a group pins it open. Without this, unchecking the
      // last selected list in a group would drop `selected` to 0 and collapse
      // the group instantly — yanking the very checkbox being clicked out from
      // under the cursor.
      const pinOpen = () => {
        openGroups.delete(`!${group.key}`);
        openGroups.add(group.key);
      };

      const groupBulk = (label, on) =>
        h(
          'button',
          {
            class: 'btn-sm',
            onClick: () => {
              pinOpen();
              poolState.setMany(ids, on);
              onChange();
            },
          },
          label,
        );

      return h(
        'div',
        { class: `list-group${selected > 0 ? ' is-active' : ''}` },
        h(
          'div',
          { class: 'row list-group-head' },
          h(
            'button',
            {
              class: 'expand-link',
              onClick: () => {
                // Two markers, not one: `key` forces open, `!key` forces
                // closed. Without the explicit closed marker, collapsing a
                // group that has selections would spring straight back open
                // on the next repaint.
                if (isOpen) {
                  openGroups.delete(group.key);
                  openGroups.add(`!${group.key}`);
                } else {
                  openGroups.delete(`!${group.key}`);
                  openGroups.add(group.key);
                }
                onChange();
              },
            },
            `${isOpen ? '▾' : '▸'} ${group.label}`,
          ),
          h(
            'span',
            { class: 'faint' },
            `${group.lists.length} ${group.lists.length === 1 ? 'list' : 'lists'} · ${films.toLocaleString()} films` +
              (selected > 0 ? ` · ${selected} on` : ''),
          ),
          h('span', { class: 'spacer' }),
          groupBulk('all', true),
          groupBulk('none', false),
        ),
        isOpen
          ? h(
              'div',
              { class: 'list-picker-grid' },
              group.lists.map((list) =>
                h(
                  'div',
                  {
                    class: `list-row list-row--picker${poolState.isSelected(list.id) ? ' is-active' : ''}`,
                  },
                  h(
                    'label',
                    { class: 'check' },
                    h('input', {
                      type: 'checkbox',
                      checked: poolState.isSelected(list.id),
                      onChange: (event) => {
                        pinOpen();
                        poolState.setSelected(list.id, event.target.checked);
                        onChange();
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
            )
          : null,
      );
    }),
  );
}

/**
 * The "Tonight is…" chip row. Applying a preset replaces the pool setup
 * wholesale; the summary line underneath then shows what that produced, and
 * any hand-edit afterwards demotes the label back to "Custom" (poolState
 * handles that) so the UI never claims an occasion it is no longer showing.
 *
 * Renders nothing when no occasion can produce a pool — on a fresh install
 * with no lists, an empty row of dead chips would be worse than no row.
 */
export function renderOccasionChips(lists, facets, onApply) {
  const available = availableOccasions({ lists, facets });
  if (available.length === 0) return null;

  return h(
    'div',
    {},
    h('div', { class: 'field-label' }, 'Tonight is…'),
    h(
      'div',
      { class: 'chips' },
      ...available.map(({ occasion, filters }) =>
        h(
          'button',
          {
            class: 'chip chip--occasion',
            dataset: { state: poolState.occasion === occasion.id ? 'include' : 'off' },
            title: occasion.hint,
            onClick: () => {
              poolState.applyOccasion(occasion.id, filters);
              onApply();
            },
          },
          occasion.label,
        ),
      ),
      poolState.occasion === null
        ? h('span', { class: 'faint', style: 'align-self:center' }, 'Custom')
        : null,
    ),
  );
}

/**
 * "Top N of each ranked list" — rendered only when a selected list actually
 * carries ranks. Showing it against Criterion or Ghibli would be meaningless,
 * since an unranked list is deliberately unaffected by the cut.
 */
export function renderTopN(lists, onChange) {
  const rankedSelected = lists.filter(
    (list) => list.ranked_count > 0 && poolState.isSelected(list.id),
  );
  if (rankedSelected.length === 0) return null;

  return h(
    'div',
    {},
    h('div', { class: 'field-label' }, 'Ranked lists'),
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'muted' }, 'Top'),
      h('input', {
        type: 'number',
        min: '1',
        placeholder: 'all',
        value: poolState.filters.topN ?? '',
        style: 'width:88px',
        onInput: (event) => {
          const raw = event.target.value.trim();
          poolState.setTopN(raw === '' ? null : Number(raw));
          onChange();
        },
      }),
      h(
        'span',
        { class: 'faint' },
        `of ${rankedSelected.map((l) => l.name).join(', ')} — unranked lists are unaffected`,
      ),
    ),
  );
}

/**
 * Shared include/exclude chip row for both genres and languages: neutral →
 * include → exclude → neutral on each click. `onChange` runs after the
 * filter state is mutated in place — the caller decides what that means
 * (re-fetch a count, re-fetch a page of results, repaint, etc).
 */
function chipToggleGroup(items, group, getKey, getLabel, onChange) {
  return h(
    'div',
    { class: 'chips' },
    items.map((item) => {
      const key = getKey(item);
      const included = group.include.includes(key);
      const excluded = group.exclude.includes(key);
      const chipState = included ? 'include' : excluded ? 'exclude' : 'off';

      return h(
        'button',
        {
          class: 'chip',
          dataset: { state: chipState },
          title: 'Click to include, again to exclude, again to clear',
          onClick: () => {
            if (chipState === 'off') group.include.push(key);
            else if (chipState === 'include') {
              group.include.splice(group.include.indexOf(key), 1);
              group.exclude.push(key);
            } else {
              group.exclude.splice(group.exclude.indexOf(key), 1);
            }
            onChange();
          },
        },
        getLabel(item),
        h('span', { class: 'faint' }, ` ${item.count}`),
      );
    }),
  );
}

function rangeInputs(filters, key, unit, bounds, onChange) {
  const make = (edge) =>
    h('input', {
      type: 'number',
      value: filters[key][edge] ?? '',
      placeholder: edge === 'min' ? String(bounds.min ?? '') : String(bounds.max ?? ''),
      onInput: (event) => {
        const raw = event.target.value.trim();
        filters[key][edge] = raw === '' ? null : Number(raw);
        onChange();
      },
    });

  return h(
    'div',
    { class: 'range' },
    make('min'),
    h('span', { class: 'faint' }, '–'),
    make('max'),
    unit ? h('span', { class: 'faint' }, unit) : null,
  );
}

/**
 * The full filter panel: genre/language chips, year/runtime ranges, and the
 * "include watched" toggle. `filters` is mutated in place.
 *
 * Two distinct callbacks, not one, because a chip click and a number-input
 * keystroke need different responses: chips need a full repaint to show the
 * new pill state, but range inputs and the checkbox must NOT be repainted —
 * their native DOM state is already correct, and repainting mid-keystroke
 * would tear the input out from under the cursor and drop focus.
 *
 *   onChipChange()  — after a genre/language chip toggles (repaint expected)
 *   onValueChange() — after a range input or the watched checkbox changes
 *                     (repaint NOT expected — just re-fetch a count/page)
 *   onClear()       — "Clear filters" was clicked
 */
export function renderFilterPanel(filters, facets, { onChipChange, onValueChange, onClear }) {
  return h(
    'div',
    { class: 'card stack' },
    h(
      'div',
      { class: 'row' },
      h('h2', {}, 'Filters'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn-sm', onClick: onClear }, 'Clear filters'),
    ),
    h(
      'div',
      { class: 'filters' },
      h(
        'div',
        {},
        h('div', { class: 'field-label' }, 'Genres'),
        chipToggleGroup(facets.genres, filters.genres, (g) => g.id, (g) => g.name, onChipChange),
      ),
      h(
        'div',
        {},
        h('div', { class: 'field-label' }, 'Language'),
        chipToggleGroup(
          facets.languages.slice(0, 14),
          filters.languages,
          (l) => l.code,
          (l) => l.name,
          onChipChange,
        ),
      ),
      h(
        'div',
        { class: 'stack', style: 'gap:12px' },
        h(
          'div',
          {},
          h('div', { class: 'field-label' }, 'Year'),
          rangeInputs(
            filters,
            'year',
            null,
            { min: facets.min_year, max: facets.max_year },
            onValueChange,
          ),
        ),
        h(
          'div',
          {},
          h('div', { class: 'field-label' }, 'Runtime'),
          rangeInputs(
            filters,
            'runtime',
            'min',
            { min: facets.min_runtime, max: facets.max_runtime },
            onValueChange,
          ),
        ),
      ),
    ),
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'checkbox',
        checked: filters.includeWatched,
        onChange: (event) => {
          filters.includeWatched = event.target.checked;
          onValueChange();
        },
      }),
      h('span', {}, 'Include films already marked watched (allow rewatches)'),
    ),
  );
}

/**
 * A movie card: poster, title (+ original title when it differs), rating,
 * genres, a truncated synopsis with a "Read more" overlay, and a Mark Watched
 * action. Shared by the Draw and Explore tabs.
 *
 * `extraAction` (optional) adds one more button alongside Mark Watched —
 * "✕ Remove" on the Draw tab's Lineup cards, "+ Add to lineup" on Explore's.
 */
export function movieCard(movie, { extraAction } = {}) {
  const poster = posterUrl(movie.poster_path);
  const rating = formatRating(movie.vote_average);
  return h(
    'article',
    { class: 'movie' },
    movie.watched ? h('span', { class: 'watched-flag' }, 'watched') : null,
    poster
      ? h('img', { class: 'movie-poster', src: poster, alt: '', loading: 'lazy' })
      : h('div', { class: 'movie-poster movie-poster--empty' }, 'No poster'),
    h(
      'div',
      { class: 'movie-body' },
      // The title itself opens the detail overlay — no separate "Read more"
      // needed here. Safe only because this card has no other click behavior
      // of its own (contrast the vote screen, where the whole card is already
      // a tap target for ranking, so folding this into the title there would
      // put two different actions on the same touch surface).
      h('button', { class: 'movie-title movie-title--link', onClick: () => openMovieModal(movie) }, movie.title),
      originalTitleLine(movie),
      h(
        'div',
        { class: 'movie-meta' },
        [movie.year, movie.director].filter(Boolean).join(' · '),
        rating ? h('span', { class: 'movie-rating' }, ` · ★ ${rating}`) : null,
      ),
      h(
        'div',
        { class: 'movie-meta faint' },
        [movie.runtime ? `${movie.runtime} min` : null, movie.genres].filter(Boolean).join(' · '),
      ),
      movie.overview ? h('p', { class: 'movie-overview' }, movie.overview) : null,
    ),
    h(
      'div',
      { class: 'movie-actions' },
      h(
        'button',
        {
          class: 'btn-sm',
          onClick: async (event) => {
            try {
              await api.setWatched(movie.tmdb_id, !movie.watched);
              movie.watched = !movie.watched;
              event.target.textContent = movie.watched ? 'Watched ✓' : 'Mark watched';
            } catch (error) {
              toast(error.message, 'error');
            }
          },
        },
        movie.watched ? 'Watched ✓' : 'Mark watched',
      ),
      extraAction
        ? h(
            'button',
            { class: 'btn-sm', disabled: extraAction.disabled, onClick: extraAction.onClick },
            extraAction.label,
          )
        : null,
    ),
  );
}
