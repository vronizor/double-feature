import { h, clear } from './dom.js';
import { renderDraw } from './views/draw.js';
import { renderExplore } from './views/explore.js';
import { renderLists } from './views/lists.js';
import { renderHistory } from './views/history.js';
import { renderVote } from './views/vote.js';

const root = document.getElementById('app');

const TABS = [
  { id: 'draw', label: 'Lineup', render: renderDraw },
  { id: 'explore', label: 'Explore', render: renderExplore },
  { id: 'lists', label: 'Lists', render: renderLists },
  { id: 'history', label: 'History', render: renderHistory },
];

// Views that poll return a teardown function; call it before swapping views so
// a hidden tab never keeps hitting the server.
let teardown = null;

function currentTab() {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

async function renderHost() {
  const tab = currentTab();
  const body = h('div');

  clear(root).append(
    h(
      'header',
      { class: 'masthead' },
      h('h1', {}, 'Double ', h('span', {}, 'Feature')),
      h(
        'nav',
        { class: 'tabs' },
        TABS.map((entry) =>
          h(
            'button',
            {
              class: 'tab',
              'aria-current': String(entry.id === tab.id),
              onClick: () => {
                location.hash = `#${entry.id}`;
              },
            },
            entry.label,
          ),
        ),
      ),
    ),
    body,
  );

  teardown = (await tab.render(body)) ?? null;
}

async function route() {
  teardown?.();
  teardown = null;

  const voteMatch = /^\/vote\/([^/]+)$/.exec(location.pathname);
  if (voteMatch) {
    clear(root);
    teardown = (await renderVote(root, voteMatch[1])) ?? null;
    return;
  }

  await renderHost();
}

window.addEventListener('hashchange', route);
route().catch((error) => {
  clear(root).append(h('div', { class: 'empty error' }, error.message));
});
