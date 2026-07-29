import { h, clear, toast, plural, posterUrl, tmdbUrl, parseTmdbInput, openMovieModal } from '../dom.js';
import { api } from '../api.js';
import { renderSessionPanel } from './session.js';
import {
  renderFilterPanel,
  renderListPicker,
  renderTopN,
  renderVibeChips,
  renderTagFilter,
  renderAwardsToggle,
  movieCard,
} from '../browse.js';
import { lineup } from '../lineup.js';
import { poolState } from '../pool-state.js';
import { currentAsVibe } from '../occasions.js';

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
    size: 2,
    searchResults: [],
    anonymous: false,
    poolCount: null,
    busy: false,
  };

  let sessionTeardown = null;
  const stopSession = () => {
    sessionTeardown?.();
    sessionTeardown = null;
  };

  async function refreshData() {
    const [{ lists }, facets, { tags }, { vibes }] = await Promise.all([
      api.lists(),
      api.facets(),
      api.tags(),
      api.vibes(),
    ]);
    state.lists = lists;
    state.facets = facets;
    state.vocabulary = tags;
    state.vibes = vibes;
    // First load only — adopts whatever the Lists tab marked active by
    // default. Subsequent mounts keep whatever the host chose for tonight.
    poolState.seedFrom(lists);
    state.poolCount = facets.total;
  }

  let countToken = 0;
  async function refreshCount() {
    const token = ++countToken;
    try {
      const { count } = await api.poolCount(poolState.filters, lineup.ids());
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
    const f = poolState.filters;
    if (f.topN) parts.push(`top ${f.topN}`);
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
                paint();
              },
              { vocabulary: state.vocabulary, tagFilter: state.tagFilter },
            ),
            renderTopN(state.lists, () => refreshCount()),
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
      if (created) poolState.applyOccasion(created.id, poolState.filters);
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
      poolState.markCustom();
      toast(`Deleted "${vibe.name}"`, 'ok');
      paint();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function filterPanel() {
    return renderFilterPanel(poolState.filters, state.facets, {
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
          // Applying a vibe changes the whole pool, so the setup panel opens
          // to show what it actually did rather than leaving the host to take
          // a one-line summary on faith.
          state.poolSetupOpen = true;
          refreshCount();
          paint();
        },
        onSave: saveCurrentAsVibe,
        onDelete: removeVibe,
      }),
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
        lineup.movies.length
          ? h(
              'button',
              {
                onClick: () => {
                  lineup.clear();
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

  async function doDraw() {
    state.busy = true;
    paint();
    try {
      const result = await api.draw(state.size, poolState.filters, lineup.ids());
      lineup.addAll(result.movies);
      if (result.shortfall > 0) {
        toast(
          `Only ${plural(result.available, 'new film')} matched — asked for ${result.requested} more`,
          'error',
        );
      }
      await refreshCount();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.busy = false;
      paint();
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
        candidate.lists
          ? h('div', { class: 'faint' }, `Already on: ${candidate.lists}`)
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

  function addFilmPanel() {
    const results = h('div', { class: 'candidate-list' });
    const renderResults = () => {
      clear(results).append(...state.searchResults.map((candidate) => searchResultCard(candidate)));
    };
    renderResults();

    const searchInput = h('input', {
      type: 'search',
      placeholder: 'Search TMDB…',
      style: 'max-width:320px',
      onKeydown: async (event) => {
        if (event.key !== 'Enter') return;
        const { results: found } = await api.searchTmdb(event.target.value);
        state.searchResults = found;
        renderResults();
      },
    });

    // Collapsed by default — genuinely rare (a proposal not on TMDB at all),
    // so it shouldn't compete for attention with search, the normal path.
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
      { class: 'card stack' },
      h('h2', {}, 'Add a specific film'),
      h(
        'p',
        { class: 'muted' },
        'For when someone already has a proposal — search TMDB directly, no draw required.',
      ),
      h(
        'div',
        { class: 'row' },
        searchInput,
        h('span', { class: 'faint' }, 'press Enter'),
        h(
          'button',
          {
            class: 'btn-sm',
            onClick: () => {
              searchInput.value = '';
              state.searchResults = [];
              renderResults();
              searchInput.focus();
            },
          },
          'Clear',
        ),
      ),
      results,
      h(
        'div',
        { class: 'row' },
        h('input', {
          type: 'text',
          placeholder: 'Or paste a TMDB URL or id (movie or TV)…',
          style: 'max-width:340px',
          onKeydown: async (event) => {
            if (event.key !== 'Enter') return;
            const parsed = parseTmdbInput(event.target.value);
            if (!parsed) {
              toast('Paste a themoviedb.org/movie/… or /tv/… URL, or a bare numeric id', 'error');
              return;
            }
            await addToLineup(parsed.tmdbId, parsed.mediaType);
            event.target.value = '';
          },
        }),
        h(
          'span',
          { class: 'faint' },
          'press Enter — for TV-catalogued titles search can’t find',
        ),
      ),
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
        manualOpen ? 'Hide manual entry' : 'Still can’t find it? Add it manually',
      ),
      manualBody,
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
        { class: 'movie-grid' },
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
    );
  }

  async function doPublish() {
    state.busy = true;
    paint();
    try {
      const session = await api.publish(lineup.ids(), state.anonymous, poolState.filters);
      showSession(session.slug);
    } catch (error) {
      toast(error.message, 'error');
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
            onClick: () => {
              stopSession();
              lineup.clear();
              state.searchResults = [];
              state.busy = false;
              refreshCount();
              paint();
            },
          },
          '← New lineup',
        ),
      ),
      panel,
    );
    sessionTeardown = renderSessionPanel(panel, slug, { host: true });
  }

  function paint() {
    clear(container).append(
      h(
        'div',
        { class: 'stack' },
        h('div', { class: 'tools-row' }, drawControls(), addFilmPanel()),
        h(
          'div',
          { class: 'row' },
          h('h2', {}, `Your lineup${lineup.movies.length ? ` (${lineup.movies.length})` : ''}`),
          h('span', { class: 'spacer' }),
          renderAwardsToggle(paint),
        ),
        lineupGrid(),
      ),
    );
  }

  await refreshData();
  paint();

  return () => {
    countToken += 1;
    stopSession();
  };
}
