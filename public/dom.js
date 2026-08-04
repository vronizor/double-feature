/** Tiny DOM helpers — no framework, no build step. */

// The only import this module has, and it stays that way: prefs.js imports
// nothing, so there is no cycle to create. `ratingLine` needs it because which
// score leads is a stored preference, not a property of the film.
import { prefs } from './prefs.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Empty a node and refill it, with `h`'s child rules.
 *
 * `clear(node).append(...)` reads like the same thing and is not: `append` is
 * the raw DOM method, which stringifies whatever it is given, so a `null` from
 * a conditional child renders the WORD "null" on the page. `h` has always
 * filtered those out, which is exactly why the difference is easy to miss —
 * the same expression is safe inside `h(...)` and not safe after `clear(...)`.
 *
 * Shipped once: a `null` sat under the search box in v7.3 wherever the id
 * offer was absent.
 */
export function fill(node, ...children) {
  clear(node);
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// setSelectionRange throws InvalidStateError on input types that have no text
// selection model — number is the one that matters here, since every filter
// range input is one.
const SELECTABLE = new Set(['text', 'search', 'url', 'tel', 'password']);

/**
 * Capture focus before a repaint, restore it after.
 *
 * A view that rebuilds its whole subtree destroys the element the host is
 * typing into, and the caret goes with it. Explore did this on every keystroke
 * in any of its five number inputs: one digit landed, the node was replaced,
 * and the rest went to `<body>`.
 *
 * Keyed on the element's id, so anything that wants to survive a repaint needs
 * a stable one — that is the whole contract. Returns a restore function to call
 * once the new DOM is in place.
 */
export function preserveFocus(root = document) {
  const active = document.activeElement;
  const id = active?.id;
  if (!id || !root.contains?.(active)) return () => {};

  const selection = SELECTABLE.has(active.type)
    ? { start: active.selectionStart, end: active.selectionEnd }
    : null;

  return () => {
    const next = root.querySelector(`#${CSS.escape(id)}`);
    if (!next) return;
    next.focus();
    if (selection) next.setSelectionRange(selection.start, selection.end);
  };
}

/**
 * Capture how far a scrollable panel is scrolled, restore it after a repaint.
 *
 * Sibling of `preserveFocus`, and needed for the same reason: a view that
 * rebuilds its subtree destroys the element the host was working in. The rail
 * has its own `overflow-y`, so its scroll position lives on the node — rebuild
 * it and the host is thrown back to the top of a list they had scrolled a long
 * way down. Reported for the "only award winners" checkbox, which is simply
 * the one that repaints; every full repaint did it.
 *
 * Keyed on a selector rather than a node, because the node itself is the thing
 * about to be replaced.
 */
export function preserveScroll(root, selector) {
  const before = root.querySelector(selector)?.scrollTop ?? 0;
  return () => {
    if (!before) return;
    const after = root.querySelector(selector);
    if (after) after.scrollTop = before;
  };
}

export const POSTER_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(path, size = 'w342') {
  return path ? `${POSTER_BASE}/${size}${path}` : null;
}

/**
 * Copy that works on a guest's phone.
 *
 * The app is served over plain HTTP on a LAN IP, which browsers do not treat as
 * a secure context, so `navigator.clipboard` is undefined on essentially every
 * phone that will scan the QR code. The execCommand path below is therefore the
 * normal one, not a rare fallback — and it needs the contentEditable dance to
 * work on iOS Safari, which ignores `select()` on a readonly textarea.
 */
export async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied or API missing — fall through to the legacy path.
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.contentEditable = 'true';
  textarea.readOnly = false;
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
  document.body.appendChild(textarea);

  let copied = false;
  try {
    const range = document.createRange();
    range.selectNodeContents(textarea);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    textarea.setSelectionRange(0, text.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

/**
 * One persistent live region, written into — NOT a `role="status"` on the
 * toast itself. A live region has to be in the document BEFORE its text
 * changes for screen readers to reliably announce it; a node that arrives
 * already carrying both the role and the text is announced by some and
 * silently ignored by others. So the region is created once, empty, and
 * every later message is a text change inside it.
 */
let liveRegion = null;

export function announce(message) {
  if (!message) return;
  if (!liveRegion) {
    liveRegion = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(liveRegion);
  }
  // Same text twice running is not a change, so it would not be announced.
  liveRegion.textContent = '';
  liveRegion.textContent = message;
}

export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast toast--${kind}` }, message);
  document.body.appendChild(el);
  announce(message);
  setTimeout(() => el.classList.add('is-leaving'), 2600);
  setTimeout(() => el.remove(), 3200);
}

/**
 * What a draw actually put on the table. Drawing was the one place the app
 * did its work in silence: the lineup grew somewhere below the fold and
 * nothing said so.
 *
 * Names the films rather than counting them — "Drew 2 films" is a fact the
 * host can already see, while the titles are the thing they clicked for. Two
 * is the default draw size, so the two-title form is the one that matters;
 * beyond three the list stops being readable at a glance and becomes a count.
 */
export function drawnMessage(movies) {
  const titles = (movies ?? []).map((movie) => movie?.title).filter(Boolean);
  if (titles.length === 0) return null;
  if (titles.length === 1) return `Drew ${titles[0]}`;
  if (titles.length <= 3) {
    return `Drew ${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
  }
  return `Drew ${titles[0]}, ${titles[1]} and ${titles.length - 2} more`;
}

export const formatDate = (value) => {
  if (!value) return '';
  // SQLite writes "YYYY-MM-DD HH:MM:SS" in UTC.
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// TMDB returns 0 for an unrated film, which is worth hiding rather than
// showing as a real (bad) score.
/**
 * Keeps a person's name on one line unless there is genuinely no room.
 *
 * The card's meta line is one string — "1954 · Akira Kurosawa · ★ 8.5" — and
 * the rating spans after it are `white-space: nowrap`, so the browser breaks
 * at the last space that fits and that space is usually the one inside the
 * name. "Akira" ends up on one line and "Kurosawa" on the next while the row
 * still has room.
 *
 * A non-breaking space rather than `white-space: nowrap` on purpose: nowrap
 * cannot break at all, so a very long name would be cropped by the card's
 * overflow:hidden. NBSP means "do not break here unless there is no
 * alternative", and `overflow-wrap: break-word` still rescues the rare name
 * wider than the card. Commas stay ordinary spaces, so a three-director credit
 * still wraps between names.
 */
export const keepNameTogether = (value) =>
  String(value ?? '')
    .split(', ')
    .map((name) => name.replace(/ /g, '\u00a0'))
    .join(', ');

export const formatRating = (voteAverage) =>
  typeof voteAverage === 'number' && voteAverage > 0 ? voteAverage.toFixed(1) : null;

/**
 * IMDb's score, shown only when enough people voted to mean something.
 *
 * The floor is the same argument that put a vote floor on the Modern Classics
 * query: below it, a rating measures a handful of strangers rather than an
 * audience, and two numbers side by side implies both are comparable. Absent
 * means "not enough votes", never "badly rated" — the same rule the streaming
 * link follows.
 *
 * Worth having beside TMDB's rather than instead of it: measured across this
 * library the two differ by 0.37 on average, and they disagree hardest on
 * blockbusters, where TMDB runs generous. Godzilla vs. Kong is TMDB 7.5 and
 * IMDb 6.3 across 269,000 votes.
 */
export const IMDB_VOTE_FLOOR = 1000;

export const formatImdb = (movie) =>
  typeof movie?.imdb_rating === 'number' &&
  movie.imdb_rating > 0 &&
  (movie.imdb_votes ?? 0) >= IMDB_VOTE_FLOOR
    ? movie.imdb_rating.toFixed(1)
    : null;

const RATING_SOURCES = {
  tmdb: { name: 'TMDB', read: (movie) => formatRating(movie.vote_average), show: (value) => `★ ${value}` },
  imdb: { name: 'IMDb', read: (movie) => formatImdb(movie), show: (value) => `IMDb ${value}` },
};

/**
 * The rating, as ONE number.
 *
 * Both scores used to sit on the same line — "★ 6.9 · IMDb 7.3" — which asks
 * the reader to arbitrate between two authorities before they can read a
 * film's score at all. Two numbers competing for the same glance means neither
 * gets it. So one leads and the other is on hover, and WHICH one leads is a
 * preference rather than a decision made here, because which source you trust
 * is a taste and not a fact.
 *
 * **The vote count is gone from the display entirely.** It hung off the IMDb
 * score alone, which made the two read as different kinds of number, and it
 * answered a question nobody asks while picking a film. The vote FLOOR still
 * does that job, silently, inside formatImdb — a score shown is a score with
 * an audience behind it, and that is the whole point of the floor.
 *
 * Falls back to whichever score exists: preferring IMDb on a film that has no
 * IMDb score should show TMDB's, not nothing. So the preference orders the two
 * rather than selecting one.
 */
export function chooseRating(movie, preferred = 'tmdb') {
  const first = preferred === 'imdb' ? 'imdb' : 'tmdb';
  const second = first === 'imdb' ? 'tmdb' : 'imdb';

  // The preference ORDERS the two rather than selecting one, so a film with no
  // IMDb score still shows TMDB's when IMDb leads.
  const [lead, other] =
    RATING_SOURCES[first].read(movie) !== null ? [first, second] : [second, first];

  const shown = RATING_SOURCES[lead].read(movie);
  if (shown === null) return null;
  const hidden = RATING_SOURCES[other].read(movie);

  return {
    text: RATING_SOURCES[lead].show(shown),
    // Null rather than an empty string when there is no second opinion: an
    // empty tooltip is worse than none, and absent still means "not enough
    // votes", never "badly rated".
    title: hidden === null ? null : `${RATING_SOURCES[other].name} ${hidden}`,
  };
}

/** The node. `chooseRating` holds the decision, so it can be tested without a DOM. */
export function ratingLine(movie) {
  const chosen = chooseRating(movie, prefs.primaryRating);
  if (!chosen) return null;
  // No separator in the text. The meta line draws its own, bound to the item
  // that follows it — see metaLine.
  return h('span', { class: 'movie-rating', title: chosen.title }, chosen.text);
}

/**
 * The year · director · rating line, as items rather than one string.
 *
 * It used to be a joined string with a nowrap rating span glued on, and a long
 * director's name broke it two ways. `keepNameTogether` makes a name
 * unbreakable, so the whole name moved to the next line and left the separator
 * stranded — "1994 ·" with nothing after it. Worse, the rating span's own text
 * began with " · " and carried `white-space: nowrap`, so the line could not
 * break before it either: with `Estibaliz Urresola Solaguren` the rating was
 * pushed past the card's edge and clipped, leaving a bare star and no number.
 *
 * Both are properties of packing a wrapping line into one string. As separate
 * items in a wrapping flex row the rating can move to its own line instead of
 * overflowing, and the separator is drawn by CSS on the item that FOLLOWS it,
 * so it travels with that item and can only ever appear at the start of a
 * line, never dangling at the end of one.
 */
/**
 * Whether a resolved entry's source text disagrees with the film it matched.
 *
 * The reconciliation screen shows only the ANSWER — the film a row points at —
 * which is exactly why a wrong match is invisible: "Marco" resolving to the
 * wrong "Marco" looks like an ordinary row. Showing the raw text on every row
 * would be noise, since most match exactly, so it appears where the two
 * disagree, which is where the mistakes are.
 *
 * Either side can disagree. A different title is the obvious case; a matching
 * title with a different year is *Psycho* (1960) against *Psycho* (1998), which
 * is the case most likely to be wrong and least likely to look it.
 *
 * `original_title` counts as agreement: a list writing "Shichinin no samurai"
 * against TMDB's "Seven Samurai" is the same film under its own name, not a
 * mismatch worth a host's attention.
 */
export function matchDiffers(entry) {
  if (!entry?.raw_title) return false;
  const titleAgrees =
    entry.raw_title === entry.title || entry.raw_title === entry.original_title;
  const yearAgrees = !entry.raw_year || !entry.year || entry.raw_year === entry.year;
  return !titleAgrees || !yearAgrees;
}

/**
 * How to say what a Top-N cut did.
 *
 * One control, one meaning — "the top N of each ranked group" — but the group
 * is whatever a list ranks within, and that is not the same thing on every
 * list. Top-N=10 is ten films from TSPDT and about eight hundred from
 * Box-office France, because the first ranks end to end and the second ranks
 * within each year. The number alone therefore cannot tell you how big the
 * pool became, and that is the honest complaint against it.
 *
 * So the label carries the group rather than a second control carrying the
 * choice. `ranked` is how many selected lists have ranks at all, `perYear` how
 * many of those rank within a year.
 *
 * Kept beside `describePoolSetup`'s copy in server/pool.js, which writes the
 * same phrase onto a finished session. The two must agree; there is no shared
 * module between the browser and the server to put it in.
 */
export function topNLabel(topN, { ranked, perYear }) {
  if (!topN || topN <= 0) return null;
  // No ranked list selected: the cut does nothing at all, and saying "top 5"
  // would describe a narrowing that did not happen.
  if (ranked === 0) return `top ${topN} (no ranked lists)`;
  if (perYear === 0) return `top ${topN}`;
  if (perYear === ranked) return `top ${topN} per year`;
  return `top ${topN}, per year on some lists`;
}

/**
 * Removes the separator from any meta item that STARTS a wrapped line.
 *
 * Third attempt at this, and the first two each moved the orphan rather than
 * removing it: v4 drew the separator after each item and left `1994 ·`
 * dangling at the end of a line; v5 moved it to a `::before` on the following
 * item, which travels with that item and so lands at the START of the next
 * line instead — `· ★ 6.0`.
 *
 * **CSS cannot express the rule.** There is no selector for "is the first thing
 * on its line": that is a fact about layout, not about the tree, and it changes
 * with the width of the card. So it has to be measured after the browser has
 * laid the row out, which is what this does.
 *
 * ALL reads happen before ANY writes. Interleaving them makes each write
 * invalidate layout and each following read recompute it, which on a hundred-
 * card grid is a hundred forced reflows instead of one.
 */
export function sweepMetaSeparators(root = document) {
  const pending = [];

  // Read pass. Nothing here mutates the DOM.
  for (const row of root.querySelectorAll('.movie-meta')) {
    const items = [...row.children];
    if (items.length < 2) continue;
    let lineTop = null;
    for (const item of items) {
      const top = item.offsetTop;
      const startsLine = lineTop === null || top > lineTop;
      if (startsLine) lineTop = top;
      pending.push([item, startsLine]);
    }
  }

  // Write pass.
  for (const [item, startsLine] of pending) item.classList.toggle('starts-line', startsLine);
}

// Coalesced to one pass per frame: a repaint can replace a hundred cards, and
// each replacement would otherwise ask for its own sweep.
let sweepScheduled = false;
function scheduleMetaSweep() {
  if (sweepScheduled) return;
  sweepScheduled = true;
  requestAnimationFrame(() => {
    sweepScheduled = false;
    sweepMetaSeparators();
  });
}

/**
 * Self-installing, because the alternative is a call at the end of every view's
 * paint() and one of them eventually gets forgotten — which is exactly how a
 * defect this cosmetic survives three versions.
 *
 * `childList` only: the sweep writes CLASSES, which are attribute mutations, so
 * it cannot retrigger itself. The ResizeObserver covers the case the observer
 * cannot see at all — nothing in the DOM changed, the window merely got
 * narrower and the row rewrapped.
 */
if (typeof window !== 'undefined' && typeof ResizeObserver === 'function' && document.body) {
  new ResizeObserver(scheduleMetaSweep).observe(document.documentElement);
  new MutationObserver(scheduleMetaSweep).observe(document.body, { childList: true, subtree: true });
}

export function metaLine(...parts) {
  return parts
    .flat()
    .filter((part) => part !== null && part !== undefined && part !== '')
    .map((part) => (part instanceof Node ? part : h('span', {}, String(part))));
}

/**
 * Shorter names for the country chips, and only for the chips.
 *
 * "United States of America" is wider than the row it sits in. This is a
 * display map with a fall-through, NOT a translation of the data: the filter
 * still keys on the full name, movies.countries still stores it, and anything
 * missing from this map renders as itself.
 *
 * Deliberately not ISO codes for everything. A row reading FR · US · IT · GB ·
 * DE · JP · BE · ES · SE · CA · CH · MX is uniformly compact and uniformly
 * unreadable — "CH" and "SE" are guesses for most people, while "France" was
 * never the problem. Only the names that actually overflow get shortened, in
 * the form people say out loud rather than the form a standard prescribes.
 * The full name stays on hover.
 */
const COUNTRY_SHORT = {
  'United States of America': 'USA',
  'United Kingdom': 'UK',
  'Soviet Union': 'USSR',
  'United Arab Emirates': 'UAE',
  'South Korea': 'S. Korea',
  'Czech Republic': 'Czechia',
  'New Zealand': 'NZ',
};

export const countryLabel = (name) => COUNTRY_SHORT[name] ?? name;

// TV-sourced entries (e.g. Histoire(s) du cinéma, catalogued on TMDB as a TV
// series) are stored keyed by the negation of their real TMDB id — see the
// schema comment on `movies` — so building the right public URL needs both
// the media type and the absolute value of the id.
export const tmdbUrl = (tmdbId, mediaType = 'movie') =>
  `https://www.themoviedb.org/${mediaType === 'tv' ? 'tv' : 'movie'}/${Math.abs(tmdbId)}`;

/**
 * Where a film is streaming — a LINK, deliberately, not cached data.
 *
 * v3 originally specced a providers join table, a region setting in `.env` and
 * a refresh cycle cut from 150 days to ~14 to keep it current. None of that is
 * needed: this page is derivable from the id we already store, is the same
 * JustWatch-backed data TMDB's own API returns, and carries its own country
 * selector — so the guest picks their region instead of the host baking one in.
 *
 * What that avoids: the join table, the region config, and the fact that
 * provider data goes stale faster than anything else in the API. Storing none
 * of it means none of it can be wrong.
 *
 * What it costs: no "▸ MUBI" on the card. Measured FR flatrate coverage is ~30%
 * of this library and 0% pre-1930, so roughly seven in ten badges would have
 * been absent anyway — the card was never going to carry this well.
 */
export const watchUrl = (tmdbId, mediaType = 'movie') => `${tmdbUrl(tmdbId, mediaType)}/watch`;

/**
 * The counterpart to tmdbUrl: pulls a media type + id back out of a pasted
 * themoviedb.org/movie/… or /tv/… URL, or accepts a bare numeric id (assumed
 * to be a movie, the overwhelmingly common case). This is the escape hatch
 * for anything search can't find — e.g. a title actually catalogued on TMDB
 * as a TV series (Godard's Histoire(s) du cinéma, which really did air as an
 * 8-part French TV series), which `/search/movie` will never surface.
 */
export function parseTmdbInput(value) {
  const text = String(value).trim();
  const urlMatch = /\/(movie|tv)\/(\d+)/.exec(text);
  if (urlMatch) return { mediaType: urlMatch[1], tmdbId: Number(urlMatch[2]) };
  if (/^\d+$/.test(text)) return { mediaType: 'movie', tmdbId: Number(text) };
  return null;
}

// Full list names ("Oscar — Best International Feature") don't fit a card's
// meta line, so a list carries a compact form for the card and the poster
// badge. The modal shows the full name instead, where there's room for it.
//
// The short name is DATA now, on `lists.short_name`, travelling in the seed
// files. It used to be a hardcoded map here, which meant adding an award list
// required editing the frontend — and a list added without that edit silently
// fell back to string-mangling.
//
// The fallback still exists for lists that carry no short name (every custom
// list, and any seed list yet to be given one): strip a trailing qualifier.
// It is deliberately not clever — two lists that both shorten to "Oscar" is
// exactly the collision the explicit value exists to prevent, and Parasite
// would read "Oscar 2020 · Oscar 2020".
export const shortAwardName = (award) => {
  if (typeof award === 'object' && award?.short_name) return award.short_name;
  const name = typeof award === 'object' ? award?.name : award;
  return String(name ?? '').replace(/\s*\(.*\)$/, '').replace(/\s*—.*$/, '');
};

/**
 * Which year an award is NATURALLY called by, given the ceremony year we store.
 *
 * The database holds the ceremony year, which is a scraped fact and stays the
 * truth. This is only how it is SPOKEN. The two differ because academies hand
 * out prizes in the spring after the films they honour and then name the award
 * for the films: the 69th Academy Awards were held in March 1997 and are "the
 * 1996 Oscars". Festivals have no such gap — the Palme d'Or awarded at the
 * 2019 festival is the 2019 Palme — and French usage names the César for its
 * ceremony, so "César 2012" is the right label for a 2011 film.
 *
 * **Keyed on the short name, and unknown awards default to no shift.** A new
 * festival list added without touching this map labels by its ceremony year,
 * which is correct for festivals; a new academy award would need a line here.
 * That is the safer way round, since festivals are the common case.
 *
 * **Never derived from the film's release year**, which is the thing
 * DECISIONS.md rejects and for good reason: TMDB dates Nomadland 2021 while
 * every awards body honoured it as a 2020 film, and The Graduate is a 1967
 * film that BAFTA honoured in 1969 because it reached UK cinemas in 1968.
 * Ceremony year is a fact we scraped; release year is a different fact that
 * happens to be close most of the time.
 */
const AWARD_YEAR_RULES = {
  Oscar: { offset: -1 },
  'Oscar Intl.': { offset: -1 },
  // The 1st BAFTAs, held 1949, honoured 1947 releases — a two-year gap, so the
  // constant is wrong for exactly that ceremony. `from` suppresses the year
  // rather than printing a confident 1948, on the rule that an absent year
  // beats a wrong one.
  BAFTA: { offset: -1, from: 1950 },
  Goya: { offset: -1 },
};

/**
 * The year to print, or null when there isn't one that can be trusted.
 *
 * Pre-1935 Academy Awards covered spans rather than calendar years — the 1st
 * honoured 1927/28 — so the derived label there is one half of a span rather
 * than a clean year. That is left as-is deliberately: "Oscar 1928" is how the
 * first ceremony is usually cited, so it reads correctly even though the
 * period was longer.
 */
export const awardYearLabel = (award) => {
  if (!award?.year) return null;
  const rule = AWARD_YEAR_RULES[shortAwardName(award)];
  if (!rule) return award.year;
  if (rule.from && award.year < rule.from) return null;
  return award.year + rule.offset;
};

/** "Palme d’Or 2019", or just "Palme d’Or" when no year can be trusted. */
export const awardLabel = (award, { short = true } = {}) => {
  const name = short ? shortAwardName(award) : award.name;
  const year = awardYearLabel(award);
  return year ? `${name} ${year}` : name;
};

/**
 * The original-language title as a subtitle under the (possibly English)
 * display title — only when it actually differs, so an English-original film
 * doesn't show its own title twice.
 */
export const originalTitleLine = (movie) =>
  movie.original_title && movie.original_title !== movie.title
    ? h('div', { class: 'original-title' }, movie.original_title)
    : null;

/**
 * An embedded player when TMDB has a trailer catalogued; otherwise a YouTube
 * search link the host can click straight through — plenty of obscure or
 * older films genuinely have no trailer on TMDB, so the fallback is the
 * normal case for those, not a rare edge case.
 *
 * The embed uses youtube-nocookie.com (no autoplay), which is strictly less
 * tracking than the plain youtube.com link this replaced: it doesn't set
 * YouTube's tracking cookies until the guest actually presses play. Nothing
 * about it touches the Pi or the LAN — it's a resource the guest's own
 * browser fetches directly from YouTube, exactly as a normal link would.
 */
function trailerBlock(movie) {
  if (movie.trailer_key) {
    return h(
      'div',
      { class: 'stack', style: 'gap:4px' },
      h(
        'div',
        { class: 'modal-trailer' },
        h('iframe', {
          src: `https://www.youtube-nocookie.com/embed/${movie.trailer_key}`,
          title: `${movie.title} trailer`,
          allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture',
          allowfullscreen: true,
          loading: 'lazy',
        }),
      ),
      h(
        'a',
        {
          href: `https://www.youtube.com/watch?v=${movie.trailer_key}`,
          target: '_blank',
          rel: 'noopener noreferrer',
          class: 'faint',
        },
        'Open on YouTube ↗',
      ),
    );
  }
  const query = `${movie.title} ${movie.year ?? ''} trailer`.trim();
  return h(
    'a',
    {
      href: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    '🔍 Search for trailer',
  );
}

/**
 * One overlay, for anything that has to interrupt.
 *
 * Extracted from `openMovieModal`, which had grown the only implementation of
 * this in the app — and an incomplete one. It closed on Escape and on a
 * backdrop click, and stopped there: it announced `aria-modal="true"` while
 * never taking focus, so Tab from an open dialog walked the page behind it and
 * a keyboard user could neither reach the close button nor tell what had
 * changed. It also left the page behind free to scroll.
 *
 * All four behaviours belong to *being an overlay*, not to showing a film, so
 * they live here once: focus in on open, Tab trapped inside, focus restored to
 * whatever opened it on close, and the body held still while it is up.
 *
 * `render(close)` builds the card's contents and is handed the closer, since
 * most overlays want a control of their own that dismisses them.
 */
export function openOverlay({ label, cardClass = 'modal-card', render, onClose = null }) {
  // Restoring focus matters more than it looks: without it, closing drops the
  // caret back to the top of the document, so a keyboard user who opened this
  // from the tenth card has to walk back down to it.
  const opener = document.activeElement;

  const onKeydown = (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    // Query on every Tab rather than once on open — an overlay whose contents
    // change (the pool sheet repaints itself as filters are picked) would
    // otherwise trap focus against a list of nodes that no longer exist.
    const focusable = card.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
    document.body.style.overflow = previousOverflow;
    if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    // Fires for EVERY exit — the caller's own control, Escape, and a backdrop
    // click all end up here. An owner that only cleaned up on its own button
    // would be wrong two-thirds of the time.
    onClose?.();
  }

  const card = h('div', {
    class: cardClass,
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label,
  });
  card.append(...[render(close)].flat(Infinity).filter(Boolean));

  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
      onClick: (event) => {
        if (event.target === backdrop) close();
      },
    },
    card,
  );

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKeydown);

  // Focus the card itself rather than its first control: a dialog that opens
  // with the close button focused reads as "the action here is to leave".
  card.setAttribute('tabindex', '-1');
  card.focus();

  return { close, card };
}

/**
 * Full-detail overlay for a movie card's "Read more" — cards themselves
 * truncate the synopsis with a CSS line-clamp, so this is the only place the
 * untruncated text is shown.
 */
/**
 * The shortcut table for whatever view is mounted.
 *
 * A registry rather than a constant, because the keys belong to a view — the
 * Draw tab has a dozen, History has none — while the way IN to them belongs to
 * the app: the keyboard symbol lives in the masthead beside the tabs, which is
 * where you look for something that applies to the whole thing. A view sets
 * this on mount and clears it on teardown, so the card can never list a key
 * that is not live.
 */
let shortcutTable = [];

export function setShortcuts(rows) {
  shortcutTable = rows ?? [];
}

export function showShortcuts() {
  return openOverlay({
    label: 'Keyboard shortcuts',
    cardClass: 'modal-card shortcuts-card',
    render: (close) => [
      h(
        'div',
        { class: 'row' },
        h('h2', {}, 'Keyboard shortcuts'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn-sm', onClick: close }, 'Close'),
      ),
      shortcutTable.length === 0
        ? h('p', { class: 'muted' }, 'This tab has no shortcuts of its own.')
        : h(
            'dl',
            { class: 'shortcut-list' },
            ...shortcutTable.flatMap((row) => [
              h(
                'dt',
                {},
                ...row.keys.flatMap((key, i) => [
                  i ? h('span', { class: 'faint' }, row.join ?? ' ') : null,
                  h('kbd', {}, key),
                ]),
              ),
              h('dd', {}, row.what),
            ]),
          ),
      shortcutTable.length
        ? h(
            'p',
            { class: 'faint' },
            'Keys are ignored while you are typing, so a title with a "d" in it stays a title.',
          )
        : null,
    ],
  });
}

export function openMovieModal(movie, { actions = null } = {}) {
  const poster = posterUrl(movie.poster_path, 'w342');

  return openOverlay({
    label: movie.title,
    render: (close) => [
      h('button', { class: 'modal-close', 'aria-label': 'Close', onClick: close }, '✕'),
      poster
        ? h('img', { class: 'modal-poster', src: poster, alt: '' })
        : h('div', { class: 'modal-poster modal-poster--empty' }, 'No poster'),
      // Grid layout (see CSS): poster + info form a two-column top row, and
      // the trailer is a separate row spanning full width underneath —
      // sitting below whichever of the two columns above happens to be
      // taller, which is what a grid row naturally does.
      h(
        'div',
        { class: 'modal-info' },
        h('h2', {}, movie.title),
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
        movie.countries || movie.languages
          ? h(
              'div',
              { class: 'movie-meta faint' },
              [movie.countries, movie.languages].filter(Boolean).join(' · '),
            )
          : null,
        // Doesn't matter for the draw itself (it's already deduplicated by
        // tmdb id by then), but is useful context when just browsing —
        // hence kept to the detail overlay rather than the compact card.
        movie.lists?.length
          ? h(
              'div',
              { class: 'movie-meta faint movie-lists' },
              h('span', {}, 'On:'),
              ...movie.lists.map((entry) =>
                h(
                  'span',
                  { class: 'movie-list' },
                  entry.name,
                  // The rank is the interesting half — being on Box-office
                  // España says less than being its #3 of 1952 — and "of 1952"
                  // is what tells you the position is within that year rather
                  // than across the whole list. An unranked list (Criterion,
                  // Ghibli) shows its name alone, as before.
                  entry.rank
                    ? h(
                        'span',
                        { class: 'movie-list-rank' },
                        `#${entry.rank}${entry.by_year && entry.year ? ` of ${entry.year}` : ''}`,
                      )
                    : null,
                ),
              ),
            )
          : null,
        // Full award names here, one per line — the card has to abbreviate to
        // fit, this is where the whole fact belongs.
        movie.awards?.length
          ? h(
              'div',
              { class: 'modal-awards' },
              h('div', { class: 'field-label' }, plural(movie.awards.length, 'Award')),
              ...movie.awards.map((award) =>
                h('div', { class: 'modal-award' }, '🏆 ', awardLabel(award, { short: false })),
              ),
            )
          : null,
        h('p', { class: 'modal-overview' }, movie.overview || 'No synopsis available.'),
        h(
          'div',
          { class: 'modal-links' },
          movie.is_manual
            ? h('span', { class: 'faint' }, 'Manually added — not on TMDB')
            : [
                h(
                  'a',
                  { href: tmdbUrl(movie.tmdb_id, movie.media_type), target: '_blank', rel: 'noopener noreferrer' },
                  'View on TMDB ↗',
                ),
                h(
                  'a',
                  { href: watchUrl(movie.tmdb_id, movie.media_type), target: '_blank', rel: 'noopener noreferrer' },
                  '▶ Where to watch ↗',
                ),
              ],
        ),
        // Built by the caller, never here. This module imports prefs.js and
        // nothing else on purpose, and an overlay that could add to the lineup
        // itself would have to reach for `lineup` and `api` — see the note at
        // the top. The overlay shows a film; what you can DO with one belongs
        // to whoever is showing it.
        //
        // Handed `close` because deciding in here and then having to find the
        // card again was the whole complaint: the action that finishes the job
        // should also finish the interruption.
        //
        // Beside the synopsis, NOT after the trailer. Below it they were past a
        // 315px video embed and off the bottom of the overlay — present, and
        // unreachable without scrolling for them.
        actions ? h('div', { class: 'modal-actions' }, actions(close)) : null,
      ),
      h('div', { class: 'modal-trailer-row' }, trailerBlock(movie)),
    ],
  });
}
