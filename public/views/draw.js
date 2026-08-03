import {
  h,
  clear,
  toast,
  plural,
  posterUrl,
  tmdbUrl,
  parseTmdbInput,
  openMovieModal,
  topNLabel,
  drawnMessage,
} from '../dom.js';
import { api } from '../api.js';
import { renderSessionPanel } from './session.js';
import {
  renderFilterPanel,
  renderListPicker,
  renderVibeChips,
  renderParamPicker,
  renderTagFilter,
  renderAwardsToggle,
  renderRatingToggle,
  movieCard,
} from '../browse.js';
import { lineup } from '../lineup.js';
import { poolState } from '../pool-state.js';
import { applyVibe, clearVibe, currentAsVibe } from '../vibes.js';

const MIN_DRAW_SIZE = 1;
const MAX_DRAW_SIZE = 10;

/**
 * The Draw tab builds a Lineup — the set of films the host fills through any
 * mix of random draws and specific adds, then edits (remove one, redraw more)
 * before publishing. Publishing was always just "take whatever's in the
 * lineup and open a vote on it" (POST /api/sessions already accepts any list
 * of tmdb_ids); the only real change from the old one-shot draw is that the
 * lineup persists across draws instead of being replaced by each one.
 *
 * The lineup itself (`lineup.js`) is a module-level singleton, not part of
 * this view's own state — that's what lets a film added from the Explore tab
 * still be here when the host switches back, since this whole view is
 * otherwise torn down and rebuilt fresh on every navigation.
 *
 * Layout: which lists/filters the pool draws from is only a dependency of
 * "Draw random films", not of "Add a specific film" (search/paste/manual all
 * bypass the pool entirely) — so it's nested inside that card as a collapsed-
 * by-default "Pool setup" section rather than sitting above the whole tab as
 * if it governed everything. The two ways of adding a film sit side by side
 * as a result, with the Lineup itself — the actual point of the tab — right
 * below both.
 */
