/**
 * Filter panel and movie card shared between the Draw tab (draw something to
 * vote on) and the Explore tab (just browse the library) — same filters,
 * same card, so a change to either only needs making once.
 */
import {
  h,
  clear,
  fill,
  openOverlay,
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
// lineup.js imports nothing at all, so there is no cycle to create here.
import { lineup } from './lineup.js';
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
 * `!key` forces it closed. Both are needed because a group can default to open
 * — without an explicit closed marker, collapsing such a group would spring
 * straight back open on the next repaint.
 *
 * The default is a PARTIAL selection, not any selection. It used to be any,
 * and the intent was right — do not hide lists you are drawing from — but the
 * default state of this app is all twenty lists selected, so every one of the
 * eight groups qualified and all eight opened at once. A rule meant to say
 * "look here" fired everywhere and therefore pointed at nothing, leaving a
 * ~4,300px rail of uniformly ticked checkboxes.
 *
 * All-on and all-off are both uniform, and the group header already says which
 * ("Awards 9 lists · 634 films · 9 on"), so neither needs opening to be
 * understood. A group part-selected is the only one whose contents you cannot
 * infer from its header, and it is the one that opens.
 *
 * Extracted because that rule is used in three places now (the per-group
 * toggle, expand/collapse-all, and this test) and is easy to get subtly wrong.
 */
export function isGroupOpen(openGroups, key, isPartial) {
  if (openGroups.has(key)) return true;
  if (openGroups.has(`!${key}`)) return false;
  return isPartial;
}

/** Some, but not all — the only state a group header cannot already tell you. */
export function isPartiallySelected(lists) {
  const on = lists.filter((list) => poolState.isSelected(list.id)).length;
  return on > 0 && on < lists.length;
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

export function renderListPicker(lists, openGroups, onChange, { vocabulary = [] } = {}) {
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

  // The tag-filter chip row above this used to narrow which lists were shown.
  // It was deleted in v7.13: it is a second narrowing mechanism stacked on
  // group headers that already narrow, and its "All" chip painted itself in
  // the same active yellow as the vibe row above, so two unrelated "selected"
  // states sat in one column saying different things.
  const groups = groupListsByTag(lists, vocabulary);
  const allIds = lists.map((list) => list.id);
  const selectedCount = lists.filter((list) => poolState.isSelected(list.id)).length;
  const multiTaggedNames = lists.filter((list) => (list.tags ?? []).length > 1).map((l) => l.name);
  const multiTagged = multiTaggedNames.length;

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
    isGroupOpen(openGroups, group.key, isPartiallySelected(group.lists)),
  );

  return h(
    'div',
    { class: 'stack', style: 'gap:10px' },
    // The summary is a SENTENCE and the buttons are controls, so they get a
    // line each. Sharing one `.row` worked while the summary was three words;
    // once it grew it wrapped to two lines and shunted "Deselect all" onto a
    // third, ragged, line of its own.
    h(
      'div',
      { class: 'picker-head' },
      // "20 of 20 lists selected" is true, and you can count 29 checkboxes
      // underneath it, because a list appears under every tag it carries —
      // Studio Ghibli under Animation, Collections AND Family. Both numbers
      // are honest and nothing reconciled them, so the header read as a bug.
      //
      // Said out loud rather than fixed by hiding the repetition: a list
      // genuinely belongs to several tags, which is the whole point of tags.
      h(
        'span',
        { class: 'faint' },
        `${selectedCount} of ${lists.length} lists selected`,
        multiTagged
          ? h(
              'span',
              { title: multiTaggedNames.join(', ') },
              ` · ${multiTagged} appear under more than one tag`,
            )
          : null,
      ),
      h(
        'div',
        { class: 'row' },
        // One toggle rather than two buttons: with every group already open,
        // "Expand all" is a no-op that looks like it should do something.
        //
        // It sits apart from the pair beside it because it is a different kind
        // of action — expanding changes what you can SEE, selecting changes
        // what you DRAW FROM — which this file already keeps deliberately
        // separate. In a narrow rail that distinction is also what stops three
        // buttons breaking 2+1.
        groups.length > 1 ? expandAll(!allOpen) : null,
        h('span', { class: 'spacer' }),
        h(
          'div',
          { class: 'bulk-pair' },
          bulk('Select all', allIds, true),
          bulk('Deselect all', allIds, false),
        ),
      ),
    ),
    ...groups.map((group) => {
      const ids = group.lists.map((list) => list.id);
      const selected = ids.filter((id) => poolState.isSelected(id)).length;
      const films = group.lists.reduce((sum, list) => sum + (list.resolved_count ?? 0), 0);
      // A group the host is actually part-way through stays open across
      // repaints; the rest stay out of the way. With ~20 lists this is what
      // keeps the panel readable at all.
      const isOpen = isGroupOpen(openGroups, group.key, isPartiallySelected(group.lists));

      // Interacting with a group you are LOOKING AT pins it open. Without this,
      // unchecking the last selected list would drop the group out of the
      // part-selected state and collapse it instantly — yanking the very
      // checkbox being clicked out from under the cursor.
      //
      // Gated on it already being open, which the first version was not: from
      // a collapsed group, "none" pinned it open and then expanded it, so
      // turning a group off flung its contents into your face. Nothing about
      // "I do not want these" asks to see them.
      const pinOpen = () => {
        if (isOpen) setGroupOpen(openGroups, group.key, true);
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
        // Two lines by construction, not by wrapping. In a 300px rail the
        // label, the stats and two buttons cannot share one line, and a plain
        // flex row broke them 3+1 — leaving "none" stranded on a line of its
        // own under "all". The pair is kept together as its own unit instead.
        h(
          'div',
          { class: 'list-group-head' },
          h(
            'div',
            { class: 'row' },
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
            h('div', { class: 'bulk-pair' }, groupBulk('all', true), groupBulk('none', false)),
          ),
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

  // Focus the box as soon as it is on the page. Opening this picker has one
  // possible next move — type a name — and asking for a second tap to reach
  // the only input on offer is a tap for nothing. On a phone it also brings
  // the keyboard up with the picker instead of after it.
  //
  // A microtask, because this node is not in the document yet: it is returned
  // into a paint that appends it, and focus() on a detached element does
  // nothing. Queuing runs this once that whole paint has finished.
  //
  // Deliberately NOT requestAnimationFrame, which was the first attempt:
  // Chrome does not run rAF at all in a background tab, so the focus silently
  // never happened. Nobody is typing into a background tab, so it would not
  // have mattered to a host — but it would have deferred the focus until the
  // tab came forward, stealing it at some later moment nobody asked for.
  queueMicrotask(() => {
    if (input.isConnected) input.focus();
  });
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
              // Highlighted on the same condition that shows the value, or the
              // chip contradicts itself: reading "Director: Steven Spielberg"
              // in the unselected grey while that is exactly what the pool is
              // drawing from. The "custom" note on the label above is what says
              // the pool has been hand-edited since; the chip only claims that
              // its own list is in play.
              dataset: {
                state:
                  !editing && (active || (vibe.slot?.value && poolState.isSelected(vibe.slot.list_id)))
                    ? 'include'
                    : 'off',
              },
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
            // Reads back the value while this vibe's SLOT LIST is in the pool
            // — not while the vibe label happens to be applied.
            //
            // The original rule was `active`, to stop a chip claiming "Robert
            // Eggers" when nothing of his was in play, and that concern is
            // right and still met: switching to another vibe deselects the
            // slot list, so the chip reverts on its own.
            //
            // But `active` was the wrong test for it. Any hand-edit clears the
            // vibe label to Custom — including the Top-N cut, deliberately —
            // so picking Spielberg and then asking for his top 10 blanked the
            // chip back to "Director's night ▾" while the pool was still
            // exactly Spielberg, and the Top-N caption two panels away still
            // read "of Director's night — Steven Spielberg". One screen saying
            // both things. The pool is the honest test, and the label already
            // says Custom for the pool as a whole.
            vibe.param
              ? vibe.slot?.value && poolState.isSelected(vibe.slot.list_id)
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
          // `chip--filter`, not a bare `.chip`. A vibe pill and a filter token
          // are different kinds of thing and stopped looking alike in v7.13 —
          // see the shape note in styles.css.
          class: 'chip chip--filter',
          dataset: { state: chipState },
          // The full name leads when the label is an abbreviation — a chip
          // reading "USA" should say what it stands for before it explains
          // how clicking works.
          title: getTitle
            ? `${getTitle(item)} — click to include, again to exclude, again to clear`
            : 'Click to include, again to exclude, again to clear',
          // Reads the group rather than the captured `chipState`, and never
          // pushes a key it already holds. The captured value is correct for
          // the node it was rendered on, but a click that lands on a node the
          // repaint has already replaced would advance the state machine from
          // where it USED to be — and `push` with no guard turns that into a
          // duplicate. Demonstrated: two entries for Comedy made the pool
          // summary read "Action/Comedy/Comedy", so the state was corrupt and
          // the sentence describing it was wrong in the same breath.
          onClick: () => {
            const drop = (list) => {
              const at = list.indexOf(key);
              if (at !== -1) list.splice(at, 1);
            };
            if (group.include.includes(key)) {
              drop(group.include);
              if (!group.exclude.includes(key)) group.exclude.push(key);
            } else if (group.exclude.includes(key)) {
              drop(group.exclude);
            } else {
              group.include.push(key);
            }
            onChange();
          },
        },
        // The state is spelled as well as coloured. Include and exclude were
        // yellow and red-with-a-strikethrough and nothing else, which asks the
        // reader to hold a colour key in their head — and fails outright for
        // anyone who cannot separate the two.
        chipState === 'include' ? h('span', { class: 'chip-mark' }, '+') : null,
        chipState === 'exclude' ? h('span', { class: 'chip-mark' }, '−') : null,
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
 * Pool setup as a destination, for any view that has one.
 *
 * Built for the Draw tab and reused unchanged by Explore, which is the whole
 * argument for it existing: both tabs need the same controls out of the reading
 * column, and both need the same two presentations of them — a sticky rail
 * where there is room beside the content, a full-screen sheet where there is
 * not. Which one is live is decided in CSS by width; both are in the DOM.
 *
 * `content()` builds the controls, fresh, each time it is asked. `repaint()` is
 * the caller's own paint — the sheet does not own a render loop, because every
 * control inside it already triggers one.
 */
export function createPoolDestination({ content, repaint, label = 'Pool setup' }) {
  let sheet = null;

  function open() {
    const body = h('div');
    const overlay = openOverlay({
      label,
      cardClass: 'modal-card sheet-card',
      render: (close) => [
        h(
          'div',
          { class: 'row sheet-head' },
          h('h2', {}, label),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn-sm', onClick: close }, 'Done'),
        ),
        body,
      ],
      // Escape and a backdrop click do not go through any closer of ours, so
      // the overlay reports every exit here.
      onClose: () => {
        sheet = null;
        // Or the rail stays empty behind a sheet that is gone.
        repaint();
        // And only now can focus go home: the overlay restores it to the node
        // that opened the sheet, which the repaint above has just replaced.
        document.getElementById('pool-setup-open')?.focus();
      },
    });
    sheet = { body, close: overlay.close };
    // Immediately, not on the next repaint. repaint() is what moves the
    // controls out of the rail and into the sheet, and until it runs BOTH
    // exist — which is the duplicate-id state this arrangement prevents.
    repaint();
  }

  return {
    /** The rail. Empty while the sheet is up: only one copy may be live. */
    rail: () =>
      h(
        'aside',
        { class: 'draw-rail', 'aria-label': label },
        h(
          'div',
          { class: 'card stack draw-rail-inner' },
          h('div', { class: 'row' }, h('h3', {}, label)),
          // `rangeInputs` gives its fields fixed ids so focus survives a
          // repaint, so two panels in one document means getElementById
          // answers with whichever came first — which, below the rail's
          // breakpoint, is the `display:none` one nobody can see.
          sheet ? null : content(),
        ),
      ),

    /** The button that opens the sheet. Hidden by CSS wherever the rail shows. */
    opener: () =>
      h(
        'div',
        { class: 'row pool-sheet-row' },
        h(
          'button',
          // Stable id, this codebase's standing contract for anything that has
          // to survive a repaint — closing the sheet repaints, so the button
          // focus returns to is never the node that opened it.
          { id: 'pool-setup-open', class: 'btn-sm', onClick: open },
          label,
        ),
        h('span', { class: 'faint' }, 'lists, filters and the top-N cut'),
      ),

    /** Called from the caller's paint(), after it has rebuilt its own DOM. */
    sync: () => {
      // Escape or a backdrop click can have closed the sheet without telling us.
      if (sheet && !document.contains(sheet.body)) sheet = null;
      if (sheet) fill(sheet.body, content());
    },
  };
}

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
  { onChipChange, onValueChange, onClear, lists = null, onTopNChange = null, onToggleChange = null },
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
          (onToggleChange ?? onValueChange)();
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
          (onToggleChange ?? onValueChange)();
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
/**
 * The two things you can do to a film, wherever it is being shown.
 *
 * Shared by the card and the detail overlay so they cannot drift: the overlay
 * used to have NO actions at all, so the sequence was decide here, close it,
 * find the card again, act there. `onChange` is the showing view's own repaint,
 * because adding to the lineup changes a count and a grid that live outside
 * this component.
 */
function watchedButton(movie) {
  return h(
    'button',
    {
      class: 'btn-sm',
      onClick: async (event) => {
        try {
          await api.setWatched(movie.tmdb_id, !movie.watched);
          movie.watched = !movie.watched;
          // Written in place rather than repainted: the flag on the card is
          // cosmetic, and a repaint here would close nothing and cost a flash.
          event.target.textContent = movie.watched ? 'Watched ✓' : 'Mark watched';
        } catch (error) {
          toast(error.message, 'error');
        }
      },
    },
    movie.watched ? 'Watched ✓' : 'Mark watched',
  );
}

function addToLineupButton(movie, onChange) {
  const already = lineup.has(movie.tmdb_id);
  return h(
    'button',
    {
      class: 'btn-sm',
      disabled: already,
      onClick: () => {
        if (!lineup.add(movie)) return;
        toast(`Added ${movie.title}`, 'ok');
        onChange?.();
      },
    },
    already ? 'Already in lineup' : '+ Add to lineup',
  );
}

export function movieCard(movie, { extraAction, onChange = null } = {}) {
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
      h(
        'button',
        {
          class: 'movie-title movie-title--link',
          onClick: () =>
            openMovieModal(movie, {
              actions: (close) => [
                watchedButton(movie),
                // Adding from the overlay closes it: the decision is made, and
                // leaving it up would just be asking to be dismissed.
                addToLineupButton(movie, () => {
                  close();
                  onChange?.();
                }),
              ],
            }),
        },
        movie.title,
      ),
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
      watchedButton(movie),
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
