# Double Feature

A self-hosted movie-night app for a Raspberry Pi. Build tonight's shortlist
from curated lists — drawn at random, searched for by name, or added by hand —
then run a ranked-choice (Borda count) vote so everyone in the room picks the
winner together from their phones.

No accounts, no auth, no internet exposure — it's a tool for a trusted group of
friends on one Wi-Fi network.

```
Curated lists → build a lineup → publish → guests vote via QR → Borda count → winner
```

Node/Express backend, a vanilla JS frontend with no build step, and SQLite for
storage — the whole thing runs as one process, no database server or bundler
required.

## Setup

### 1. Prerequisite: give the Pi a static LAN IP

**Do this first.** Guests reach the app at `http://<pi-lan-ip>:8080`, and that
address is baked into the QR code at publish time. If the Pi's IP changes, old
links break.

Reserve it in your router's DHCP settings (usually "DHCP reservation" or
"static lease", keyed to the Pi's MAC address). The app can't do this for you.

A `.local` hostname is deliberately **not** used — mDNS resolution is unreliable
on guest Android phones, which is exactly when you can least afford it to fail.

### 2. Get a TMDB API key

TMDB supplies all film metadata (posters, directors, genres, runtimes). A key is
free for personal use: https://www.themoviedb.org/settings/api

```bash
cp .env.example .env
# then edit .env and set TMDB_API_KEY (or TMDB_ACCESS_TOKEN for a v4 token)
```

Set `HOST_LAN_IP` too if the Pi has both Ethernet and Wi-Fi up and you want to
pin which address guests get.

### 3. Start it

```bash
docker compose up -d --build
```

Or without Docker (Node 24+):

```bash
npm install
npm start
```

> **⚠️ On the Pi, leave `DB_PATH` unset.** `docker-compose` bind-mounts
> `./data:/app/data` and passes `.env` straight into the container, so an
> absolute path copied from a development machine sends the container looking
> for a directory it has no way to reach. If you have been running the app
> elsewhere, delete that line before copying `.env` across.
>
> The database is **never committed**, whichever way it is configured: it holds
> guests' names against their ballots, and the IMDb-derived ratings in it are
> licensed for use and not for redistribution.

Open `http://<pi-lan-ip>:8080` on the host machine.

### 4. Load the built-in lists

```bash
docker compose exec double-feature node scripts/seed.mjs
# or, without Docker:  npm run seed
```

This resolves ~3,500 entries against TMDB and takes a few minutes. It's safe to
re-run — finished entries are skipped, so an interrupted run just continues.
Seed lists arrive **active**, so you can draw immediately.

## Using it

**Lineup tab** — build up tonight's shortlist through any mix of three ways to
add a film, then publish it as a vote once you're happy with it:

