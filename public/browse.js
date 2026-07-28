/**
 * Filter panel and movie card shared between the Draw tab (draw something to
 * vote on) and the Explore tab (just browse the library) — same filters,
 * same card, so a change to either only needs making once.
 */
import { h, posterUrl, toast, formatRating, openMovieModal, originalTitleLine } from './dom.js';
import { api } from './api.js';

export const emptyFilters = () => ({
  genres: { include: [], exclude: [] },
  languages: { include: [], exclude: [] },
  year: { min: null, max: null },
  runtime: { min: null, max: null },
  includeWatched: true,
  // Only surfaced in the UI on the Explore tab; Draw carries it inertly since
  // both share this same filters shape.
  search: '',
});

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
