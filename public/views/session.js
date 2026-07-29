import { h, clear, posterUrl, copyText, toast, formatDate, plural } from '../dom.js';
import { api } from '../api.js';

// A few seconds of lag is a non-issue at this scale, and polling is far less to
// build and run on a Pi than WebSockets would be.
const POLL_MS = 3500;

/**
 * The host's view of one vote session: QR code, link, live tally, close button,
 * and the results once it's closed. Reused read-only by the history tab.
 */
export function renderSessionPanel(container, slug, { host = false, onClosed = null } = {}) {
  let timer = null;
  let stopped = false;

  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };

  async function tick() {
    if (stopped) return;
    try {
      const session = await api.session(slug, host);
      if (stopped) return;

      if (session.status === 'closed') {
        clearInterval(timer);
        const results = await api.results(slug);
        if (!stopped) {
          // Only the caller that owns the lineup passes this, and only for the
          // session it just published. The History tab renders closed sessions
          // through this same function and passes nothing — without that gate,
          // opening last week's result would wipe the lineup being built now.
          onClosed?.();
          renderResults(container, results);
        }
        return;
      }
      renderOpen(session);
    } catch (error) {
      if (!stopped) clear(container).append(h('div', { class: 'empty error' }, error.message));
      clearInterval(timer);
    }
  }

  function renderOpen(session) {
    const url = `${location.origin}/vote/${slug}`;

    clear(container).append(
      h(
        'div',
        { class: 'stack' },
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'publish' },
            h('div', { class: 'qr' }, h('img', { src: `/api/sessions/${slug}/qr.svg`, alt: `QR code linking to ${url}` })),
            h(
              'div',
              { class: 'stack' },
              h('h2', {}, 'Voting is open'),
              h('p', { class: 'muted' }, 'Scan the code, or type this in:'),
              // Plain selectable text, deliberately not inside a link or button
              // so long-press-to-select works on a guest's phone.
              h('div', { class: 'vote-url' }, url),
              h(
                'div',
                { class: 'row' },
                h(
                  'button',
                  {
                    class: 'btn-sm',
                    onClick: async () => {
                      const ok = await copyText(url);
                      toast(ok ? 'Link copied' : 'Copy failed — long-press the link to select it', ok ? 'ok' : 'error');
                    },
                  },
                  '⧉ Copy link',
                ),
                // A direct one-click way for the host to open (or vote on)
                // their own session, rather than copy/pasting or scanning
                // the QR code meant for guests.
                h('a', { href: `/vote/${slug}`, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn-sm' }, 'Open ↗'),
                session.anonymous ? h('span', { class: 'badge badge-warn' }, 'anonymous') : null,
                session.filter_summary ? h('span', { class: 'badge' }, session.filter_summary) : null,
              ),
            ),
          ),
        ),

        h(
          'div',
          { class: 'card stack' },
          h(
            'div',
            { class: 'row' },
            h('h2', {}, `${plural(session.ballot_count, 'ballot')} in`),
            h('span', { class: 'spacer' }),
            host
              ? h(
                  'button',
                  {
                    class: 'btn-danger btn-sm',
                    onClick: async () => {
                      if (
                        !confirm(
                          'Cancel this vote entirely? Unlike "Close voting", this throws the draw away — ' +
                            'any ballots already submitted are discarded, and it won’t appear in history. ' +
                            'This can’t be undone.',
                        )
                      ) {
                        return;
                      }
                      try {
                        await api.cancelSession(slug);
                        stop();
                        clear(container).append(
                          h('div', { class: 'empty' }, 'Voting cancelled — this draw was thrown away.'),
                        );
                      } catch (error) {
                        toast(error.message, 'error');
                      }
                    },
                  },
                  'Cancel',
                )
              : null,
            host
              ? h(
                  'button',
                  {
                    class: 'btn-primary',
                    onClick: async () => {
                      if (!confirm('Close voting? This computes the final result and is permanent for this draw.')) {
                        return;
                      }
                      try {
                        const results = await api.closeSession(slug);
                        stop();
                        // Closing by hand skips the poll path above, so the
                        // hook has to fire here too.
                        onClosed?.();
                        renderResults(container, results);
                      } catch (error) {
                        toast(error.message, 'error');
                      }
                    },
                  },
                  'Close voting',
                )
              : null,
          ),
          session.anonymous
            ? h(
                'p',
                { class: 'muted' },
                'Anonymous voting is on, so the running tally stays hidden until you close. ',
                h('span', { class: 'faint' }, 'Totals appear in the results.'),
              )
            : tallyList(session),
          h('div', { class: 'faint' }, `Updates every ${POLL_MS / 1000}s.`),
        ),

        h('div', { class: 'movie-grid' }, session.movies.map((movie) => compactCard(movie))),
      ),
    );
  }

  function tallyList(session) {
    if (!session.tally || session.ballot_count === 0) {
      return h('p', { class: 'muted' }, 'No ballots yet.');
    }

    const max = Math.max(1, ...session.tally.standings.map((row) => row.points));
    const titleOf = (tmdbId) =>
      session.movies.find((movie) => movie.tmdb_id === tmdbId)?.title ?? String(tmdbId);

    return h(
      'div',
      {},
      h(
        'div',
        {},
        session.tally.standings.map((row) =>
          h(
            'div',
            { class: 'tally-row' },
            h(
              'div',
              {},
              h('div', {}, titleOf(row.tmdb_id)),
              h('div', { class: 'tally-bar', style: `width:${(row.points / max) * 100}%` }),
            ),
            h('div', { class: 'tally-points' }, `${row.points} pts`),
          ),
        ),
      ),
      session.voters?.length
        ? h('p', { class: 'faint' }, `Voted: ${session.voters.join(', ')}`)
        : null,
    );
  }

  tick();
  timer = setInterval(tick, POLL_MS);
  return stop;
}

