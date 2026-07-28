# Double Feature — Build Spec

Build a self-hosted movie-night app, codenamed "Double Feature," for a
Raspberry Pi homelab. It draws
random movies from curated/custom lists, then runs ranked-choice (Borda
count) voting so a group can pick the winner together.

## Core concepts

- **List**: a named collection of `{title, year}` entries.
- **Draw**: a random selection of N movies (1, 2, or 5) pulled from the
  deduplicated pool of all currently-checked lists.
- **Vote session**: a published draw, open for ranked voting until the
  host closes it.

## Feature 1 — List management

- Named lists stored in SQLite. Checkboxes in the UI select which lists
  are "active" for the next draw.
- Ship with built-in seed lists, sourced from Wikipedia as flat
  `{title, year}` JSON (no scraping IMDb/Letterboxd — see Feature 2 for
  why):
  - Criterion Collection
  - BFI / Sight & Sound Greatest Films poll
  - TSPDT 1000 Greatest Films
  - IMDb Top 100 (informational list, not pulled live from IMDb)
  - Disney Animated Canon
  - Studio Ghibli filmography
- Host can add custom lists: upload CSV/JSON, or paste plain text
  (one title per line, parsed and matched via TMDB search).
- Host can mark individual titles "watched." Watched titles are excluded
  from future draws by default; a toggle allows rewatches.

## Feature 2 — Metadata (TMDB)

- On import, resolve each `{title, year}` via TMDB's `/search/movie` and
  cache poster path, year, director, genres, runtime, and overview
  locally.
- Do **not** use the official IMDb API (six-figure commercial pricing)
  or Letterboxd (no self-serve API — access is invite-only by request,
  and their RSS feeds cap out at 10 films per list preview). TMDB is the
  only practical source here.
- TMDB's terms cap cached-data retention at 6 months — include a
  scheduled job that refreshes any cached entry older than ~5 months.
- Attribute TMDB per their terms (small "Data from TMDB" credit).
- Titles TMDB can't confidently match should be flagged for manual
  reconciliation, not silently dropped.
- **Every movie's canonical identity is its TMDB id, not the title/year
  string.** Two lists containing the same film (e.g. it's on both
  Criterion and BFI) should collapse to one entry once resolved, not
  draw twice — plain title+year matching would miss this on accents,
  alternate titles, or "The" prefixes. Suggested shape: a `movies`
  table keyed by `tmdb_id` holding resolved metadata, and a
  `list_movies` join table (`list_id`, `tmdb_id`) for list membership —
  with the raw entered title/year kept alongside each `list_movies` row
  only until it's resolved, for provenance and manual reconciliation.

## Feature 3 — Draw

- Random draw of N movies from the deduplicated active-list pool,
  excluding watched titles.
- Redraw button discards the current draw and pulls a new one.
- Draws are ephemeral until published — don't persist every redraw.

## Feature 4 — Publish → vote session

- "Publish" turns the current draw into a vote session at an
  unguessable slug, e.g. `/vote/x7f2k9`.
- Host screen shows:
  - A QR code encoding `http://<pi-lan-ip>:<port>/vote/<slug>` — use
    the Pi's LAN IP directly, not a `.local` hostname (mDNS resolution
    is unreliable on guest Android phones). This requires the Pi to
    have a static IP via router DHCP reservation — note this as a
    setup prerequisite in the README, the app can't guarantee it.
  - The same URL as **plain selectable text** underneath (not inside a
    button/link wrapper, so native long-press-to-select always works),
    plus a copy icon next to it.
  - Copy icon behavior: try `navigator.clipboard.writeText()`, and on
    failure/unavailability fall back to a hidden textarea +
    `document.execCommand('copy')`. This fallback is required, not
    optional — the app is served over plain HTTP on a LAN IP, which
    browsers don't treat as a secure context, so the modern Clipboard
    API will be `undefined` on every guest phone.
- Before publishing, host can check **"anonymous voting."** When
  enabled, individual ballots are hidden everywhere once voting closes
  — including from the host — showing only aggregate point totals and
  vote counts. (Flag to the user if this isn't the intended scope —
  the alternative is hiding ballots from guests only, while the host
  still sees who voted what.)

## Feature 5 — Voting (guest screen)

- Guest opens the link and sees the drawn movies with posters.
- Ranking is tap-based: first tap on a movie = rank 1, next tap on a
  different movie = rank 2, etc. Tapping an already-ranked movie again
  removes it and **auto-renumbers** the remaining ranked movies to close
  the gap. A reset button clears all taps.
- Enter name, submit. No de-duplication of submissions — trusted-friend
  model, not adversarial.
- Guest screen polls the vote session's status every 3–4s; when the
  host closes voting, it flips automatically to the results view.

## Feature 6 — Host live tally + close

- Host's publish screen polls the vote session every 3–4s and shows a
  running tally as ballots arrive (unless anonymous voting is on — see
  Feature 4).
- Use polling, not WebSockets. At this scale (a handful of people on
  one LAN, submitting one ballot each) polling gives an equivalent
  experience with far less to build and run on the Pi; a few seconds of
  lag before the host's screen updates is a non-issue.
- A "close voting" button ends the session. Closing is final for that
  draw — starting another round means drawing again.

## Feature 7 — Results

- Borda count: for N movies, 1st place = N−1 points, 2nd = N−2, ...,
  last = 0. Highest total wins.
- Tie-break: most 1st-place votes wins; if still tied, pick randomly
  among the tied movies and show this plainly as a coin flip, not
  silently.
- If not anonymous: show each voter's name alongside their full
  ranking, plus the points table.
- If anonymous: aggregate points and vote counts only.

## Architecture

- Backend: Node/Express or FastAPI, whichever you're more comfortable
  defaulting to — no strong preference. SQLite for storage; this is a
  low-traffic, small-scale app with no need for Postgres.
- Frontend: single-page app, served by the backend.
- Deployment: Docker + docker-compose on the Pi.
- Network: bind to the LAN only. No auth system anywhere — this is a
  trusted-friend-group tool, not a public service.

## Explicit non-goals for v1 (do not build these)

- No user accounts or authentication.
- No public internet exposure — LAN/Wi-Fi only, by design.
- No WebSockets / real-time push — polling only.
- No ballot-stuffing prevention — trust-based.
- No multi-tenant or multi-household support.

## Deliverables

- Repo structure, `Dockerfile`, `docker-compose.yml`.
- Seed list files (the six lists above) as flat JSON, plus a script
  that resolves them against TMDB and populates the local cache.
- README covering: setup, TMDB API key configuration, the DHCP
  reservation prerequisite, and how to add a custom list.
