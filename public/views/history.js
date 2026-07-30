import { h, clear, posterUrl, formatDate, plural } from '../dom.js';
import { api } from '../api.js';
import { renderResults, renderSessionPanel } from './session.js';

/**
 * Every published draw, newest first. Unpublished draws are ephemeral by design
 * and were never written down, so they can't appear here.
 */
export async function renderHistory(container) {
  let panelTeardown = null;
  const stopPanel = () => {
    panelTeardown?.();
    panelTeardown = null;
  };

  async function showList() {
    stopPanel();
    clear(container).append(h('div', { class: 'loading' }, 'Loading…'));

    const { sessions } = await api.history();
    if (sessions.length === 0) {
      clear(container).append(
        h('div', { class: 'empty' }, 'No votes yet. Publish one from the Lineup tab and it will show up here.'),
      );
      return;
    }

    clear(container).append(
      h(
        'div',
        { class: 'stack' },
        h('h2', {}, plural(sessions.length, 'past vote')),
        h(
          'div',
          { class: 'stack', style: 'gap:8px' },
          sessions.map((session) =>
            h(
              'button',
              { class: 'history-row', onClick: () => showSession(session) },
              h(
                'span',
                { class: 'history-posters' },
                session.movies
                  .slice(0, 5)
                  .map((movie) =>
                    posterUrl(movie.poster_path, 'w92')
                      ? h('img', { src: posterUrl(movie.poster_path, 'w92'), alt: '', loading: 'lazy' })
                      : null,
                  ),
              ),
              h(
                'span',
                {},
                h(
                  'span',
                  { class: 'row', style: 'gap:8px' },
                  h(
                    'strong',
                    {},
                    session.winner_title
                      ? `${session.winner_title}${session.winner_year ? ` (${session.winner_year})` : ''}`
                      : session.status === 'open'
                        ? 'Voting open'
                        : 'No winner',
                  ),
                  session.status === 'open' ? h('span', { class: 'badge badge-warn' }, 'open') : null,
                  session.anonymous ? h('span', { class: 'badge' }, 'anonymous') : null,
                ),
                h(
                  'span',
                  { class: 'faint', style: 'display:block' },
                  [
                    formatDate(session.created_at),
                    plural(session.movie_count, 'film'),
                    plural(session.ballot_count, 'vote'),
                    session.filter_summary,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              h('span', { class: 'faint' }, '›'),
            ),
          ),
        ),
      ),
    );
  }

  async function showSession(session) {
    stopPanel();
    const body = h('div');
    clear(container).append(
      h(
        'div',
        { class: 'row', style: 'margin-bottom:16px' },
        h('button', { class: 'btn-sm', onClick: () => showList() }, '← All votes'),
      ),
      body,
    );

    if (session.status === 'open') {
      // Still live: give the host the full panel, close button and all.
      panelTeardown = renderSessionPanel(body, session.slug, { host: true });
      return;
    }

    body.append(h('div', { class: 'loading' }, 'Loading…'));
    const results = await api.results(session.slug);
    renderResults(body, results);
  }

  await showList();
  return stopPanel;
}
