import { h, clear, posterUrl, toast, plural, tmdbUrl, openMovieModal, parseTmdbInput } from '../dom.js';
import { api } from '../api.js';
import { poolState } from '../pool-state.js';

export async function renderLists(container) {
  const state = {
    lists: [],
    openListId: null,
    // Opening a list is the "inspect what's in here" action, so it shows
    // everything by default; the checkbox narrows to the reconciliation queue.
    reviewOnly: false,
    entries: [],
    job: null,
    busy: false,
  };


  let jobTimer = null;
  const stopJob = () => clearInterval(jobTimer);

  async function refresh() {
    const { lists } = await api.lists();
    state.lists = lists;
  }

  // --- Import ------------------------------------------------------------

  async function startImport(listId, text, format) {
    if (!text.trim()) {
      toast('Paste some titles or choose a file first', 'error');
      return;
    }
    try {
      state.job = await api.importList(listId, text, format);
      paint();
      stopJob();
      jobTimer = setInterval(async () => {
        try {
          state.job = await api.importJob(state.job.id);
          if (state.job.status !== 'running') {
            stopJob();
            await refresh();
            if (state.openListId === listId) await loadEntries(listId);
            toast(
              `Imported ${state.job.resolved} film${state.job.resolved === 1 ? '' : 's'}` +
                (state.job.needs_review + state.job.unmatched
                  ? `, ${state.job.needs_review + state.job.unmatched} need review`
                  : ''),
              'ok',
            );
          }
          paint();
        } catch (error) {
          stopJob();
          toast(error.message, 'error');
        }
      }, 800);
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  function importPanel() {
    if (state.lists.length === 0) return null;

    let selectedId = state.lists.find((l) => l.kind === 'custom')?.id ?? state.lists[0].id;
    let text = '';
    let format = null;

    const textarea = h('textarea', {
      placeholder:
        'One title per line — "Vertigo (1958)" or just "Vertigo".\nCSV and JSON also work; paste or use the file picker.',
      onInput: (event) => {
        text = event.target.value;
        format = null;
      },
    });

    return h(
      'div',
      { class: 'card stack' },
      h('h2', {}, 'Import titles'),
      h(
        'div',
        { class: 'row' },
        h(
          'select',
          {
            style: 'max-width:260px',
            onChange: (event) => {
              selectedId = Number(event.target.value);
            },
          },
          state.lists.map((list) =>
            h('option', { value: String(list.id), selected: list.id === selectedId }, list.name),
          ),
        ),
        h('input', {
          type: 'file',
          accept: '.csv,.json,.txt,text/csv,application/json,text/plain',
          style: 'max-width:280px',
          onChange: async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            text = await file.text();
            format = file.name.endsWith('.json') ? 'json' : file.name.endsWith('.csv') ? 'csv' : null;
            textarea.value = text;
          },
        }),
      ),
      textarea,
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn-primary',
            disabled: Boolean(state.job && state.job.status === 'running'),
            onClick: () => startImport(selectedId, text, format),
          },
          'Import & match against TMDB',
        ),
        state.job
          ? h(
              'span',
              { class: 'muted' },
              state.job.status === 'running'
                ? `Matching ${state.job.done} of ${state.job.total}…`
                : `Done: ${state.job.resolved} matched, ${state.job.needs_review} to review, ${state.job.unmatched} unmatched, ${state.job.duplicate} already present`,
            )
          : h('span', { class: 'faint' }, 'Each title is resolved to a TMDB id, so the same film on two lists only draws once.'),
      ),
    );
  }

  // --- Reconciliation ----------------------------------------------------

  async function loadEntries(listId) {
    state.entries = (
      await api.entries(listId, {
        ...(state.reviewOnly ? { status: 'needs_review' } : {}),
        // Comfortably covers the biggest seed list (Criterion, ~1250 resolved).
        limit: 2000,
      })
    ).entries;
  }

  async function openList(listId) {
    state.openListId = state.openListId === listId ? null : listId;
    if (state.openListId) await loadEntries(state.openListId);
    paint();
  }

  function entryRow(entry, list) {
    if (entry.status === 'resolved') {
      return h(
        'div',
        { class: 'list-row' },
        posterUrl(entry.poster_path, 'w92')
          ? h('img', {
              src: posterUrl(entry.poster_path, 'w92'),
              alt: '',
              width: '30',
              loading: 'lazy',
              style: 'border-radius:3px',
            })
          : null,
        h('span', {}, `${entry.title}${entry.year ? ` (${entry.year})` : ''}`),
        entry.media_type === 'tv' ? h('span', { class: 'badge' }, 'TV') : null,
        h(
          'a',
          {
            href: tmdbUrl(entry.tmdb_id, entry.media_type),
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'faint',
          },
          'TMDB ↗',
        ),
        h(
          'button',
          { class: 'expand-link', style: 'margin:0', onClick: () => openMovieModal(entry) },
          'Read more',
        ),
        entry.watched ? h('span', { class: 'badge' }, 'watched') : null,
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn-sm',
            onClick: async () => {
              await api.setWatched(entry.tmdb_id, !entry.watched);
              await loadEntries(state.openListId);
              paint();
            },
          },
          entry.watched ? 'Unwatch' : 'Mark watched',
        ),
        h(
          'button',
          {
            class: 'btn-sm btn-danger',
            onClick: async () => {
              await api.deleteEntry(entry.id);
              await refresh();
              await loadEntries(state.openListId);
              paint();
            },
          },
          'Remove',
        ),
      );
    }

    // Unresolved: offer the stored candidates plus a manual search, rather than
    // dropping the title silently. TMDB search already caps at 10 results
    // server-side, so the "matches" stepper below just controls how many of
    // those are shown — no extra network call needed when it changes.
    const searchResults = h('div', { class: 'candidate-list' });
    let lastResults = [];
    let matchLimit = 6;

    const renderMatches = () => {
      const items = lastResults.length
        ? lastResults.slice(0, matchLimit).map((candidate) => candidateChip(entry, candidate))
        : [h('span', { class: 'faint' }, 'Nothing found')];
      clear(searchResults).append(...items);
    };

    return h(
      'div',
      { class: 'card stack', style: 'gap:10px' },
      h(
        'div',
        { class: 'row' },
        h('strong', {}, entry.raw_title),
        entry.raw_year ? h('span', { class: 'muted' }, `(${entry.raw_year})`) : null,
        h('span', { class: 'badge badge-warn' }, entry.status === 'unmatched' ? 'no match' : 'needs review'),
        list.source_url
          ? h(
              'a',
              {
                href: list.source_url,
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'faint',
                title: list.source ?? undefined,
              },
              'view in original list ↗',
            )
          : null,
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn-sm btn-danger',
            onClick: async () => {
              await api.deleteEntry(entry.id);
              await refresh();
              await loadEntries(state.openListId);
              paint();
            },
          },
          'Drop',
        ),
      ),
      entry.candidates.length
        ? h(
            'div',
            { class: 'candidate-list' },
            entry.candidates.map((candidate) => candidateChip(entry, candidate)),
          )
        : null,
      h(
        'div',
        { class: 'row' },
        h('input', {
          type: 'search',
          placeholder: `Search TMDB for "${entry.raw_title}"…`,
          style: 'max-width:340px',
          onKeydown: async (event) => {
            if (event.key !== 'Enter') return;
            const { results } = await api.searchTmdb(event.target.value, entry.raw_year);
            lastResults = results;
            renderMatches();
          },
        }),
        h('span', { class: 'faint' }, 'press Enter'),
        h('span', { class: 'spacer' }),
        h(
          'label',
          { class: 'row', style: 'gap:6px' },
          h('span', { class: 'faint' }, 'Matches'),
          h('input', {
            type: 'number',
            min: '1',
            max: '10',
            value: String(matchLimit),
            style: 'width:60px',
            onInput: (event) => {
              const parsed = Number(event.target.value);
              matchLimit = Math.min(10, Math.max(1, Number.isFinite(parsed) ? Math.trunc(parsed) : 6));
              event.target.value = String(matchLimit);
              renderMatches();
            },
          }),
        ),
      ),
      searchResults,
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
              toast(
                'Paste a themoviedb.org/movie/… or /tv/… URL, or a bare numeric id',
                'error',
              );
              return;
            }
            try {
              const result = await api.resolveEntry(entry.id, parsed.tmdbId, parsed.mediaType);
              toast(
                result.status === 'duplicate'
                  ? 'Already on this list — the duplicate entry was removed'
                  : `Matched to ${result.movie?.title ?? 'the pasted TMDB entry'}`,
                'ok',
              );
              await refresh();
              await loadEntries(state.openListId);
              paint();
            } catch (error) {
              toast(error.message, 'error');
            }
          },
        }),
        h(
          'span',
          { class: 'faint' },
          'press Enter — for entries search can’t find, e.g. ones catalogued as a TV series',
        ),
      ),
      boxsetResolver(entry),
    );
  }

  /**
   * Some Criterion spine numbers are boxsets (e.g. the Qatsi Trilogy bundles
   * three separate films under one release), so the raw entry doesn't
   * correspond to any single TMDB title at all. This splits it into N
   * ordinary resolved entries instead of forcing one match — reuses the same
   * direct TMDB URL/id parsing as the single-paste box above, just one line
   * per film.
   */
  function boxsetResolver(entry) {
    let open = false;
    let text = '';
    const body = h('div');

    const renderBody = () => {
      if (!open) {
        clear(body);
        return;
      }
      clear(body).append(
        h(
          'div',
          { class: 'stack', style: 'gap:8px; margin-top:8px' },
          h('textarea', {
            placeholder:
              'One TMDB URL or id per line — one for each film in the boxset (e.g. the three Qatsi films)',
            style: 'min-height:80px',
            onInput: (event) => {
              text = event.target.value;
            },
          }),
          h(
            'button',
            {
              class: 'btn-sm',
              onClick: async () => {
                const items = text
                  .split('\n')
                  .map((line) => parseTmdbInput(line))
                  .filter(Boolean);
                if (items.length === 0) {
                  toast('Paste at least one TMDB URL or id, one per line', 'error');
                  return;
                }
                try {
                  const { resolved, failed } = await api.resolveEntryMany(entry.id, items);
                  if (resolved.length) {
                    toast(
                      `Resolved ${plural(resolved.length, 'film')}: ${resolved.map((m) => m.title).join(', ')}` +
                        (failed.length ? ` — ${failed.length} failed` : ''),
                      failed.length ? 'error' : 'ok',
                    );
                  } else {
                    toast(`Nothing resolved — ${failed.map((f) => f.error).join('; ')}`, 'error');
                  }
                  await refresh();
                  await loadEntries(state.openListId);
                  paint();
                } catch (error) {
                  toast(error.message, 'error');
                }
              },
            },
            'Resolve into separate films',
          ),
        ),
      );
    };

    return h(
      'div',
      {},
      h(
        'button',
        {
          class: 'expand-link',
          style: 'margin:4px 0 0',
          onClick: () => {
            open = !open;
            renderBody();
          },
        },
        open ? 'Hide boxset resolver' : 'This is a boxset — resolve into separate films',
      ),
      body,
    );
  }

  // A link to view the candidate on TMDB plus its synopsis, separate from the
  // "use this" action — so picking the right match is a comparison, not a
  // guess from a title and year alone.
  function candidateChip(entry, candidate) {
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
          h('strong', {}, `${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`),
          h(
            'a',
            { href: tmdbUrl(candidate.tmdb_id), target: '_blank', rel: 'noopener noreferrer', class: 'faint' },
            'View on TMDB ↗',
          ),
        ),
        candidate.overview
          ? h('p', { class: 'candidate-overview' }, candidate.overview)
          : null,
        h(
          'button',
          {
            class: 'btn-sm',
            onClick: async () => {
              try {
                const result = await api.resolveEntry(entry.id, candidate.tmdb_id);
                toast(
                  result.status === 'duplicate'
                    ? 'Already on this list — the duplicate entry was removed'
                    : `Matched to ${candidate.title}`,
                  'ok',
                );
                await refresh();
                await loadEntries(state.openListId);
                paint();
              } catch (error) {
                toast(error.message, 'error');
              }
            },
          },
          'Use this match',
        ),
      ),
    );
  }

  // --- Lists -------------------------------------------------------------

  function listRow(list) {
    const isOpen = state.openListId === list.id;
    return h(
      'div',
      { class: 'stack', style: 'gap:8px' },
      h(
        'div',
        { class: `list-row${list.is_active ? ' is-active' : ''}` },
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(list.is_active),
            onChange: async (event) => {
              const on = event.target.checked;
              await api.updateList(list.id, { is_active: on });
              // This tab is where the "in play by default" preference is
              // curated, so a change here applies to tonight as well —
              // otherwise you'd switch a list on, walk over to the Lineup tab,
              // and find it conspicuously absent from the pool. Draw/Explore
              // work the other way round: what you pick there is tonight-only
              // and never rewrites this preference.
              poolState.setSelected(list.id, on);
              await refresh();
              paint();
            },
          }),
          h('span', { class: 'list-name' }, list.name),
        ),
        h('span', { class: 'badge badge-kind' }, list.kind),
        h('span', { class: 'spacer' }),
        h('span', { class: 'badge' }, `${list.resolved_count} films`),
        list.review_count > 0
          ? h('span', { class: 'badge badge-warn' }, `${list.review_count} to review`)
          : null,
        h('button', { class: 'btn-sm', onClick: () => openList(list.id) }, isOpen ? 'Hide' : 'Open'),
        h(
          'button',
          {
            class: 'btn-sm btn-danger',
            onClick: async () => {
              const force = list.kind === 'seed';
              if (!confirm(`Delete "${list.name}"? Its films stay cached but the list goes.`)) return;
              try {
                await api.deleteList(list.id, force);
                if (state.openListId === list.id) state.openListId = null;
                await refresh();
                paint();
              } catch (error) {
                toast(error.message, 'error');
              }
            },
          },
          'Delete',
        ),
      ),
      isOpen ? entriesPanel(list) : null,
    );
  }

  function entriesPanel(list) {
    return h(
      'div',
      { class: 'card stack', style: 'margin-left:16px' },
      h(
        'div',
        { class: 'row' },
        h('h3', {}, list.name),
        list.source_url
          ? h(
              'a',
              {
                href: list.source_url,
                target: '_blank',
                rel: 'noopener noreferrer',
                class: 'faint',
                title: list.source ?? undefined,
              },
              'Source ↗',
            )
          : null,
        h('span', { class: 'spacer' }),
        h(
          'label',
          { class: 'check' },
          h('input', {
            type: 'checkbox',
            checked: state.reviewOnly,
            onChange: async (event) => {
              state.reviewOnly = event.target.checked;
              await loadEntries(list.id);
              paint();
            },
          }),
          h('span', { class: 'faint' }, 'only show titles needing review'),
        ),
      ),
      state.entries.length === 0
        ? h(
            'p',
            { class: 'muted' },
            state.reviewOnly ? 'Nothing needs review on this list.' : 'This list is empty.',
          )
        : h('div', { class: 'stack', style: 'gap:8px' }, state.entries.map((entry) => entryRow(entry, list))),
    );
  }

  function newListForm() {
    let name = '';
    const submit = async () => {
      if (!name.trim()) return;
      try {
        await api.createList(name.trim());
        name = '';
        await refresh();
        paint();
      } catch (error) {
        toast(error.message, 'error');
      }
    };

    return h(
      'div',
      { class: 'row' },
      h('input', {
        type: 'text',
        placeholder: 'New list name',
        style: 'max-width:280px',
        onInput: (event) => {
          name = event.target.value;
        },
        onKeydown: (event) => {
          if (event.key === 'Enter') submit();
        },
      }),
      h('button', { onClick: submit }, 'Create list'),
    );
  }

  function paint() {
    clear(container).append(
      h(
        'div',
        { class: 'stack' },
        h('h2', {}, 'Lists'),
        state.lists.length === 0
          ? h(
              'div',
              { class: 'empty' },
              'No lists yet. Run ',
              h('code', {}, 'npm run seed'),
              ' to load the built-in lists, or create one below.',
            )
          : h('div', { class: 'stack', style: 'gap:8px' }, state.lists.map(listRow)),
        // Positioned right before Import, since creating a list and then
        // importing into it is the natural next step.
        newListForm(),
        importPanel(),
      ),
    );
  }

  await refresh();
  paint();

  return stopJob;
}