function compactCard(movie) {
  const poster = posterUrl(movie.poster_path, 'w185');
  return h(
    'article',
    { class: 'movie' },
    poster
      ? h('img', { class: 'movie-poster', src: poster, alt: '', loading: 'lazy' })
      : h('div', { class: 'movie-poster movie-poster--empty' }, movie.title),
    h(
      'div',
      { class: 'movie-body' },
      h('div', { class: 'movie-title' }, movie.title),
      h('div', { class: 'movie-meta' }, [movie.year, movie.director].filter(Boolean).join(' · ')),
    ),
  );
}

/** Shared by the host screen, the guest screen and the history tab. */
export function renderResults(container, results) {
  const movieById = new Map(results.movies.map((movie) => [movie.tmdb_id, movie]));
  const winner = movieById.get(results.winner_tmdb_id);
  const titleOf = (tmdbId) => movieById.get(tmdbId)?.title ?? String(tmdbId);

  clear(container).append(
    h(
      'div',
      { class: 'stack' },
      winner
        ? h(
            'div',
            { class: 'winner' },
            posterUrl(winner.poster_path, 'w185')
              ? h('img', { src: posterUrl(winner.poster_path, 'w185'), alt: '' })
              : null,
            h(
              'div',
              {},
              h('div', { class: 'winner-label' }, 'Winner'),
              h('h2', {}, winner.title),
              h(
                'div',
                { class: 'muted' },
                [winner.year, winner.director, winner.runtime ? `${winner.runtime} min` : null]
                  .filter(Boolean)
                  .join(' · '),
              ),
              // Closes the loop: the app picks a film and otherwise never
              // learns whether it was watched, so the watched-exclusion filter
              // accumulates nothing on its own. One tap here is the only
              // moment the answer is actually known.
              h(
                'button',
                {
                  class: 'btn-sm',
                  style: 'margin-top:8px',
                  onClick: async (event) => {
                    const button = event.currentTarget;
                    const next = !winner.watched;
                    try {
                      await api.setWatched(winner.tmdb_id, next);
                      winner.watched = next;
                      button.textContent = next ? '✓ Watched' : 'Mark as watched';
                      toast(
                        next
                          ? `${winner.title} marked watched — it won't come up in future draws`
                          : `${winner.title} is back in the pool`,
                        'ok',
                      );
                    } catch (error) {
                      toast(error.message, 'error');
                    }
                  },
                },
                winner.watched ? '✓ Watched' : 'Mark as watched',
              ),
            ),
          )
        : h('div', { class: 'empty' }, 'No ballots were submitted, so there is no winner.'),

      results.tiebreak_note ? h('div', { class: 'coin-flip' }, results.tiebreak_note) : null,

      h(
        'div',
        { class: 'card stack' },
        h(
          'div',
          { class: 'row' },
          h('h3', {}, 'Points'),
          h('span', { class: 'spacer' }),
          h('span', { class: 'faint' }, plural(results.ballot_count, 'ballot')),
        ),
        h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, 'Film'),
                h('th', { class: 'num' }, 'Points'),
                h('th', { class: 'num' }, '1st-place votes'),
              ),
            ),
            h(
              'tbody',
              {},
              results.standings.map((row) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    {},
                    titleOf(row.tmdb_id),
                    row.tmdb_id === results.winner_tmdb_id ? ' 🏆' : '',
                  ),
                  h('td', { class: 'num' }, String(row.points)),
                  h('td', { class: 'num' }, String(row.first_place_votes)),
                ),
              ),
            ),
          ),
        ),
      ),

      results.anonymous
        ? h(
            'div',
            { class: 'card' },
            h('h3', {}, 'Ballots'),
            h(
              'p',
              { class: 'muted' },
              'This was an anonymous vote, so individual ballots were never recorded — ' +
                'not even for the host. Only the totals above exist.',
            ),
          )
        : ballotsTable(results, titleOf),

      h(
        'div',
        { class: 'faint' },
        [
          results.filter_summary,
          results.created_at ? `drawn ${formatDate(results.created_at)}` : null,
          results.closed_at ? `closed ${formatDate(results.closed_at)}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ),
    ),
  );
}

function ballotsTable(results, titleOf) {
  if (!results.ballots?.length) {
    return h('div', { class: 'card' }, h('h3', {}, 'Ballots'), h('p', { class: 'muted' }, 'No ballots.'));
  }

  return h(
    'div',
    { class: 'card stack' },
    h('h3', {}, 'Ballots'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Voter'), h('th', {}, 'Ranking'))),
        h(
          'tbody',
          {},
          results.ballots.map((ballot) =>
            h(
              'tr',
              {},
              h('td', {}, ballot.voter_name),
              h(
                'td',
                {},
                ballot.ranks
                  .slice()
                  .sort((a, b) => a.rank - b.rank)
                  .map((rank) => `${rank.rank}. ${titleOf(rank.tmdb_id)}`)
                  .join('   ·   '),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
