import { h, clear, posterUrl, toast, plural, ratingLine, metaLine, keepNameTogether, openMovieModal, originalTitleLine } from '../dom.js';
import { api } from '../api.js';
import { toggleRank, rankOf, toBallot } from '../ranking.js';
import { renderResults } from './session.js';

const POLL_MS = 3500;
const NAME_KEY = 'double-feature:name';
const NAME_INPUT_ID = 'vote-name';

// See the same constant in session.js. It matters more here: this poll only
// watches for the host closing voting, so a failed one costs the guest nothing,
// while tearing the screen down costs them the ranking they were part-way
// through building.
const MAX_POLL_FAILURES = 4;

export async function renderVote(container, slug) {
  const state = {
    session: null,
    ranked: [],
    name: localStorage.getItem(NAME_KEY) ?? '',
    submitted: false,
    busy: false,
  };

  let timer = null;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };

  let consecutiveFailures = 0;

  /**
   * The one piece of chrome every screen in this file shares: a masthead that
   * is also the way home. Every terminal state used to build its own bare
   * `<div>` straight into `container`, so a guest who reached results, a 404,
   * or "lost contact" had no path back to the app except the browser's own
   * back button — there is no persistent shell around this standalone page
   * the way there is for the host inside the SPA.
   */
  function shell(...body) {
    return h(
      'div',
      { class: 'vote-shell stack' },
      h(
        'header',
        { class: 'masthead' },
        h(
          'a',
          { href: '/', class: 'masthead-brand' },
          h('h1', {}, 'Double ', h('span', {}, 'Feature')),
        ),
      ),
      ...body,
    );
  }

  /**
   * A slug that resolves to nothing — a typo, or a vote the host cancelled.
   * Cancelling deletes the row outright (see `DELETE /api/sessions/:slug`), so
   * this is not rare: it is the ordinary shape of "that link doesn't work
   * anymore," and it deserves a page that says so, not a spinner that times out.
   */
  function renderGone() {
    clear(container).append(
      shell(
        h(
          'div',
          { class: 'card stack' },
          h('h2', {}, 'This vote isn’t here'),
          h(
            'p',
            { class: 'muted' },
            'The link may be old, or the host cancelled this vote before it closed.',
          ),
          h(
            'div',
            { class: 'row' },
            h('a', { class: 'btn btn-primary', href: '/' }, 'Start a new lineup'),
            h('a', { class: 'btn', href: '/#history' }, 'See past votes'),
          ),
        ),
      ),
    );
  }

  function renderLostContact(error) {
    clear(container).append(
      shell(
        h(
          'div',
          { class: 'empty error' },
          `Lost contact with the server — ${error.message}. Reload to try again.`,
        ),
      ),
    );
  }

  async function poll() {
    if (stopped) return;
    try {
      const session = await api.session(slug);
      if (stopped) return;
      consecutiveFailures = 0;
      state.session = session;

      // The host closed voting — flip straight to the results.
      if (session.status === 'closed') {
        clearInterval(timer);
        const results = await api.results(slug);
        if (!stopped) {
          const body = h('div');
          clear(container).append(shell(body));
          renderResults(body, results);
        }
        return;
      }
      paint();
    } catch (error) {
      if (stopped) return;

      // A 404 means the slug is wrong or the vote is gone — permanent either
      // way, so there is nothing to gain by retrying it. Treating it as a
      // dropped request cost a guest ~14 seconds of silence before telling
      // them, wrongly, that the SERVER was unreachable.
      if (error.status === 404) {
        clearInterval(timer);
        renderGone();
        return;
      }

      consecutiveFailures += 1;
      // Never throw away a ballot in progress over one dropped request. The
      // guest's ranking lives in `state.ranked` and is still submittable; only
      // the "has the host closed voting yet" check is stale.
      if (consecutiveFailures < MAX_POLL_FAILURES) return;
      clearInterval(timer);
      renderLostContact(error);
    }
  }

  function movieCard(movie) {
    const rank = rankOf(state.ranked, movie.tmdb_id);
    const poster = posterUrl(movie.poster_path);

    return h(
      'article',
      {
        class: `movie movie--tappable${rank ? ' movie--ranked' : ''}`,
        role: 'button',
        tabindex: '0',
        'aria-pressed': String(Boolean(rank)),
        'aria-label': `${movie.title}${rank ? `, ranked ${rank}` : ', not ranked'}`,
        onClick: () => {
          if (state.submitted) return;
          // Tapping a ranked film removes it; the remaining ranks close the gap
          // automatically, because rank is just position in this array.
          state.ranked = toggleRank(state.ranked, movie.tmdb_id);
          paint();
        },
        onKeydown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.currentTarget.click();
          }
        },
      },
      rank ? h('span', { class: 'rank-badge' }, String(rank)) : null,
      poster
        ? h('img', { class: 'movie-poster', src: poster, alt: '', loading: 'lazy' })
        : h('div', { class: 'movie-poster movie-poster--empty' }, movie.title),
      h(
        'div',
        { class: 'movie-body' },
        h('div', { class: 'movie-title' }, movie.title),
        originalTitleLine(movie),
        h(
          'div',
          { class: 'movie-meta' },
          // The vote screen used to show TMDB's score and nothing else, so
          // guests ranking films saw a different number from the host who drew
          // them. Sharing the helper settles that as a side effect.
          ...metaLine(movie.year, keepNameTogether(movie.director), ratingLine(movie)),
        ),
        h(
          'div',
          { class: 'movie-meta faint' },
          ...metaLine(movie.runtime ? `${movie.runtime} min` : null, movie.genres),
        ),
        movie.overview ? h('p', { class: 'movie-overview' }, movie.overview) : null,
        movie.overview
          ? h(
              'button',
              {
                class: 'expand-link',
                // The card itself is tap-to-rank, so this button must stop the
                // click (and its Enter/Space keyboard equivalent) from bubbling
                // up and also toggling the rank.
                onClick: (event) => {
                  event.stopPropagation();
                  openMovieModal(movie);
                },
                onKeydown: (event) => event.stopPropagation(),
              },
              'Read more',
            )
          : null,
      ),
    );
  }

  async function submit() {
    if (state.ranked.length === 0) {
      toast('Tap the films in your order of preference first', 'error');
      return;
    }
    const name = state.name.trim();
    if (!state.session.anonymous && !name) {
      toast('Enter your name so the host knows who voted', 'error');
      return;
    }

    state.busy = true;
    paint();
    try {
      await api.submitBallot(slug, name, toBallot(state.ranked));
      if (!state.session.anonymous) localStorage.setItem(NAME_KEY, name);
      state.submitted = true;
      toast('Ballot submitted', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      state.busy = false;
      paint();
    }
  }

  function paint() {
    const { session } = state;
    if (!session) return;

    const total = session.movies.length;
    const titleOf = (id) => session.movies.find((m) => m.tmdb_id === id)?.title ?? id;

    // This repaints every poll cycle (~3.5s) even while a guest is mid-name,
    // and a full clear+rebuild would otherwise silently knock the name input
    // out of focus — anything typed after that lands nowhere until they
    // notice and click back in. Save and restore focus/cursor across it.
    const active = document.activeElement;
    const focusedName =
      active?.id === NAME_INPUT_ID
        ? { selectionStart: active.selectionStart, selectionEnd: active.selectionEnd }
        : null;

    // The PAGE's scroll position, for the same reason and it was the half that
    // was missing. Emptying the container collapses the document to nothing for
    // an instant, the browser clamps the scroll to fit, and refilling it cannot
    // undo that — so a guest who tapped the name field was thrown to the top of
    // the ballot by the next 3.5s poll, mid-typing. Reported from a phone.
    const scrollY = window.scrollY;

    clear(container).append(
      shell(
        state.submitted
          ? h(
              'div',
              { class: 'card stack' },
              h('h2', {}, 'Your ballot is in'),
              h(
                'ol',
                { class: 'muted' },
                state.ranked.map((id) => h('li', {}, titleOf(id))),
              ),
              h('p', { class: 'faint' }, 'Waiting for the host to close voting — results will appear here automatically.'),
            )
          : h(
              'div',
              { class: 'stack' },
              h('h2', {}, 'Rank tonight’s options'),
              h(
                'p',
                { class: 'muted' },
                `Tap in your order of preference — first tap is your #1. Tap a ranked film again to remove it. ${
                  session.anonymous ? 'This vote is anonymous.' : ''
                }`,
              ),
            ),

        h('div', { class: 'movie-grid is-vote' }, session.movies.map(movieCard)),

        state.submitted
          ? null
          : h(
              'div',
              { class: 'vote-sticky stack' },
              h(
                'div',
                { class: 'row' },
                h('span', { class: 'muted' }, `${state.ranked.length} of ${total} ranked`),
                h('span', { class: 'spacer' }),
                state.ranked.length
                  ? h(
                      'button',
                      {
                        class: 'btn-sm',
                        onClick: () => {
                          state.ranked = [];
                          paint();
                        },
                      },
                      'Reset',
                    )
                  : null,
              ),
              session.anonymous
                ? null
                : h('input', {
                    type: 'text',
                    id: NAME_INPUT_ID,
                    placeholder: 'Your name',
                    value: state.name,
                    maxlength: '60',
                    onInput: (event) => {
                      state.name = event.target.value;
                    },
                  }),
              // A guest with nothing ranked used to get a live, full-width
              // primary button reading "Submit 0 picks", and learned it was
              // invalid only from a toast fired AFTER the tap. The validation
              // already existed; it just ran too late to prevent the mistake.
              // The button now says what to do instead of what it will do.
              h(
                'button',
                {
                  class: 'btn-primary',
                  disabled: state.busy || state.ranked.length === 0,
                  onClick: submit,
                },
                state.ranked.length === 0
                  ? 'Rank a film first'
                  : `Submit ${plural(state.ranked.length, 'pick')}`,
              ),
            ),
      ),
    );

    if (focusedName) {
      if (scrollY) window.scrollTo(0, scrollY);
      const input = container.querySelector(`#${NAME_INPUT_ID}`);
      input?.focus();
      input?.setSelectionRange(focusedName.selectionStart, focusedName.selectionEnd);
    }
  }

  await poll();
  timer = setInterval(poll, POLL_MS);
  return stop;
}