- **Draw random films** — start from a **"Tonight is…"** vibe (Cinephile,
  Awards, Modern Classics, Family — each sets both the lists and the filters
  that go with it), or tick lists by hand in **Pool setup**.

  Pool setup is a **destination, not a panel that pushes the page down**: a
  sticky rail beside the content on a wide screen, a full-screen sheet on a
  phone, and a wide overlaid card on desktop when you want room to work (`p`,
  or the `⤢` in the rail's header). Whichever it is, the Draw button stays
  where it was. What the pool currently *is* reads back as a row of removable
  pills next to the Draw button — `20 lists · top 5 per year · Drama` — so you
  never have to open anything to see what you are drawing from.

  Lists carry **tags**, so the picker groups them; a list appears under every
  tag it carries, and the header says how many do (`20 of 20 lists selected ·
  7 appear under more than one tag`). A group opens itself when it is
  *part*-selected — the only state its header cannot already tell you — and
  expanding is separate from selecting, so opening a group to look inside never
  changes what you draw from.
  Vibes are yours to add: set the pool up how you like it and hit
  **+ Save current…**. Narrow further by genre, language, year or runtime;
  ranked lists (TSPDT, Sight & Sound) also get a **Top N** control, so "draw from the TSPDT top 100" is a
  single number. Then pick how many to draw (1–10) and hit Draw. A live
  "N films match" count updates as you go, so you see the size of the pool
  before spending a draw on it.

  A vibe is a starting point, never a gate — Draw works with nothing selected,
  and the moment you hand-edit anything the label switches to *Custom* rather
  than claiming a vibe it no longer matches. What you pick here applies to
  tonight only; the **Lists** tab is where you set which lists are in play *by
  default*.

  Drew something you don't fancy? **Replace N** swaps out only the films that
  were *drawn*, leaving anything you added deliberately alone, and it remembers
  what it has already shown you so pressing it again moves forward.
- **Add a specific film** — one button that expands to a single box taking all
  three forms. Type a title to search TMDB; paste a TMDB URL to add that film
  outright, which is the way in for titles catalogued as a TV series rather
  than a movie (Godard's *Histoire(s) du cinéma*, for one). Bare digits are
  *searched*, not treated as an id — `1917`, `300` and `2012` are all real
  titles — and the id reading is offered beside the results instead of being
  chosen for you.
- **Add it manually** — for the rarer case still: a film not on TMDB at all.
  Give it a title and, optionally, a year, and it joins the lineup with no
  poster or metadata attached.

However a film got there, drawing or searching again just adds more — nothing
is discarded until you remove it (or hit "Clear all"), and nothing is saved
until you publish. Click any title to see the full synopsis and, when TMDB has
one, an embedded trailer (or a one-tap YouTube search link when it doesn't) —
and to act on it without closing first: the overlay carries **Mark watched**
and **+ Add to lineup**.

Award winners carry a 🏆 badge on the poster and a line naming what they won
and when — *Palme d'Or 2024 · Oscar 2025*. The **🏆 Awards** switch above the
grid turns that off if you'd rather not be influenced before voting. Where the
source doesn't record a ceremony year the badge simply names the award; see
`BACKLOG.md` for why some are missing and what it'd take to fill them in.

**Explore tab** — browse the whole active library outside of building a vote:
the same filters as the Lineup tab, in the same rail, sortable, paginated, with
a search box. The library leads — the controls are beside it, not stacked above
it.
Useful for settling "wait, do we even have that?" arguments, and every card
here can also be added straight to the Lineup with one click.

**Publish** — turns the lineup into a vote session at an unguessable URL like
`/vote/x7f2k9`. **Only one vote can be open at a time**: the guest link and the
QR are both simply "the vote", so a second one would replace the first for
anyone scanning after that point while the ballots already cast sat somewhere
unreachable. If a vote is already open, the Lineup tab says so and offers a way
back to it — close it or cancel it first. The host screen shows a QR code, the same URL as plain
selectable text with a copy button, and a one-tap "Open" link for the host's
own phone (no need to scan your own QR code). Guests scan, rank by tapping
(first tap = #1, tapping a ranked film again removes it and renumbers the
rest), enter a name and submit. The host's running tally updates every 3.5s.

**Close voting** ends the session and shows the result — final for that vote,
so another round means building a new lineup. **Cancel** is the other option
while voting is still open: it throws the whole thing away instead, including
any ballots already cast, and it never appears in history — for when a vote
was started by mistake.

**History tab** — every published vote, with its date, the filters applied, the
films, the vote count and the winner. Click any row for its full results.

### Keyboard shortcuts

The `⌨` beside the tabs lists whatever the current tab offers, and `?` opens the
same card. On the Lineup tab:

| Key | |
|---|---|
| `p` | Open or close Pool setup |
| `d` | Draw |
| `r` | Replace the drawn films |
| `c` | Clear the lineup |
| `l` | Select all lists, or none |
| `a` or `/` | Add a specific film |
| `⇧↑` `⇧↓` | Draw one more, or one fewer |
| `←` `→` | Move between vibe chips, once one is focused |
| `Esc` | Close whatever is open |

Keys are ignored while you are typing, so a title with a `d` in it stays a
title. `Tab` is deliberately left alone — it is how you reach everything else.

### Anonymous voting

Ticking **anonymous** before publishing means individual ballots are hidden from
*everyone once voting closes, including the host* — only aggregate points and
vote counts are ever shown.

This is enforced when the ballot is written, not filtered on the way out: no
name and no timestamp are stored at all, and the rank rows are shuffled. Opening
`data/double-feature.db` by hand won't tell you who voted for what either. The
running tally is also withheld from the host while an anonymous session is open.

### Scoring

Borda count: with N films, a 1st-place vote is worth N−1 points, 2nd is N−2, and
so on down to 0. Highest total wins.

- Films a voter left unranked score 0, so a partial ballot still counts.
- Ties go to the film with most 1st-place votes.
- If that's still tied, the winner is picked at random and the results screen
  says so plainly — it's shown as a coin flip, never silently resolved. The
  outcome is recorded at close, so revisiting the result never re-rolls it.

## Adding your own list

On the **Lists** tab, create a named list, then import into it by pasting text
or uploading a file:

- **Plain text** — one title per line. `Vertigo (1958)`, `Vertigo, 1958` or bare
  `Vertigo` all work.
- **CSV** — with a `title,year` header, or just two columns.
- **JSON** — `[{"title": "Vertigo", "year": 1958}]`, or an array of strings. A
  `tmdb_id` field is used directly if you have one.

Every title is resolved to a TMDB id. Anything TMDB can't confidently match is
flagged for review rather than dropped — open the list and either pick from the
suggested candidates, search TMDB by hand, or drop the entry. The rare boxset
entry (Criterion's Qatsi Trilogy, bundled as one spine number) can be split into
its separate films instead of resolved to one.

Because identity is the TMDB id and not the title string, a film on two lists
collapses to one entry in the pool and can't be drawn twice. That also survives
accents, alternate titles and "The" prefixes, which plain title matching would
miss.

Mark films **watched** to keep a record of what you have seen. Draws include
them by default — a household rewatches, and a film you loved is a perfectly
good thing to draw again — and the Pool setup filter excludes them when you
want something new.

## Where the seed lists come from

The original spec assumed all six lists could be pulled from Wikipedia. Only two
of them actually can, so each list is sourced from wherever it genuinely lives.
Two more were added later, from their own publisher and (by hand, since its site
blocks scripted access) a curator on SensCritique — then eight award lists from
Wikidata and the language Wikipedias:

| List | Tags | Source | Count |
|---|---|---|---|
| The Criterion Collection | collection, canon | Wikidata, spine number `P12279` | 1,251 |
| Sight & Sound 2022 (critics) | canon | bfi.org.uk — the poll's publisher | 264 |
| TSPDT 1,000 Greatest Films | canon | theyshootpictures.com — the list's publisher | 1,000 |
| Disney Animated Canon | collection, family, animation | Wikidata, "WDAS feature film" series | 65 |
| Studio Ghibli | collection, family, animation | Wikidata, "Studio Ghibli Feature Films" series | 23 |
| BFI: Films to See by Age 15 | family | bfi.org.uk (2020 update of a 2005 list) | 64 |
| Family Films (Ages 6+) | family | A user's curated list on SensCritique | 251 |
| Oscar — Best Picture | awards | Wikidata, award received `P166` | 97 |
| Oscar — Best International Feature | awards | Wikidata, award received `P166` | 71 |
| Palme d'Or (Cannes) | awards, festivals | Wikidata, award received `P166` | 82 |
| Golden Lion (Venice) | awards, festivals | Wikidata, award received `P166` | 66 |
| Golden Bear (Berlin) | awards, festivals | Wikidata, award received `P166` | 86 |
| BAFTA — Best Film | awards | en.wikipedia category → Wikidata → TMDB | 78 |
| César — Meilleur Film | awards | fr.wikipedia category → Wikidata → TMDB | 51 |
| Goya — Mejor Película | awards | es.wikipedia category → Wikidata → TMDB | 40 |
| Modern Classics (last 10 years) | dynamic | TMDB `/discover` — *see below* | 120 |

**On the Modern Classics list:** this one is **query-backed**. Its membership
isn't a fixed set of titles but a TMDB `/discover` query, re-run daily, so it
keeps meaning "the last ten years" without anyone re-seeding it each January.

The query sorts by rating with a **vote-count floor of 5,000**, and that floor
is the entire point. TMDB's own `/movie/top_rated` has none, which is why it
mixes real classics with obscure titles a handful of enthusiastic fans have
pushed to the top — at a floor of 1,000 it still surfaced a niche romance
trilogy, while at 5,000 it returns *Top Gun: Maverick*, *Across the
Spider-Verse* and *The Wild Robot*. The list exists to balance a library that
is otherwise heavily weighted toward the arthouse canon.

It was called "Crowd-Pleasers" until that name was measured against reality:
sorting by rating selects for *acclaim*, so its lowest entry rates 8.2 while
the films people actually put on for a fun evening rate 6.6–7.0. No vote floor
reaches them — see `BACKLOG.md`.

Query-backed lists are materialised into the same tables as every other list,
so nothing downstream — filters, Top-N, drawing, publishing — treats them
specially. Refresh one by hand with `npm run refresh-dynamic`.

**On the awards lists:** TMDB carries no awards data at all — its `oscar`
keyword tags nine films — so these come from Wikimedia, by two different routes.

The international awards use Wikidata's *award received* (`P166`) directly.
The three national awards can't: Wikidata's coverage of them is badly
incomplete (32 films for BAFTA Best Film, 26 for the César, 12 for the Goya,
against many decades of ceremonies). Each language Wikipedia curates its own
national award properly, so those are taken from the relevant **category**
instead, and each member page is resolved through its Wikidata item to a TMDB
id — 79/51/41 films at 98–100% id coverage, with no fuzzy title matching
anywhere. Going via the Wikidata item also sidesteps localisation entirely: the
French page for a film points at the same item as the English one.

Each award was measured against the existing pool before being included,
because the point of an awards list is the films it *adds*, not the label:

| Most additive | | Least additive | |
|---|---|---|---|
| Golden Bear | 21% already present | BAFTA | 79% already present |
| Goya | 13% | Palme d'Or | 58% |
| César | 29% | Oscar Best Picture | 43% |

BAFTA is kept despite the overlap — it adds only 16 films, but "draw me a BAFTA
winner" is still a thing you might want to ask for.

Why not Wikipedia:

- Its **Criterion** release list was deleted, and criterion.com blocks scripted
  requests. Wikidata is both a legitimate source and a better one: 1,222 of the
  1,251 entries carry a TMDB id already, so most need no lookup at all.
- Its **Sight & Sound 2022** article lists only the top 10 in prose. The BFI's
  own page carries the full 264.
- The **TSPDT** list isn't on Wikipedia in any form.
- Its **BFI "films to see by 14"** article was deleted too, but BFI itself still
  hosts an updated version of the list on their own site.

**On "IMDb Top 100":** the spec asked for one while ruling out the IMDb API
(commercially priced) and scraping IMDb, leaving no legitimate source for an
IMDb-*ranked* list. TMDB's own `/movie/top_rated` was considered as a
replacement, but it turned out to be a poor stand-in: it's a raw average
rather than a vote-weighted score, so it mixes real classics in with obscure
titles that a handful of enthusiastic fans pushed above their vote count's
worth. Two curated, human-picked lists (above) filled that slot instead. Swap
in your own via the custom-list import if you want a specific ranking.

Refresh the first five from source with `npm run fetch-seeds`; the committed
JSON means a normal install never touches those sites. BFI and the SensCritique
list were captured by hand instead (the latter blocks scripted access outright)
and don't have a re-fetch script — updating them means repeating that by hand.

## Notes

- **Polling, not WebSockets.** A handful of people on one LAN submitting one
  ballot each doesn't justify a socket layer; a few seconds of lag before the
  host's screen updates is a non-issue, and it's far less to run on a Pi.
- **No ballot-stuffing prevention.** Nothing stops someone voting twice. That's
  the trusted-friend model, on purpose.
- **LAN only.** The app binds `0.0.0.0` so phones on the same Wi-Fi can reach
  it. Don't port-forward it — there's no authentication anywhere by design.
- **Posters hot-link to TMDB**, so the Pi needs internet access (the LAN it
  runs on is assumed to have it). Nothing is cached to disk but metadata.
- **TMDB's terms cap cached data at six months.** A background job refreshes any
  entry older than five months, and runs a minute after boot then daily.

## Development

```bash
npm install
npm test          # 344 tests: Borda scoring, ranking, parsing, filters, full API pass
npm run dev       # auto-restarting server
```

**After touching anything in `public/`, load every frontend module under a
stubbed DOM.** `node --check` is a syntax check, so a symbol that is used but
never imported passes it and only fails in the browser — this has bitten the
project more than once. There is a stub recipe in `.claude/CLAUDE.md`.

**`npm test` needs no credentials and touches no network.** A fresh clone with
no `.env` passes everything.

> This paragraph used to say the opposite — that four tests in
> `dynamic-lists.test.js` "exercise the real discover query" and that a clone
> without `.env` would report four failures, expected rather than broken. Both
> halves were wrong. Those tests stub TMDB at `fetch` like the rest and never
> reach the network; they failed only because `request()` rejects missing
> credentials *before* it fetches, so the suite needed the variable to **exist**
> rather than to be **valid**. And it was six tests, not four. The `test` script
> now supplies a dummy key when none is set, which is what makes the suite
> hermetic — a test run must not depend on whose machine it is on. Recorded
> rather than quietly deleted because this text was believed and repeated.

The frontend is plain ES modules with no build step — edit files in `public/`
and reload.

```
server/    express app, SQLite schema, TMDB client, Borda scoring, pool filters
public/    the SPA (host screens + guest voting), no framework
seeds/     committed seed list JSON
scripts/   fetch-seed-lists.mjs (sources → JSON), seed.mjs (JSON → SQLite)
test/      node:test suites
```

---

This product uses the TMDB API but is not endorsed or certified by TMDB.
