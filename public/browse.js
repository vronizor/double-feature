/**
 * Filter panel and movie card shared between the Draw tab (draw something to
 * vote on) and the Explore tab (just browse the library) — same filters,
 * same card, so a change to either only needs making once.
 */
import {
  h,
  clear,
  posterUrl,
  toast,
  ratingLine,
  metaLine,
  countryLabel,
  keepNameTogether,
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
/**
 * Names the lists currently in play, for a view that shows films without
 * showing the picker.
 *
 * It exists because of a real confusion: choosing a director put his ten films
 * in the pool, Explore showed ten films, and nothing anywhere said whose they
 * were. It read as the library having changed underneath you. A slot list
 * already carries the answer in its name — "Director night — Robert Eggers" —
 * and no view was surfacing it.
 */
export function selectionLabel(lists) {
  const selected = lists.filter((list) => poolState.isSelected(list.id));
  if (selected.length === 0 || selected.length === lists.length) return null;
  // A slot list is the whole point of this label, so it wins when present:
  // "Director night — Robert Eggers" says more than "3 lists".
  const slot = selected.find((list) => list.hidden);
  if (slot) return slot.name;
  if (selected.length <= 2) return selected.map((list) => list.name).join(' + ');
  return `${selected.length} lists`;
}

export function renderListPicker(lists, openGroups, onChange, { vocabulary = [], tagFilter = null } = {}) {
  // A slot list is hidden while it is not in play — it belongs to a
  // parametric vibe and is not something anyone curates. But hiding one that
  // IS selected makes the picker lie: every checkbox unticked while films are
  // on screen, which reads as the app ignoring you. So it appears exactly when
  // it is doing something.
  lists = lists.filter((list) => !list.hidden || poolState.isSelected(list.id));
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

/**
 * The parameter picker for a parametric vibe — "director night, but who?".
 *
 * A panel rather than a prompt() because the answer is a CHOICE, not a string:
 * three people share a surname and only one of them directs. Search returns
 * people who direct first, and each row says what they are known for, so the
 * pick is made on evidence rather than on a name that might be anyone.
 *
 * Deliberately not a chip that applies on click like the others: applying this
 * one means a TMDB round trip and a rewritten list, so it asks first.
 */
function renderParamPicker(vibe, { onChosen, onCancel, onClear = null }) {
  const results = h('div', { class: 'param-results' });
  const input = h('input', {
    type: 'search',
    placeholder: `${vibe.param.label ?? 'Name'}…`,
    autocomplete: 'off',
  });

  // A country parameter searches the LIBRARY, not TMDB: the vocabulary is
  // whatever the cached films actually come from, so it is fetched once and
  // filtered in memory. Offering a country nothing was made in, and then
  // drawing nothing, would be worse than not offering it.
  let vocabulary = null;
  const isCountry = vibe.param.kind === 'country';

  let seq = 0;
  const search = async () => {
    const query = input.value.trim();
    const mine = (seq += 1);

    if (isCountry) {
      if (vocabulary === null) {
        try {
          ({ countries: vocabulary } = await api.poolCountries());
        } catch (error) {
          clear(results).append(h('div', { class: 'faint error' }, error.message));
          return;
        }
      }
      if (mine !== seq) return;
      const needle = query.toLowerCase();
      const matches = vocabulary
        .filter((entry) => entry.country.toLowerCase().includes(needle))
        .slice(0, 12);
      clear(results).append(
        ...(matches.length === 0
          ? [h('div', { class: 'faint' }, 'No films from anywhere by that name.')]
          : matches.map((entry) =>
              h(
                'button',
                { class: 'param-result', onClick: () => onChosen({ name: entry.country }) },
                h('span', { class: 'param-result-name' }, entry.country),
                h('span', { class: 'faint' }, `${entry.count} films in your library`),
              ),
            )),
      );
      return;
    }

    if (query.length < 2) return clear(results);
    let found = [];
    try {
      ({ results: found } = await api.searchPerson(query));
    } catch (error) {
      clear(results).append(h('div', { class: 'faint error' }, error.message));
      return;
    }
    // Keystrokes race: a slow early request must not overwrite a later one.
    if (mine !== seq) return;

    clear(results).append(
      ...(found.length === 0
        ? [h('div', { class: 'faint' }, 'Nobody by that name.')]
        : found.map((person) =>
            h(
              'button',
              { class: 'param-result', onClick: () => onChosen(person) },
              h('span', { class: 'param-result-name' }, person.name),
              h(
                'span',
                { class: 'faint' },
                person.directs ? 'Director' : 'Known for acting',
                person.known_for.length ? ` · ${person.known_for.join(', ')}` : '',
              ),
            ),
          )),
    );
  };

  input.addEventListener('input', search);
  // A country list is short and closed, so show all of it immediately rather
  // than making the host guess what is in there. A person search cannot.
  if (isCountry) search();
  return h(
    'div',
    { class: 'param-picker card' },
    h('div', { class: 'row' },
      h('div', { class: 'field-label' }, isCountry ? 'Films from where?' : 'Whose films?'),
      h('span', { class: 'spacer' }),
      // Clear only exists while this vibe is the one in play. An active
      // parametric chip keeps opening the picker rather than deselecting —
      // the ▾ promises a chooser — so without this it would be the one kind of
      // vibe with no way back out.
      onClear ? h('button', { class: 'btn-sm', onClick: onClear }, 'Clear') : null,
      h('button', { class: 'btn-sm', onClick: onCancel }, 'Cancel')),
    input,
    results,
  );
}

/**
 * The "Tonight is…" row.
 *
 * Two meanings used to collide on one control. A ✕ sat against the ACTIVE
 * chip and deleted the vibe outright — but the only thing a ✕ beside an active
 * selection plausibly says is "clear this selection", so its obvious reading
 * was "deselect" and its real effect was "destroy". Reported from real use as
 * a button too risky to sit there, and that is exactly right: the cost of
 * misreading it was losing a saved vibe.
 *
 * So the two are separated. Clicking an active chip deselects it — the reading
 * the ✕ was wrongly offering, now attached to something that means it. Delete
 * moves behind an explicit Edit mode, where destroying a vibe is the only
 * thing on offer and cannot be hit while reaching for something else.
 */
export function renderVibeChips(
  vibes,
  { onApply, onDeselect, onSave, onDelete, onParam, editing = false, onToggleEdit },
) {
  return h(
    'div',
    {},
    // The status lives on the LABEL, not in the row of chips.
    //
    // "Custom" used to sit at the end of that row, and it was reported as
    // looking like a chip you could press — which is exactly what it looked
    // like, sitting in a line of pressable things at the same size. It is a
    // readout, not a control: it says no vibe is applied and this pool was
    // built by hand. On the label it cannot be mistaken for either.
    h(
      'div',
      { class: 'field-label' },
      'Tonight is…',
      editing
        ? h('span', { class: 'field-label-note' }, 'pick one to delete')
        : poolState.vibe === null
          ? h('span', { class: 'field-label-note' }, 'custom')
          : null,
    ),
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
              class: `chip chip--vibe${editing ? ' chip--deleting' : ''}`,
              dataset: { state: active && !editing ? 'include' : 'off' },
              title: editing
                ? `Delete the "${vibe.name}" vibe`
                : active && !vibe.param
                  ? 'Click again to deselect'
                  : vibe.param
                    ? `Pick a ${vibe.param.label ?? 'value'} for this one`
                    : vibe.tags.length
                      ? `Tagged: ${vibe.tags.join(', ')}`
                      : `${vibe.resolved_lists.length} list(s)`,
              onClick: () => {
                // In Edit mode a chip does one thing only. Applying a vibe you
                // meant to delete is recoverable; the reverse is not.
                if (editing) return onDelete(vibe);
                // A parametric vibe cannot be applied by clicking it — it has
                // no answer yet. The ▾ says so before the click rather than
                // after, which is why it is part of the label. It keeps opening
                // the picker even when active, because that is what the ▾
                // promises; the picker carries its own Clear.
                if (vibe.param) return onParam(vibe);
                if (active) return onDeselect();
                applyVibe(vibe);
                onApply();
              },
            },
            // Reads back the value only while this vibe is actually applied.
            // A chip showing "Robert Eggers" when nothing is selected is
            // claiming a pool that is not in play — the state says Custom and
            // the chip says otherwise. The label stays in front of the value
            // so it is clear WHAT was chosen, not just who.
            vibe.param
              ? active && vibe.slot?.value
                ? `${vibe.param.label ?? 'Value'}: ${vibe.slot.value} ▾`
                : `${vibe.name} ▾`
              : vibe.name,
          ),
        );
      }),
      // Saving the CURRENT setup is the only creation path: you tune lists and
      // filters until the pool looks right, then keep it. A blank form would
      // ask you to imagine the result instead of seeing it. Hidden in Edit
      // mode, which is about removing vibes, not adding one.
      editing
        ? null
        : h(
            'button',
            { class: 'chip chip--vibe chip--save', title: 'Save the current lists and filters as a new vibe', onClick: onSave },
            '+ Save current…',
          ),
      // No vibes, nothing to edit — the toggle would open a mode with no
      // subject.
      vibes.length
        ? h(
            'button',
            {
              class: 'vibe-edit',
              title: editing ? 'Stop editing' : 'Delete a vibe',
              onClick: onToggleEdit,
            },
            editing ? 'Done' : 'Edit',
          )
        : null,
    ),
  );
}

