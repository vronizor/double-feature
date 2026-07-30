/**
 * Filter panel and movie card shared between the Draw tab (draw something to
 * vote on) and the Explore tab (just browse the library) — same filters,
 * same card, so a change to either only needs making once.
 */
import {
  h,
  posterUrl,
  toast,
  formatRating,
  openMovieModal,
  originalTitleLine,
  awardLabel,
} from './dom.js';
import { prefs } from './prefs.js';
import { api } from './api.js';
import { poolState } from './pool-state.js';
import { applyVibe } from './vibes.js';

// Re-exported so views can keep importing the filter shape from here alongside
// everything else they use; it lives in pool-state.js because the singleton
// owns it.
export { emptyFilters } from './pool-state.js';

const UNTAGGED = '__untagged';

/**
 * Groups lists for the picker by TAG rather than by a single category.
 *
 * A list appears under every tag it carries — Ghibli under both "family" and
 * "animation" — which is the point of moving off one-category-per-list. The
 * duplication is the familiar labels pattern, and it's safe here because
 * selection is keyed on list id, so ticking a list in one group ticks it
 * everywhere it appears.
 *
 * `vocabulary` comes from the server so display order is defined in one place.
 */
export function groupListsByTag(lists, vocabulary) {
  const groups = [];
  for (const { tag, label } of vocabulary) {
    const inTag = lists.filter((list) => (list.tags ?? []).includes(tag));
    if (inTag.length) {
      groups.push({ key: tag, label, lists: inTag.sort((a, b) => a.name.localeCompare(b.name)) });
    }
  }
  // Anything carrying no tag at all still has to be reachable — a custom list
  // the host just created has none until they file it.
  const untagged = lists.filter((list) => (list.tags ?? []).length === 0);
  if (untagged.length) {
    groups.push({
      key: UNTAGGED,
      label: 'Untagged',
      lists: untagged.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }
  return groups;
}

/**
 * Whether a picker group renders expanded.
 *
 * `openGroups` holds TWO kinds of marker, not one: `key` forces a group open,
 * `!key` forces it closed. Both are needed because a group containing a
 * selection defaults to open — without an explicit closed marker, collapsing
 * such a group would spring straight back open on the next repaint.
 *
 * Extracted because that rule is used in three places now (the per-group
 * toggle, expand/collapse-all, and this test) and is easy to get subtly wrong.
 */
export function isGroupOpen(openGroups, key, hasSelection) {
  if (openGroups.has(key)) return true;
  if (openGroups.has(`!${key}`)) return false;
  return hasSelection;
}

/** Sets a group's state, clearing the opposite marker so the two can't disagree. */
export function setGroupOpen(openGroups, key, open) {
  openGroups.delete(open ? `!${key}` : key);
  openGroups.add(open ? key : `!${key}`);
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
export function renderListPicker(lists, openGroups, onChange, { vocabulary = [], tagFilter = null } = {}) {
  if (lists.length === 0) {
    return h(
      'div',
      { class: 'empty' },
      'No lists yet. Add one on the ',
      h('a', { href: '#lists' }, 'Lists'),
      ' tab, or run the seed script.',
    );
  }

  // Narrowing by tag is what keeps this usable as the library grows: at thirty
  // lists you tap "family" and see four, instead of scrolling past everything.
  const visible = tagFilter
    ? lists.filter((list) => (list.tags ?? []).includes(tagFilter))
    : lists;

  const groups = groupListsByTag(visible, vocabulary);
  const allIds = visible.map((list) => list.id);
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

  // Expand/collapse is deliberately separate from select/deselect: one changes
  // what you can SEE, the other changes what you're drawing FROM. Conflating
  // them would mean opening a group to look at it silently altered the pool.
  //
  // Both markers have to be written, not just the one being set — `key` forces
  // open and `!key` forces closed, and a group with a selection defaults to
  // open, so "collapse all" has to say so explicitly or those spring back.
  const expandAll = (open) =>
    h(
      'button',
      {
        class: 'btn-sm',
        onClick: () => {
          for (const group of groups) setGroupOpen(openGroups, group.key, open);
          onChange();
        },
      },
      open ? '▾ Expand all' : '▸ Collapse all',
    );

  const allOpen = groups.every((group) =>
    isGroupOpen(
      openGroups,
      group.key,
      group.lists.some((list) => poolState.isSelected(list.id)),
    ),
  );

  return h(
    'div',
    { class: 'stack', style: 'gap:10px' },
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'faint' }, `${selectedCount} of ${lists.length} lists selected`),
      h('span', { class: 'spacer' }),
      // One toggle rather than two buttons: with every group already open,
      // "Expand all" is a no-op that looks like it should do something.
      groups.length > 1 ? expandAll(!allOpen) : null,
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
      const isOpen = isGroupOpen(openGroups, group.key, selected > 0);

      // Interacting with a group pins it open. Without this, unchecking the
      // last selected list in a group would drop `selected` to 0 and collapse
      // the group instantly — yanking the very checkbox being clicked out from
      // under the cursor.
      const pinOpen = () => setGroupOpen(openGroups, group.key, true);

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
                setGroupOpen(openGroups, group.key, !isOpen);
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
 * handles that) so the UI never claims a vibe it is no longer showing.
 *
 * Renders nothing when no vibe can produce a pool — on a fresh install
 * with no lists, an empty row of dead chips would be worse than no row.
 */
/**
 * Tag filter chips above the picker. Narrowing to one tag is what stops the
 * picker becoming a scroll as the library grows — the whole reason lists carry
 * tags rather than a single category.
 */
export function renderTagFilter(vocabulary, active, onChange) {
  const withLists = vocabulary.filter((entry) => entry.count > 0);
  if (withLists.length <= 1) return null;

  const chip = (label, tag) =>
    h(
      'button',
      {
        class: 'chip',
        dataset: { state: active === tag ? 'include' : 'off' },
        onClick: () => onChange(active === tag ? null : tag),
      },
      label,
    );

  return h(
    'div',
    { class: 'chips' },
    chip('All', null),
    ...withLists.map((entry) => chip(`${entry.label} ${entry.count}`, entry.tag)),
  );
}

export function renderVibeChips(vibes, { onApply, onSave, onDelete }) {
  return h(
    'div',
    {},
    h('div', { class: 'field-label' }, 'Tonight is…'),
    h(
      'div',
      { class: 'chips' },
      ...vibes.map((vibe) => {
        const active = poolState.vibe === vibe.id;
        return h(
          'span',
          { class: 'vibe-chip-wrap' },
          h(
            'button',
            {
              class: 'chip chip--vibe',
              dataset: { state: active ? 'include' : 'off' },
              title: vibe.tags.length
                ? `Tagged: ${vibe.tags.join(', ')}`
                : `${vibe.resolved_lists.length} list(s)`,
              onClick: () => {
                applyVibe(vibe);
                onApply();
              },
            },
            vibe.name,
          ),
          // The remove affordance only appears on the active chip, so the row
          // stays a row of choices rather than a row of choices-and-buttons.
          active
            ? h(
                'button',
                {
                  class: 'vibe-remove',
                  title: `Delete the "${vibe.name}" vibe`,
                  onClick: () => onDelete(vibe),
                },
                '✕',
              )
            : null,
        );
      }),
      // Saving the CURRENT setup is the only creation path: you tune lists and
      // filters until the pool looks right, then keep it. A blank form would
      // ask you to imagine the result instead of seeing it.
      h(
        'button',
        { class: 'chip chip--vibe chip--save', title: 'Save the current lists and filters as a new vibe', onClick: onSave },
        '+ Save current…',
      ),
      poolState.vibe === null
        ? h('span', { class: 'faint', style: 'align-self:center' }, 'Custom')
        : null,
    ),
  );
}

/**
 * The "show awards" switch. A display preference, so it persists in
 * localStorage and applies to both tabs — unlike anything in poolState, which
 * is deliberately ephemeral.
 */
export function renderAwardsToggle(onChange) {
  return h(
    'button',
    {
      class: 'chip',
      dataset: { state: prefs.showAwards ? 'include' : 'off' },
      title: prefs.showAwards ? 'Hide award badges' : 'Show award badges',
      onClick: () => {
        prefs.toggle('showAwards');
        onChange();
      },
    },
    '🏆 Awards',
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
        id: 'filter-topn',
        type: 'number',
        min: '1',
        placeholder: 'all',
        value: poolState.setup.topN ?? '',
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
      // Stable id so `preserveFocus` can put the caret back after a repaint —
      // Explore rebuilds its whole subtree on every keystroke. Safe as a plain
      // id because only one view is mounted at a time.
      id: `filter-${key}-${edge}`,
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
        id: 'filter-watched',
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
  const awards = prefs.showAwards ? (movie.awards ?? []) : [];

  return h(
    'article',
    { class: 'movie' },
    movie.watched ? h('span', { class: 'watched-flag' }, 'watched') : null,
    // Top-LEFT: the watched flag already owns top-right. The count only
    // appears when there's more than one, which is 88% of the time it isn't
    // needed. `title` gives the full detail on desktop hover; the meta line
    // below is what carries it on a phone, where hover doesn't exist.
    awards.length
      ? h(
          'span',
          {
            class: 'award-flag',
            title: awards.map((award) => awardLabel(award, { short: false })).join('\n'),
          },
          awards.length > 1 ? `🏆 ×${awards.length}` : '🏆',
        )
      : null,
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
      // Two at most, then "+N" — three award names would take four lines on a
      // 190px card and crowd out the synopsis. The full set is one tap away in
      // the overlay.
      awards.length
        ? h(
            'div',
            { class: 'movie-awards' },
            '🏆 ',
            awards.slice(0, 2).map((award) => awardLabel(award)).join(' · '),
            awards.length > 2 ? ` +${awards.length - 2}` : '',
          )
        : null,
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