export async function renderDraw(container) {
  const state = {
    lists: [],
    facets: null,
    poolSetupOpen: false,
    // Which picker categories are expanded. Lives here (not in poolState)
    // because it's presentation, not pool definition — but it must outlive a
    // repaint, which is why it isn't a local in the render function.
    openGroups: new Set(),
    // Which tag the picker is narrowed to, and the vocabulary/vibes fetched
    // from the server. Presentation + server data, so not in poolState.
    tagFilter: null,
    vocabulary: [],
    vibes: [],
    // Edit mode for the vibe row: chips delete instead of applying. Presentation
    // state, and deliberately not sticky — it resets on every mount, because a
    // destructive mode you left switched on last time is one you have forgotten
    // about by the time you come back.
    editingVibes: false,
    size: 2,
    // Adding a named film is discoverable-but-rare: wanted often enough to
    // deserve a permanent button, not often enough to deserve half the screen
    // standing empty. Open state lives here rather than in the render closure
    // so adding one film does not close the panel on the host mid-way through
    // adding a second.
    addFilmOpen: false,
    searchResults: [],
    // Set when the search box was given bare digits, which are ambiguous —
    // 1917, 300, 2012 and 1408 are all films AND all plausible TMDB ids. The
    // search runs, and this offers the id reading alongside it rather than
    // choosing one silently.
    idOffer: null,
    anonymous: false,
    poolCount: null,
    busy: false,
    // The vote that is open right now, if there is one. Nothing on this tab
    // used to know: publishing swapped the whole view for the session panel,
    // so a host who reloaded got a blank lineup and no trace that guests were
    // still voting — and the server would happily have opened a second vote
    // over the first.
    liveSession: null,
  };

  let sessionTeardown = null;
  const stopSession = () => {
    sessionTeardown?.();
    sessionTeardown = null;
  };

  /**
   * Is a vote live? Asked of the server rather than remembered, because the
   * case this exists for is the one where nothing was remembered — a reload,
   * or a different browser on the same house network.
   *
   * A failure leaves the banner off rather than guessing. The publish route
   * refuses a second open vote on its own, so the banner is the convenience
   * and the guard is the guarantee; getting it wrong here costs a missing
   * banner, never a lost vote.
   */
  async function refreshLiveSession() {
    try {
      const { sessions } = await api.history();
      state.liveSession = sessions.find((session) => session.status === 'open') ?? null;
    } catch {
      state.liveSession = null;
    }
  }

  async function refreshData() {
    const [{ lists }, facets, { tags }, { vibes }] = await Promise.all([
      api.lists(),
      api.facets(poolState.selectedLists()),
      api.tags(),
      api.vibes(),
      refreshLiveSession(),
    ]);
    state.lists = lists;
    state.facets = facets;
    state.vocabulary = tags;
    state.vibes = vibes;
    // First load only — adopts whatever the Lists tab marked active by
    // default. Subsequent mounts keep whatever the host chose for tonight.
    poolState.seedFrom(lists);

    // Deliberately NOT `state.poolCount = facets.total`. The facets route
    // derives `total` from the list selection alone, so every other filter is
    // dropped: with Ghibli selected and year <= 1990 it reported 23 against a
    // real pool of 5, and TSPDT with top-100 reported 954 against 97. Invisible
    // on a first-ever load, when nothing is filtered — but `poolState` survives
    // tab switches, so Draw -> Explore -> Draw restored the filters and not the
    // count, and `disabled: state.poolCount === 0` gates the Draw button on it.
    //
    // Leaving it null renders "Counting…" for the one round trip refreshCount()
    // takes, which is honest, and refreshCount() already sends the full filter
    // set plus the staged lineup as `exclude`.
    state.poolCount = null;
  }

  // Re-fetch the facets whenever the list SELECTION changes, so the genre and
  // language chip counts describe the pool being drawn from. Deliberately not
  // called for filter changes: those narrow the pool but don't change which
  // lists are in play, so the facets stay valid and a request per keystroke
  // would be wasteful.
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
      // Stale chip counts are survivable; an error banner is not worth it.
    }
  }

  let countToken = 0;
  async function refreshCount() {
    const token = ++countToken;
    try {
      const { count } = await api.poolCount(poolState.setup, lineup.ids());
      if (token === countToken) {
        state.poolCount = count;
        paintCount();
      }
    } catch {
      // A failed count is not worth interrupting the host over.
    }
  }

  let countNode = null;
  function paintCount() {
    if (!countNode) return;
    clear(countNode).append(
      state.poolCount === null
        ? 'Counting…'
        : h(
            'span',
            {},
            h('strong', {}, String(state.poolCount)),
            ` new ${state.poolCount === 1 ? 'film matches' : 'films match'}`,
          ),
    );
    if (state.poolCount !== null && state.poolCount < state.size) {
      countNode.append(
        h('span', { class: 'faint' }, ` — fewer than the ${state.size} you're drawing`),
      );
    }
  }

  // --- Lists / filters ----------------------------------------------------

  // A compact one-line readout of the pool config, shown next to the
  // collapsed toggle so it's still visible at a glance without expanding it.
  function poolSetupSummary() {
    const selected = poolState.selectedLists();
    const count = selected === null ? state.lists.filter((l) => l.is_active).length : selected.length;
    if (count === 0) return 'No lists selected — tap to choose';

    const parts = [`${plural(count, 'list')}`];
    const { topN, filters: f } = poolState.setup;
    const inPlay =
      selected === null
        ? state.lists.filter((l) => l.is_active)
        : state.lists.filter((l) => selected.includes(l.id));
    const ranked = inPlay.filter((l) => l.ranked_count > 0);
    const label = topNLabel(topN, {
      ranked: ranked.length,
      perYear: ranked.filter((l) => l.ranks_by_year).length,
    });
    if (label) parts.push(label);
    const genreName = (id) => state.facets?.genres.find((g) => g.id === id)?.name ?? `#${id}`;
    const langName = (code) => state.facets?.languages.find((l) => l.code === code)?.name ?? code;

    if (f.genres.include.length) parts.push(f.genres.include.map(genreName).join('/'));
    if (f.genres.exclude.length) parts.push(`no ${f.genres.exclude.map(genreName).join('/')}`);
    if (f.languages.include.length) parts.push(f.languages.include.map(langName).join('/'));
    if (f.languages.exclude.length) parts.push(`no ${f.languages.exclude.map(langName).join('/')}`);
    if (f.year.min !== null || f.year.max !== null) parts.push(`${f.year.min ?? '…'}–${f.year.max ?? '…'}`);
    if (f.runtime.min !== null || f.runtime.max !== null) {
      parts.push(`${f.runtime.min ?? 0}–${f.runtime.max ?? '…'} min`);
    }
    if (f.awardWinners) parts.push('award winners');
    if (!f.includeWatched) parts.push('unwatched only');

    return parts.join(' · ');
  }

  // Collapsed by default: which lists/filters the pool draws from is only a
  // dependency of the random draw below, not of the whole tab, so it
  // shouldn't default to taking up the most visual space. `state.poolSetupOpen`
  // (not a local closure var) so it survives the repaints that filter chips
  // and list checkboxes already trigger while it's open.
  function poolSetup() {
    return h(
      'div',
      {},
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'expand-link',
            onClick: () => {
              state.poolSetupOpen = !state.poolSetupOpen;
              paint();
            },
          },
          state.poolSetupOpen ? '▾ Pool setup' : '▸ Pool setup',
        ),
        h('span', { class: 'faint' }, poolSetupSummary()),
      ),
      state.poolSetupOpen
        ? h(
            'div',
            { class: 'stack', style: 'margin-top:10px' },
            h('div', { class: 'field-label' }, 'Lists in play'),
            renderTagFilter(state.vocabulary, state.tagFilter, (tag) => {
              state.tagFilter = tag;
              paint();
            }),
            renderListPicker(
              state.lists,
              state.openGroups,
              () => {
                refreshCount();
                refreshFacets();
                paint();
              },
              { vocabulary: state.vocabulary, tagFilter: state.tagFilter },
            ),
            state.facets ? filterPanel() : null,
          )
        : null,
    );
  }

  // --- Vibes ----------------------------------------------------------------

  async function saveCurrentAsVibe() {
    const selected = poolState.selectedLists();
    if (!selected || selected.length === 0) {
      toast('Pick at least one list before saving a vibe', 'error');
      return;
    }
    const name = prompt('Name this vibe (e.g. "Sunday with the kids")')?.trim();
    if (!name) return;

    try {
      await api.createVibe(currentAsVibe(name));
      // Re-fetch rather than pushing the response onto the array: the server
      // computes resolved_lists, and the new vibe needs to slot into the
      // server's ordering.
      const { vibes } = await api.vibes();
      state.vibes = vibes;
      const created = vibes.find((vibe) => vibe.name === name);
      if (created) poolState.applyVibe(created.id, poolState.setup);
      toast(`Saved "${name}"`, 'ok');
      paint();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  async function removeVibe(vibe) {
    if (!confirm(`Delete the "${vibe.name}" vibe? The lists themselves are untouched.`)) return;
    try {
      await api.deleteVibe(vibe.id);
      const { vibes } = await api.vibes();
      state.vibes = vibes;
      // The pool it produced stays exactly as it is — deleting the shortcut
      // shouldn't silently change what you're about to draw from.
      //
      // Gated on it being the ACTIVE vibe, which it no longer always is: the
      // old ✕ was rendered only on the active chip, so an ungated markCustom()
      // was correct then. Edit mode can delete any chip, and dropping the label
      // off a vibe that is still applied would report a Custom pool that nobody
      // customised.
      if (poolState.vibe === vibe.id) poolState.markCustom();
      // Nothing left to edit — hold the host in a mode whose subject is gone
      // and the only way out is a Done button beside an empty row.
      if (vibes.length === 0) state.editingVibes = false;
      toast(`Deleted "${vibe.name}"`, 'ok');
      paint();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function filterPanel() {
    return renderFilterPanel(poolState.filters, state.facets, {
      lists: state.lists,
      onTopNChange: () => refreshCount(),
      onChipChange: () => {
        poolState.markCustom();
        refreshCount();
        paint();
      },
      onValueChange: () => {
        poolState.markCustom();
        refreshCount();
      },
      onClear: () => {
        poolState.clearFilters();
        refreshCount();
        paint();
      },
    });
  }

  // --- Random draw ----------------------------------------------------------

  function drawControls() {
    countNode = h('div', { class: 'pool-count muted' });
    paintCount();

    return h(
      'div',
      { class: 'card stack' },
      h('h2', {}, 'Draw random films'),
      // Vibe chips sit inside this card, immediately above Pool setup,
      // because that is exactly what they configure — "Add a specific film"
      // next door is deliberately untouched by them.
      renderVibeChips(state.vibes, {
        onApply: () => {
          // Deliberately does NOT open Pool setup.
          //
          // It used to, on the reasoning that applying a vibe changes the whole
          // pool so the host should see what it did rather than take a one-line
          // summary on faith. Reversed from use: the whole point of a vibe is
          // not having to look, and unfolding the panel every time buries the
          // Draw button under a control surface nobody asked for. The count
          // under the button already says what changed, and Pool setup is one
          // click away for anyone who does want the detail.
          refreshCount();
          refreshFacets();
          paint();
        },
        onDeselect: () => {
          clearVibe(state.lists);
          refreshCount();
          refreshFacets();
          paint();
        },
        onSave: saveCurrentAsVibe,
        onDelete: removeVibe,
        editing: state.editingVibes,
        onToggleEdit: () => {
          state.editingVibes = !state.editingVibes;
          // Close any open picker: it belongs to the applying half of the row,
          // and leaving it up under a row that now deletes is a mixed message.
          state.paramVibe = null;
          paint();
        },
        onParam: (vibe) => {
          // Toggle: clicking the chip again closes the picker rather than
          // leaving a panel the only way out of is choosing someone.
          state.paramVibe = state.paramVibe?.id === vibe.id ? null : vibe;
          paint();
        },
      }),
      state.paramVibe
        ? renderParamPicker(state.paramVibe, {
            onCancel: () => {
              state.paramVibe = null;
              paint();
            },
            // Only offered when this vibe is the one actually in play, so
            // "Clear" always has something to clear.
            onClear:
              poolState.vibe === state.paramVibe.id
                ? () => {
                    state.paramVibe = null;
                    clearVibe(state.lists);
                    refreshCount();
                    refreshFacets();
                    paint();
                  }
                : null,
            onChosen: async (person) => {
              const vibe = state.paramVibe;
              state.paramVibe = null;
              paint();
              try {
                const { vibe: resolved, applied } = await api.applyVibeParameter(vibe.id, {
                  id: person.id,
                  name: person.name,
                });
                if (applied.count === 0) {
                  toast(`Nothing found for ${person.name}`, 'error');
                  return;
                }
                // Replace the cached vibe so the chip reads as active and the
                // next apply uses the list it now points at.
                state.vibes = state.vibes.map((v) => (v.id === resolved.id ? resolved : v));

                if (applied.kind === 'filter') {
                  // A country NARROWS what is already selected rather than
                  // replacing it — "Japanese films, from my lists". Every other
                  // vibe replaces the setup wholesale; this one cannot, or
                  // "Japanese night" would silently also change which lists are
                  // in play and the count would move for two reasons at once.
                  poolState.applyVibe(resolved.id, {
                    ...poolState.setup,
                    filters: { ...poolState.filters, ...applied.filters },
                  });
                } else {
                  applyVibe(resolved);
                }
                // Same reversal as onApply above: no auto-expand. This path
                // says even more without it — the toast names the value that
                // was chosen and how many films it found.
                toast(`${applied.name} — ${applied.count} films`);
                refreshCount();
                refreshFacets();
                paint();
              } catch (error) {
                toast(error.message, 'error');
              }
            },
          })
        : null,
      poolSetup(),
      h(
        'div',
        { class: 'row' },
        h('div', { class: 'field-label' }, lineup.movies.length ? 'Draw more' : 'Draw'),
        h('input', {
          type: 'number',
          min: String(MIN_DRAW_SIZE),
          max: String(MAX_DRAW_SIZE),
          value: String(state.size),
          style: 'width:64px',
          onInput: (event) => {
            const parsed = Number(event.target.value);
            state.size = Math.min(
              MAX_DRAW_SIZE,
              Math.max(MIN_DRAW_SIZE, Number.isFinite(parsed) ? Math.trunc(parsed) : state.size),
            );
            event.target.value = String(state.size);
            paintCount();
          },
        }),
        h('span', { class: 'muted' }, state.size === 1 ? 'film' : 'films'),
        h('span', { class: 'spacer' }),
        countNode,
      ),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn-primary',
            disabled: state.busy || state.poolCount === 0,
            onClick: doDraw,
          },
          lineup.movies.length ? `Draw ${state.size} more` : `Draw ${state.size}`,
        ),
        // Only offered when there is something drawn to replace — with a
        // hand-picked lineup this button would do nothing.
        lineup.drawn().length
          ? h(
              'button',
              { disabled: state.busy, onClick: doReplace },
              `Replace ${lineup.drawn().length}`,
            )
          : null,
        lineup.movies.length
          ? h(
              'button',
              {
                onClick: () => {
                  lineup.clear();
                  rejected.clear();
                  refreshCount();
                  paint();
                },
              },
              'Clear all',
            )
          : null,
      ),
    );
  }

  /**
   * Bring a just-drawn film into view, after the repaint that put it there.
   *
   * The lineup sits below the draw controls, so on anything but a tall screen
   * a draw scrolled nothing and the page looked unchanged — the one moment
   * this app has that is worth watching happened off-screen. Silent when the
   * card cannot be found: a missed scroll is not worth an error, and it never
   * runs on the vote or Explore grids, only the lineup's own.
   */
  function revealDrawn(movie) {
    if (!movie) return;
    const card = container.querySelector(
      `.movie-grid.is-lineup > [data-tmdb-id="${movie.tmdb_id}"]`,
    );
    if (!card?.scrollIntoView) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  }

  /**
   * Toasts stack on top of one another — they are all `position: fixed` at the
   * same offset — so every path here emits exactly ONE. When the pool came up
   * short that is the shortfall, which is the thing the host needs to act on;
   * the draw still announces itself by scrolling.
   */
  function reportDraw(movies, shortfallMessage) {
    if (shortfallMessage) {
      toast(shortfallMessage, 'error');
      return;
    }
    const message = drawnMessage(movies);
    if (message) toast(message, 'ok');
  }

  // Everything discarded by Replace this session. Passed as `exclude` so
  // repeated Replaces cycle through fresh options instead of handing back the
  // film rejected two clicks ago — the draw otherwise only knows to avoid
  // what is currently IN the lineup.
  const rejected = new Set();

  /**
   * Swap out the drawn films for new ones, leaving deliberate picks alone.
   *
   * Only touches entries whose provenance is 'draw': a film someone searched
   * for, pasted or added from Explore is theirs, not the machine's to discard.
   */
  async function doReplace() {
    const drawn = lineup.drawn();
    if (drawn.length === 0) return;

    state.busy = true;
    paint();
    let firstNew = null;
    try {
      for (const movie of drawn) rejected.add(movie.tmdb_id);
      // Exclude what stays in the lineup, what we're about to drop, and
      // everything already rejected — otherwise the replacements can include
      // the very films being replaced.
      const exclude = [...new Set([...lineup.ids(), ...rejected])];
      const result = await api.draw(drawn.length, poolState.setup, exclude);

      if (result.movies.length === 0) {
        toast('Nothing new left to draw with these filters', 'error');
        return;
      }
      for (const movie of drawn) lineup.remove(movie.tmdb_id);
      lineup.addAll(result.movies, 'draw');
      firstNew = result.movies[0] ?? null;

      reportDraw(
        result.movies,
        result.movies.length < drawn.length
          ? `Only ${plural(result.movies.length, 'new film')} left to swap in`
          : null,
      );
      await refreshCount();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.busy = false;
      paint();
      revealDrawn(firstNew);
    }
  }

  async function doDraw() {
    state.busy = true;
    paint();
    let firstNew = null;
    try {
      const result = await api.draw(state.size, poolState.setup, lineup.ids());
      lineup.addAll(result.movies, 'draw');
      firstNew = result.movies[0] ?? null;

      reportDraw(
        result.movies,
        result.shortfall > 0
          ? `Only ${plural(result.available, 'new film')} matched — asked for ${result.requested} more`
          : null,
      );
      await refreshCount();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.busy = false;
      paint();
      revealDrawn(firstNew);
    }
  }

  // --- Add a specific film --------------------------------------------------

  async function addToLineup(tmdbId, mediaType) {
    const storageId = mediaType === 'tv' ? -Math.abs(tmdbId) : tmdbId;
    if (lineup.has(storageId)) {
      toast('Already in your lineup', 'error');
      return;
    }
    try {
      const { movie } = await api.getOrCacheMovie(tmdbId, mediaType);
      if (!lineup.add(movie)) {
        toast('Already in your lineup', 'error');
        return;
      }
      toast(`Added ${movie.title}`, 'ok');
      await refreshCount();
      paint();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  // Search results only carry the light fields the search endpoint returns
  // (title, year, poster, overview) — no director, runtime, genres or trailer.
  // Deciding on a manual add is exactly when that fuller picture matters most,
  // so this fetches (or reuses the cache of) the full detail record before
  // opening the same overlay the movie cards use elsewhere.
  async function showCandidateDetail(candidate) {
    try {
      const { movie } = await api.getOrCacheMovie(candidate.tmdb_id, 'movie');
      openMovieModal(movie);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function searchResultCard(candidate) {
    const already = lineup.has(candidate.tmdb_id);
    const poster = posterUrl(candidate.poster_path, 'w92');
    return h(
      'div',
      { class: 'candidate-card' },
      poster
        ? h('img', { src: poster, alt: '', class: 'candidate-poster', loading: 'lazy' })
        : h('div', { class: 'candidate-poster candidate-poster--empty' }, '🎬'),
      h(
        'div',
        { class: 'candidate-body' },
        h(
          'div',
          { class: 'row', style: 'gap:8px' },
          h(
            'button',
            { class: 'candidate-title', onClick: () => showCandidateDetail(candidate) },
            `${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`,
          ),
          h(
            'a',
            { href: tmdbUrl(candidate.tmdb_id), target: '_blank', rel: 'noopener noreferrer', class: 'faint' },
            'View on TMDB ↗',
          ),
        ),
        // Search hits your own curated lists just as often as it hits
        // something nobody's imported — worth knowing which before adding.
        // `lists` is an array of membership OBJECTS ({ name, rank, year,
        // by_year }), not the comma-joined string this once interpolated —
        // which rendered "Already on: [object Object]" for every film that was
        // on one. Names only here: the ranks belong in the detail overlay,
        // where there is room to say what a rank is of.
        //
        // Length, not truthiness: a film known to the library but on no list
        // comes back as an empty array, which is truthy and printed nothing
        // after the colon.
        candidate.lists?.length
          ? h(
              'div',
              { class: 'faint' },
              `Already on: ${candidate.lists.map((entry) => entry.name).join(', ')}`,
            )
          : h('div', { class: 'faint' }, 'Not on any of your lists'),
        candidate.overview ? h('p', { class: 'candidate-overview' }, candidate.overview) : null,
        h(
          'button',
          {
            class: 'btn-sm',
            disabled: already,
            onClick: () => addToLineup(candidate.tmdb_id, 'movie'),
          },
          already ? 'Already added' : '+ Add to lineup',
        ),
      ),
    );
  }

  async function addManualMovie(title, year) {
    if (!title.trim()) {
      toast('A title is required', 'error');
      return false;
    }
    try {
      const { movie } = await api.addManualMovie(title.trim(), year || null);
      lineup.add(movie);
      toast(`Added ${movie.title}`, 'ok');
      await refreshCount();
      paint();
      return true;
    } catch (error) {
      toast(error.message, 'error');
      return false;
    }
  }

  /**
   * Adding a film by name, behind one permanent secondary button.
   *
   * It used to sit in a `1fr 1fr` grid beside the draw controls, which sized it
   * wrong in both directions at once: half the screen standing empty on the
   * many nights nobody uses it, and a 480px column crushing the search results
   * on the nights they do. Demoting it to a button that expands to full width
   * fixes both, because the two states no longer have to share a size.
   */
  function addFilmPanel() {
    const toggle = h(
      'button',
      {
        class: state.addFilmOpen ? 'btn-sm' : 'btn-sm add-film-toggle',
        'aria-expanded': state.addFilmOpen ? 'true' : 'false',
        onClick: () => {
          state.addFilmOpen = !state.addFilmOpen;
          if (!state.addFilmOpen) {
            state.searchResults = [];
            state.idOffer = null;
          }
          paint();
        },
      },
      state.addFilmOpen ? 'Hide' : '+ Add a specific film',
    );

    const row = h(
      'div',
      { class: 'row' },
      toggle,
      state.addFilmOpen
        ? null
        : h('span', { class: 'faint' }, 'someone already has a proposal — no draw required'),
    );

    if (!state.addFilmOpen) return row;

    const results = h('div', { class: 'candidate-list' });
    const renderResults = () => {
      clear(results).append(
        // The bare-digits offer, when there is one, sits ABOVE the search hits:
        // it is the reading the host had to type an id to get, so burying it
        // under a title match would defeat the point of offering it.
        state.idOffer
          ? h(
              'div',
              { class: 'row id-offer' },
              h(
                'span',
                { class: 'muted' },
                `“${state.idOffer.raw}” could also be a TMDB id.`,
              ),
              h('span', { class: 'spacer' }),
              h(
                'button',
                {
                  class: 'btn-sm',
                  onClick: () => addToLineup(state.idOffer.tmdbId, 'movie'),
                },
                `Add movie id ${state.idOffer.tmdbId}`,
              ),
            )
          : null,
        ...state.searchResults.map((candidate) => searchResultCard(candidate)),
      );
    };
    renderResults();

    /**
     * One box for all three ways in, because they were never really different
     * questions — "which film" was just being asked three times.
     *
     * A URL is unambiguous and adds the film outright. Bare digits are NOT:
     * every one of 1917, 300, 2012 and 1408 is both a real title and a
     * plausible id, so `parseTmdbInput` reading them as an id would quietly
     * add the wrong film to somebody's night. Those search like anything else
     * and get the id reading offered beside the results instead.
     */
    const searchInput = h('input', {
      type: 'search',
      placeholder: 'Search TMDB, or paste a URL or id…',
      onKeydown: async (event) => {
        if (event.key !== 'Enter') return;
        const raw = event.target.value.trim();
        if (!raw) return;

        const parsed = parseTmdbInput(raw);
        const bareDigits = /^\d+$/.test(raw);
        if (parsed && !bareDigits) {
          // No need to clear the box on success: adding repaints the panel, and
          // a failed add is one the host will want to edit rather than retype.
          await addToLineup(parsed.tmdbId, parsed.mediaType);
          return;
        }

        try {
          const { results: found } = await api.searchTmdb(raw);
          state.searchResults = found;
          state.idOffer = bareDigits ? { raw, tmdbId: Number(raw) } : null;
          if (found.length === 0 && !bareDigits) toast(`Nothing found for “${raw}”`, 'error');
          renderResults();
        } catch (error) {
          toast(error.message, 'error');
        }
      },
    });

    // Genuinely rare — a proposal not on TMDB at all — so it stays folded even
    // inside a panel the host has already opened deliberately.
    let manualOpen = false;
    let manualTitle = '';
    let manualYear = '';
    const manualBody = h('div');
    const renderManual = () => {
      if (!manualOpen) {
        clear(manualBody);
        return;
      }
      clear(manualBody).append(
        h(
          'div',
          { class: 'row', style: 'margin-top:8px' },
          h('input', {
            type: 'text',
            placeholder: 'Title',
            style: 'max-width:220px',
            onInput: (event) => {
              manualTitle = event.target.value;
            },
          }),
          h('input', {
            type: 'number',
            placeholder: 'Year (optional)',
            style: 'max-width:120px',
            onInput: (event) => {
              manualYear = event.target.value ? Number(event.target.value) : '';
            },
          }),
          h(
            'button',
            {
              class: 'btn-sm',
              // paint() inside addManualMovie already rebuilds this whole
              // panel from scratch on success, collapsing it back to closed —
              // nothing further to do with this (about to be discarded) closure.
              onClick: () => addManualMovie(manualTitle, manualYear),
            },
            'Add manually',
          ),
        ),
      );
    };

    return h(
      'div',
      { class: 'stack' },
      row,
      h(
        'div',
        { class: 'card stack' },
        h(
          'div',
          { class: 'row' },
          searchInput,
          h(
            'button',
            {
              class: 'btn-sm',
              onClick: () => {
                searchInput.value = '';
                state.searchResults = [];
                state.idOffer = null;
                renderResults();
                searchInput.focus();
              },
            },
            'Clear',
          ),
        ),
        h(
          'span',
          { class: 'faint' },
          'press Enter — a themoviedb.org URL adds the film outright, ' +
            'which is the way in for TV-catalogued titles search cannot find',
        ),
        results,
        h(
          'button',
          {
            class: 'expand-link',
            style: 'margin:4px 0 0',
            onClick: () => {
              manualOpen = !manualOpen;
              renderManual();
            },
          },
          'Still can’t find it? Add it manually',
        ),
        manualBody,
      ),
    );
  }

  // --- The Lineup + publish --------------------------------------------------

  function lineupGrid() {
    if (lineup.movies.length === 0) {
      return h(
        'div',
        { class: 'empty' },
        'Your lineup is empty — draw some at random, search for a specific film, ' +
          'or add one from the Explore tab.',
      );
    }

    return h(
      'div',
      { class: 'stack' },
      h(
        'div',
        { class: 'movie-grid is-lineup' },
        lineup.movies.map((movie) =>
          movieCard(movie, {
            extraAction: {
              label: '✕ Remove',
              onClick: async () => {
                lineup.remove(movie.tmdb_id);
                await refreshCount();
                paint();
              },
            },
          }),
        ),
      ),
      // Publish is the point of the screen and it used to sit under every card
      // in the lineup — four screens down on a phone with five films staged.
      // Sticky, in the same shape the vote screen already uses for the same
      // reason: the primary action does not get pushed off the page by the
      // content it acts on.
      h(
        'div',
        { class: 'lineup-sticky' },
        h(
          'div',
          { class: 'card stack' },
          h(
            'label',
            { class: 'check' },
            h('input', {
              type: 'checkbox',
              checked: state.anonymous,
              onChange: (event) => {
                state.anonymous = event.target.checked;
                paint();
              },
            }),
            h(
              'span',
              {},
              'Anonymous voting',
              h(
                'span',
                { class: 'faint' },
                ' — once closed, individual ballots stay hidden from everyone, including you. ' +
                  'Only totals are shown.',
              ),
            ),
          ),
          h(
            'div',
            { class: 'row' },
            h(
              'button',
              {
                class: 'btn-primary',
                disabled: state.busy || lineup.movies.length === 0,
                onClick: doPublish,
              },
              'Publish & open voting',
            ),
            h('span', { class: 'faint' }, `${plural(lineup.movies.length, 'film')} on the ballot`),
          ),
        ),
      ),
    );
  }

  /**
   * The way back to a vote that is already running.
   *
   * Rendered above everything else on the tab, because the alternative it
   * replaces is a host staring at an empty lineup while guests are voting on
   * a session they can no longer reach.
   */
  function liveSessionBanner() {
    const live = state.liveSession;
    if (!live) return null;

    return h(
      'div',
      { class: 'card row live-banner' },
      h(
        'div',
        {},
        h('strong', {}, 'A vote is open'),
        h(
          'div',
          { class: 'faint' },
          `${plural(live.movie_count, 'film')} · ${plural(live.ballot_count, 'ballot')} in`,
        ),
      ),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn-primary btn-sm', onClick: () => showSession(live.slug) }, 'Go to it'),
    );
  }

  async function doPublish() {
    state.busy = true;
    paint();
    try {
      const session = await api.publish(lineup.ids(), state.anonymous, poolState.setup);
      showSession(session.slug);
    } catch (error) {
      toast(error.message, 'error');
      // The most likely reason a publish is refused is that a vote is already
      // open, and the host cannot see one from here. Re-deriving it puts the
      // banner — and the route back — on screen with the error.
      await refreshLiveSession();
      state.busy = false;
      paint();
    }
  }

  function showSession(slug) {
    stopSession();
    clear(container);
    const panel = h('div');
    container.append(
      h(
        'div',
        { class: 'row', style: 'margin-bottom:16px' },
        h(
          'button',
          {
            class: 'btn-sm',
            onClick: async () => {
              stopSession();
              lineup.clear();
              state.searchResults = [];
              state.busy = false;
              refreshCount();
              paint();
              // Leaving the panel does not end the vote. Re-derive it so the
              // banner comes back with real counts rather than the stale ones
              // this tab was carrying before the vote was published.
              await refreshLiveSession();
              paint();
            },
          },
          '← New lineup',
        ),
      ),
      panel,
    );
    sessionTeardown = renderSessionPanel(panel, slug, {
      host: true,
      // Scoped to THIS session: the History tab renders closed sessions through
      // the same panel and passes no callback, so opening last week's result
      // cannot wipe the lineup being built now.
      onEnded: (outcome) => {
        // Either ending means no vote is live, so the banner must go.
        state.liveSession = null;
        // But only a CLOSED vote spends the lineup that produced it — switching
        // back should start fresh rather than show last night's films as though
        // they were still staged. A cancelled vote was thrown away on purpose,
        // and its lineup is the one thing worth keeping to publish again.
        if (outcome === 'closed') {
          lineup.clear();
          refreshCount();
        }
      },
    });
  }

  function paint() {
    clear(container).append(
      h(
        'div',
        { class: 'stack' },
        liveSessionBanner(),
        drawControls(),
        addFilmPanel(),
        h(
          'div',
          { class: 'row' },
          h('h2', {}, `Your lineup${lineup.movies.length ? ` (${lineup.movies.length})` : ''}`),
          h('span', { class: 'spacer' }),
          renderAwardsToggle(paint),
          renderRatingToggle(paint),
        ),
        lineupGrid(),
      ),
    );
  }

  await refreshData();
  paint();
  // After the first paint, so `countNode` exists for paintCount() to write to.
  // Not awaited: the panel is usable immediately and the count fills itself in.
  refreshCount();

  return () => {
    countToken += 1;
    stopSession();
  };
}