export { renderParamPicker };


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
 * Which score leads on a card. The other one moves to hover.
 *
 * A toggle rather than a settings screen: there are exactly two values, this
 * app has no settings screen, and adding one for a single binary choice would
 * be more machinery than the choice deserves. It sits beside the Awards
 * toggle because they are the same kind of thing — how films are displayed,
 * persisted in localStorage, applying everywhere at once.
 */
export function renderRatingToggle(onChange) {
  const imdbFirst = prefs.primaryRating === 'imdb';
  return h(
    'button',
    {
      class: 'chip',
      dataset: { state: 'off' },
      title: imdbFirst
        ? 'Showing IMDb first — click to lead with TMDB'
        : 'Showing TMDB first — click to lead with IMDb',
      onClick: () => {
        prefs.set('primaryRating', imdbFirst ? 'tmdb' : 'imdb');
        onChange();
      },
    },
    imdbFirst ? 'IMDb first' : '★ TMDB first',
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
function chipToggleGroup(items, group, getKey, getLabel, onChange, getTitle = null) {
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
          // The full name leads when the label is an abbreviation — a chip
          // reading "USA" should say what it stands for before it explains
          // how clicking works.
          title: getTitle
            ? `${getTitle(item)} — click to include, again to exclude, again to clear`
            : 'Click to include, again to exclude, again to clear',
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
/**
 * Which chip groups the host opened by hand, this session.
 *
 * A group with a selection is open regardless — you should always be able to
 * see what is narrowing your pool. This remembers the ones opened merely to
 * browse, so a repaint (every chip click causes one) does not fold them shut
 * again mid-decision. Module-level because the panel is rebuilt from scratch
 * on every paint and shared between Draw and Explore, and because it is
 * presentation state that deliberately does not outlive a reload.
 */
const openFilterGroups = new Set();

/**
 * One collapsible group of filter chips.
 *
 * `<details>` rather than a button and a class: it is a disclosure widget, the
 * element exists, and it comes with the keyboard behaviour and the screen
 * reader announcement already correct.
 */
function collapsibleChips(label, selectedCount, chips) {
  const el = h(
    'details',
    { class: 'filter-group', open: selectedCount > 0 || openFilterGroups.has(label) },
    h(
      'summary',
      {},
      h('span', { class: 'field-label' }, label),
      selectedCount ? h('span', { class: 'badge' }, String(selectedCount)) : null,
    ),
    chips,
  );
  el.addEventListener('toggle', () => {
    if (el.open) openFilterGroups.add(label);
    else openFilterGroups.delete(label);
  });
  return el;
}

const chosen = (group) => (group?.include?.length ?? 0) + (group?.exclude?.length ?? 0);

export function renderFilterPanel(
  filters,
  facets,
  { onChipChange, onValueChange, onClear, lists = null, onTopNChange = null },
) {
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
      collapsibleChips(
        'Genres',
        chosen(filters.genres),
        chipToggleGroup(facets.genres, filters.genres, (g) => g.id, (g) => g.name, onChipChange),
      ),
      // Countries behave exactly like languages here: a fixed vocabulary of
      // the commonest, as toggle chips. The long tail is deliberately not
      // offered -- 96 countries as chips is not a control, it is a wall.
      //
      // The real object, never a copy: chipToggleGroup mutates include and
      // exclude in place, so a synthesised group would swallow every click.
      // Label is shortened, key is not: the filter still sends the full
      // name, which is what movies.countries stores and what the pool query
      // matches on. Full name on hover, so nothing is actually hidden.
      collapsibleChips(
        'Country',
        chosen(filters.countries),
        chipToggleGroup(
          facets.countries ?? [],
          filters.countries,
          (c) => c.country,
          (c) => countryLabel(c.country),
          onChipChange,
          (c) => c.country,
        ),
      ),
      collapsibleChips(
        'Language',
        chosen(filters.languages),
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
        // Top-N lives here rather than up beside the list picker. It is not a
        // property of a film the way genre is -- it is a cut through the
        // selection -- but that distinction is the app's, not the host's, and
        // up there nobody found it. Findability wins; it still only renders
        // when a selected list actually carries ranks.
        lists && onTopNChange ? renderTopN(lists, onTopNChange) : null,
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
    h(
      'label',
      { class: 'check' },
      h('input', {
        id: 'filter-awards-only',
        type: 'checkbox',
        checked: filters.awardWinners,
        onChange: (event) => {
          filters.awardWinners = event.target.checked;
          onValueChange();
        },
      }),
      h('span', {}, '🏆 Only films that won an award'),
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
  const awards = prefs.showAwards ? (movie.awards ?? []) : [];

  return h(
    'article',
    // The id is on the card so a caller can find one again after a repaint —
    // the lineup scrolls to the film it just drew. By id rather than by
    // position, because the grid is rebuilt from scratch on every paint and
    // "the nth child" would keep working right up until an entry moved.
    { class: 'movie', dataset: { tmdbId: movie.tmdb_id } },
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
        ...metaLine(movie.year, keepNameTogether(movie.director), ratingLine(movie)),
      ),
      h(
        'div',
        { class: 'movie-meta faint' },
        ...metaLine(movie.runtime ? `${movie.runtime} min` : null, movie.genres),
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
