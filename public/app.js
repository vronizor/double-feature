import { api } from './api.js';
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

// Cosmetic, so it is deliberately fire-and-forget and never blocks the first
// paint: if /api/config is slow or fails, the footer keeps the credit line and
// simply shows no version. Patch is dropped from the display — 4.1.0 reads
// "v4.1", because the minor is the part that carries meaning here.
api
  .config()
  .then(({ version }) => {
    if (!version) return;
    const node = document.getElementById('app-version');
    if (node) node.textContent = `v${String(version).split('.').slice(0, 2).join('.')}`;
  })
  .catch(() => {});
