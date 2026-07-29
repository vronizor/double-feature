/** Tiny DOM helpers — no framework, no build step. */

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

export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast toast--${kind}` }, message);
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('is-leaving'), 2600);
  setTimeout(() => el.remove(), 3200);
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
export const formatRating = (voteAverage) =>
  typeof voteAverage === 'number' && voteAverage > 0 ? voteAverage.toFixed(1) : null;

// TV-sourced entries (e.g. Histoire(s) du cinéma, catalogued on TMDB as a TV
// series) are stored keyed by the negation of their real TMDB id — see the
// schema comment on `movies` — so building the right public URL needs both
// the media type and the absolute value of the id.
export const tmdbUrl = (tmdbId, mediaType = 'movie') =>
  `https://www.themoviedb.org/${mediaType === 'tv' ? 'tv' : 'movie'}/${Math.abs(tmdbId)}`;

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
// meta line, so these are the compact forms used on the card and the poster
// badge. The modal shows the full name instead, where there's room for it.
//
// An explicit map rather than clever parsing because the two Oscar lists would
// otherwise both shorten to "Oscar", and a film that won both (Parasite) would
// read "Oscar 2020 · Oscar 2020". Unknown names fall back to stripping the
// qualifier, so a list added later still degrades sensibly.
const AWARD_SHORT_NAMES = {
  'Oscar — Best Picture': 'Oscar',
  'Oscar — Best International Feature': 'Oscar Intl.',
  'Palme d’Or (Cannes)': 'Palme d’Or',
  'Golden Lion (Venice)': 'Golden Lion',
  'Golden Bear (Berlin)': 'Golden Bear',
  'BAFTA — Best Film': 'BAFTA',
  'César — Meilleur Film': 'César',
  'Goya — Mejor Película': 'Goya',
};

export const shortAwardName = (name) =>
  AWARD_SHORT_NAMES[name] ?? name.replace(/\s*\(.*\)$/, '').replace(/\s*—.*$/, '');

/** "Palme d’Or 2019", or just "Palme d’Or" when the year isn't recorded. */
export const awardLabel = (award, { short = true } = {}) => {
  const name = short ? shortAwardName(award.name) : award.name;
  return award.year ? `${name} ${award.year}` : name;
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
 * Full-detail overlay for a movie card's "Read more" — cards themselves
 * truncate the synopsis with a CSS line-clamp, so this is the only place the
 * untruncated text is shown. Closes on backdrop click, the close button, or
 * Escape.
 */
export function openMovieModal(movie) {
  const rating = formatRating(movie.vote_average);
  const poster = posterUrl(movie.poster_path, 'w342');

  const onKeydown = (event) => {
    if (event.key === 'Escape') close();
  };

  function close() {
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
  }

  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
      onClick: (event) => {
        if (event.target === backdrop) close();
      },
    },
    h(
      'div',
      { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': movie.title },
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
          [movie.year, movie.director].filter(Boolean).join(' · '),
          rating ? h('span', { class: 'movie-rating' }, ` · ★ ${rating}`) : null,
        ),
        h(
          'div',
          { class: 'movie-meta faint' },
          [movie.runtime ? `${movie.runtime} min` : null, movie.genres].filter(Boolean).join(' · '),
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
        movie.lists ? h('div', { class: 'movie-meta faint' }, `On: ${movie.lists}`) : null,
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
            : h(
                'a',
                { href: tmdbUrl(movie.tmdb_id, movie.media_type), target: '_blank', rel: 'noopener noreferrer' },
                'View on TMDB ↗',
              ),
        ),
      ),
      h('div', { class: 'modal-trailer-row' }, trailerBlock(movie)),
    ),
  );

  document.addEventListener('keydown', onKeydown);
  document.body.appendChild(backdrop);
}
