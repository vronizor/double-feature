# Roadmap

v1 shipped a working loop: curated lists → draw → vote → winner. v2 is about
**occasions** — the observation that the same host has different Friday nights,
and the app currently only serves one of them well (the arthouse-canon one).

Everything below was verified against the real TMDB API and the real library on
2026-07-28, not reasoned about. Where a probe contradicted an earlier plan, the
contradiction is recorded so it doesn't get re-proposed later.

---

## 0. Settle first — list selection must stop being global DB state

**This blocks everything else. Decide it before writing code.**

`lists.is_active` is today a persisted, global flag:

```
server/pool.js:72              WHERE l.is_active = 1   ← the draw pool
server/pool.js:194             WHERE l.is_active = 1   ← Explore's pool
server/routes/sessions.js:67                           ← builds filter_summary at publish
written from: draw.js, explore.js, lists.js            ← three separate UIs
```

If an occasion applied by setting list activity, one chip click would fire
~20 PATCH requests, change what the **Explore** tab shows, **persist after you
leave**, and get baked into the published session's `filter_summary`. None of
that is what "tonight's occasion" should mean. It also collides with the
singleton decision in §3: filters would live in memory while list selection
lived in the database, so applying an occasion would write to two places with
different lifetimes.

**Decision:** list selection becomes **view-level state**, held in the same
module singleton as the filters, seeded from `is_active` at load.

- `is_active` keeps an honest, narrower meaning: *"in play by default when the
  app opens"* — a real preference, curated on the **Lists** tab, which becomes
  the only place that writes it.
- Lineup and Explore select locally and never write.

**Knock-ons to budget for:**

1. `buildPoolQuery` hardcodes the `is_active = 1` subquery. It must instead take
   an explicit set of list ids. Medium-sized, and it makes the function more
   testable rather than less.
2. `POST /api/sessions` currently derives `filter_summary` server-side by
   reading `is_active`. The client will have to send the selected list ids
   instead.

## 1. How to think about it

Sorting the things people actually want out of a movie night, there are only
**three kinds of thing** underneath — and we had been calling all of them
"lists":

| Kind | What it is | Where it lives |
|---|---|---|
| **Curated list** | Someone else's editorial judgment, fixed rows | `list_movies` (today) |
| **Dynamic list** | A parametric query, self-updating | New — materialised into `list_movies` |
| **Property filter** | A facet over metadata already cached | `buildPoolQuery` clauses (today) |

The important part: **nobody plans a movie night in those three categories.**
"Family night" is simultaneously a curated list, a genre exclusion and a runtime
ceiling. The user thinks about the *occasion*; the three-way split is an
implementation detail that must stay hidden.

So the user-facing primitive is the **occasion**, not the list.

### The occasions

| Occasion | Bundles | Ships in v2 |
|---|---|---|
| **Cinephile** | Canon lists (TSPDT, S&S, Criterion), optional Top-N | ✅ |
| **Awards catch-up** | Awards-category lists + a recency year filter | ✅ |
| **Crowd-pleasers** | The auto-updating TMDB list | ✅ |
| **Family** | Family lists + horror excluded | ✅ |
| **Director night** | Ad-hoc query, parameter = a person | ⏳ deferred |
| **Theme night** | Ad-hoc query, parameter = a keyword | ⏳ deferred |

Fixed occasions are a bundle of {lists, filters}. **Director and theme night are
parametric** — they need a value at selection time. v2 ships only the fixed
ones, but the design must accommodate both or adding them later means a second,
different interaction. See §3 and §5.

---

## 2. What the probes actually found

### Verified — build on these

**Awards via Wikidata is the standout source.** A SPARQL query for
`P166 = Q102427` (Academy Award for Best Picture), constrained to
`P31 = Q11424` (film — without this it also returns the *producers*, who
receive the award too), gives:

```
distinct films:  98
with TMDB id:    98  (100%)
```

100% id coverage, cleaner than Criterion's 97.7%. It reuses the Wikidata
fetcher pattern already in `fetch-seed-lists.mjs`. Caveat: the endpoint is
flaky under load (429 and 502 both hit during probing), so the fetcher needs
retry/backoff — but it's a build-time script, not runtime.

**TMDB has no awards data at all.** Its `oscar` keyword tags **9 films total**.
There is no awards field, and keyword coverage is negligible. Awards *must*
come from outside TMDB. Do not revisit.

**Rank is data already in the repo, being discarded.** `seeds/tspdt-1000.json`
and `seeds/sight-and-sound.json` both carry `rank` per entry, but `list_movies`
has no rank column, so `recordEntry()` silently drops it at seed time. "Draw
from the TSPDT top 100" is impossible today for want of one column.

**National cinema is nearly free.** `movies.countries` is already cached. This
is a property filter, not a list — no new data source needed. (TMDB's
`with_origin_country` also works if a dynamic list is ever wanted instead.)

**`append_to_response=watch/providers` works.** Streaming data piggybacks on the
movie detail call the refresh job already makes — **zero extra requests**.

### Reversals — do NOT re-propose these

**❌ Certification-based kids' filtering is unsafe.** Asking TMDB discover for
`certification_country=FR&certification.lte=TP` returned **Schindler's List,
The Godfather Part II and Pulp Fiction**. Per-film spot checks show why:

```
                          FR    US   GB
Schindler's List          12    R    15
The Godfather             12    R    15
The Shawshank Redemption  TP    R    15
Pulp Fiction              12    R    18
```

French ratings are far more permissive than expected, pre-1980 films are mostly
`NR` (which means *unrated*, not *safe*), and the discover-level filter doesn't
even respect the per-film data. The failure mode is showing Schindler's List on
family night. **The existing curated family lists (BFI, SensCritique) are
strictly better.** Killed.

**🔻 Streaming is a badge, not a filter.** Measured FR flatrate coverage across
a stratified sample of the actual library:

```
pre-1930   0%      1980-99   20%
1930-59   40%      2000-14   60%
1960-79   20%      2015+     40%
```

~30% overall. A hard "only what we can stream" filter would cut 2,036 films to
roughly 600, deleting disproportionately from the arthouse canon that is this
library's whole point. Surface it as information on the card; never as a pool
constraint. **Absent must mean "unknown", not "excluded".**

**⚠️ The crowd-pleaser query needs a 5000-vote floor, not 1000.** At
`vote_count.gte=1000`, sorting by rating still returns *Gabriel's Inferno* —
the exact noise that got `/movie/top_rated` rejected in v1. Measured:

```
vote_count>=1000 → 707 films — Swapped, Michael, Gabriel's Inferno   ✗ still noise
vote_count>=5000 →  88 films — Top Gun: Maverick, Across the
                               Spider-Verse, The Wild Robot,
                               Puss in Boots: The Last Wish          ✓ genuinely good
```

Use `sort_by=vote_average.desc&vote_count.gte=5000`.

**⚠️ `with_crew` is unusable for director night.** `with_crew=<Kurosawa>`
returns **112** films — including 1936 comedies where he was an *assistant*
director — because it matches any crew role. Use
`/person/{id}/movie_credits` filtered to `job=Director` instead (~30 films).

---

## 3. UX / UI

### Lineup tab

```
┌──────────────────────────────────┬──────────────────────────────────┐
│ Draw random films                 │ Add a specific film               │
│                                   │                                   │
│ Tonight is…                       │  Search TMDB…         [Clear]     │
│ [Cinephile] [Awards] [Crowd]      │  Paste a TMDB URL or id…          │
│ [Family] [Director ▾] [Theme ▾]   │  Still can't find it? ▸           │
│                                   │                                   │
│ ▸ Pool setup                      │                                   │
│   Awards · 3 lists · 2015+        │                                   │
│                                   │                                   │
│ Draw [2] films      88 films match│                                   │
│ [Draw 2] [Replace 2] [Clear all]  │                                   │
├──────────────────────────────────┴──────────────────────────────────┤
│ Your lineup (3)                                                       │
│ [poster] [poster] [poster]                                            │
│ ☐ Anonymous voting              [Publish & open voting]               │
└───────────────────────────────────────────────────────────────────────┘
```

Occasion chips sit **inside** the Draw card, directly above Pool setup, because
that is exactly what they configure — and "Add a specific film" is deliberately
untouched by them. This also avoids re-making the mistake fixed late in v1,
where pool configuration visually outranked the whole tab.

**Draw must still work with no occasion selected.** That is v1's behaviour,
unchanged. Occasions are shortcuts that may be ignored, never a gate. If a
preset ever feels like a form you must complete before seeing a film, it has
gone wrong.

### Pool setup, expanded

```
▾ Pool setup                                  Awards · 3 lists · 2015+
  LISTS                                    [select all] [deselect all]
  ▸ Canon            3 lists · 2,180 films        [all] [none]
  ▾ Awards           5 lists ·   410 films        [all] [none]
      ☑ Oscar Best Picture      98
      ☑ Palme d'Or              77
      ☐ BAFTA Best Film         76
  ▸ Family           2 lists ·   280 films        [all] [none]
  ▸ Auto-updating    1 list  ·    88 films        [all] [none]

  TOP N          ← only rendered when a ranked list is active
  Top [100] of each ranked list

  FILTERS
  genres · language · year · runtime      (unchanged from v1)
```

Categories collapsed by default, with **global select-all/deselect-all** plus
per-category `[all]`/`[none]`. This is what makes 20 lists survivable — "all
awards lists" becomes one click instead of five.

**Top N renders only when an active list actually carries ranks.** Showing it
against Criterion (unranked) would be meaningless.

### Rules that keep it honest

- **Hand-editing demotes the chip to "Custom."** The moment a list or filter is
  toggled by hand, the active occasion chip deselects and the summary reads
  `Custom · 4 lists · 1960–1979`. Otherwise the UI claims "Awards" while showing
  something else.
- **Applying an occasion replaces pool setup wholesale** and toasts what it did.
- **Occasion + filters must survive tab navigation.** `state.filters` is
  currently view-local, so switching to Explore and back resets it — invisible
  today, genuinely annoying once an occasion is selected. Fix with the same
  trick as `lineup.js`: a module singleton. Should land *with* this work, not
  after.

### Streaming as a badge

No new filter UI at all — card meta line and modal only:

```
Seven Samurai
1954 · Akira Kurosawa · ★8.5
207 min · Drama, Action
▸ MUBI                        ← absent when unknown
```

### Explore

Explore shares `renderFilterPanel` and `emptyFilters` with Draw, so the
occasion-applier belongs in `browse.js`, not `draw.js` — even though the chip
row only renders on Lineup in v2. Costs nothing now; "show me the awards films"
is an obvious Explore action later.

---

## 4. v2 — done

Shipped. Kept for the reasoning and the traps, which stay true.

F1 facet counts, F2 the Modern Classics rename, F3 mark the winner watched,
F4 reset the lineup on close, F5 lineup provenance, F6 Replace N,
F7 the seen-set, F8 the fetcher shrink guard, F10 docs.

F9 (streaming badge) moved to §5 — informational rather than urgent, and the
only piece with no bearing on whether the rest is correct.

### F1 — facet counts must respect the list selection

`poolFacets` (`server/pool.js`) still hardcodes `l.is_active = 1`. The §0
knock-on list caught `buildPoolQuery` and `sessions.js` and missed this one.

Consequence, measured: with only the Goya list selected (40 films), the genre
chips report **Drama 1671 · Comedy 644** and the total reads 2,455. The chip
counts, the year/runtime placeholder bounds, and the first-paint "N films
match" all describe the default pool rather than yours.

Fix: `poolFacets` takes the selected list ids, same as `buildPoolQuery` already
does. `draw.js` seeds `state.poolCount` from `facets.total`, so that call site
needs updating too.

### F2 — rename the "Crowd-Pleasers" list

It sorts by rating, so it returns acclaim, not crowd-pleasing: its lowest entry
rates 8.2 and it contains Parasite, a film already on the canon lists it was
meant to counterbalance. Something like "Modern Classics" is honest. The
genuinely reach-sorted list is a separate thing and is backlogged.

> **Trap:** `seed.mjs` matches lists by NAME. Renaming in the seed file alone
> would create a second list rather than rename the existing one. Needs an
> `UPDATE lists SET name = ...` migration, or a manual rename, before the seed
> file changes.

### F3 — mark the winner watched, from the results screen

The app picks a film and never learns whether it was watched. `watched` is only
ever set by hand from a card, so the watched-exclusion filter accumulates
nothing on its own.

### F4 — reset the lineup after voting closes

Once a session closes, the lineup that produced it is still staged; only
"← New lineup" clears it.

> **Trap:** `renderSessionPanel` is shared between the host screen and the
> History tab. Clearing on close must be gated to the host's *own live*
> session — opening an old session in History must never wipe the lineup being
> built. `draw.js`'s `showSession()` owns the lineup lifecycle, so pass a
> callback (`onClosed`) rather than clearing from inside the panel.

Also decide: should closing offer "re-vote with the same films"? If so, clear
on leaving the results screen rather than on close.

### F5 — lineup provenance

`lineup.add(movie, source)` where source is `'draw' | 'added'`. The lineup mixes
films that were drawn with films someone specifically asked for (search, paste,
manual, Explore). Zero schema cost — `lineup.js` is an in-memory singleton.

Prerequisite for F6.

### F6 — "Replace N"

Drew 2, don't like them, don't want to remove them by hand: `[Replace 2]`
redraws them in place. **Only swaps entries whose provenance is `'draw'`**, or
it throws away a deliberate pick.

### F7 — a seen-set so Replace moves forward

Replace excludes what is currently in the lineup, but not what has already been
rejected — so three clicks can hand back the film discarded on the first.
A session-scoped set of everything rejected, passed as `exclude` (already
supported by `drawFromPool`), makes repeated Replace cycle through fresh
options.

### F8 — a shrink guard on the fetchers

`fetch-seed-lists.mjs` writes whatever a source returns. A Wikidata hiccup that
yields 3 César films instead of 51 currently writes a 3-film seed file and
reports success; seeding it then shrinks the list.

The Sight & Sound and TSPDT scrapers have count thresholds already; the
Wikidata and Wikipedia-category fetchers have none. Add a declared minimum per
source plus a comparison against the `count` field already present in every
seed JSON, refusing to overwrite on a large shrink. ~15 lines, and it protects
every future fetcher including box office.

### F10 — docs sweep

`README.md` still says 13 lists (there are 16) and describes categories rather
than tags and vibes. `ROADMAP.md`'s own §1–§3 predate the tag/vibe model.
`BACKLOG.md`'s "short names as data" note is partly stale now that the tag
vocabulary exists.

## 5. v3

### Status

The in-flight view. **One axis only: distance from shipped.** An earlier version
of this table mixed that with "when was this decided", which produced two states
that meant the same thing.

| State | Meaning |
|---|---|
| 🗣 **discussing** | The approach is not settled. Do not build it yet — a decision is owed first, and it is recorded here when made. |
| ⏳ **ready** | Approach settled, work not started. Anyone can pick it up from what is written here without asking another question. |
| 🔨 **building** | In progress. |
| 👀 **review** | Written, tests green, not yet accepted. |
| ✅ **landed** | Done and accepted. Stays in the table for one version, then folds into the "done" section like §4. |

*Why the reasoning isn't a state:* what was decided and why lives in the
subsections below and in `BACKLOG.md`, next to the measurement that settled it.
The table only says how far along a thing is.

| Item | State | Where it stands |
|---|---|---|
| Seed-file `tags` no longer stripped by a re-fetch | ✅ landed | Was a live regression — Ghibli had already lost its tags |
| Award badges resolve on the `awards` tag, not `category` | ✅ landed | `category` had one reader left; now none |
| Six scan findings (§5.1) | ✅ landed | All six re-verified by execution before fixing, all six now covered by tests |
| Vocabulary divergences (§5.2) | 🗣 discussing | "occasion" vs "vibe" and five more; two need a product decision, not a rename |
| Split `fetchWikipediaCategoryAward` in three | ✅ landed | `fetchCategoryMembers` / `titlesToQids` / `qidsToFilms`; the award year is now an option, not baked in |
| "draw" (noun) → "vote" in UI strings | ✅ landed | Also fixed History pointing at "the Draw tab", renamed Lineup in v2 |
| Expand / collapse all lists in the picker | ✅ landed | Open/closed marker rule extracted to `isGroupOpen`/`setGroupOpen` + 5 tests |
| Box office — France | ✅ landed | 1,390 films seeded, 1390/1390 resolved, Top-N and draws verified against the real DB |
| Dynamic-list refresh refetches all 120 members daily | ✅ landed | Cached rows reused; the one test that matters fails against the old code |
| `GET /api/sessions` N+1 | ✅ landed | One join; verified same films, order and payload shape against the real DB |
| Streaming | ⏳ ready | **Link out, don't cache** — no column, no region config, no refresh change |
| Award years | ⏳ ready | Option C, far cheaper than feared — the ceremony wikilink carries the year in all three editions |
| Box office — Spain | 🗣 next version | No source exists on es.wikipedia; dropped from v3 until one is found |
| Award short names as data | ⏳ ready | |
| Award-winner filter | ⏳ ready | Unblocked by the tag fix above |
| `seed.mjs` keyed on `tmdb_id` | ⏳ ready | Additive key — severity was lower than assumed, see below |
| `includeWatched` default: README vs UI disagree | 🗣 revisit at F3 | No effect until something is marked watched; F3 starts doing that |

### 5.1 Scan findings — fix before any v3 feature

A full-stack scan turned these up outside the v3 scope. Every one was
re-verified by running code, not by reading. Ordered by severity.

1. **Applying a vibe aliases its filter objects** (`public/occasions.js:28` →
   `pool-state.js:105`). Both spreads are shallow, so
   `poolState.filters.genres` **is** `vibe.filters.genres`, and `browse.js`'s
   chip handler mutates it in place (`group.include.push(key)`). Verified:
   apply Family → click the Animation chip → apply Cinephile → apply Family, and
   Family now applies `{include:[16],exclude:[27]}` while the chip still reads
   "Family". `rangeInputs` does the same to any vibe carrying a year or runtime
   range — a saved "Seventies" vibe came back starting at 1995.
   Fix at `applyOccasion`, the single choke point, not at the call site.

2. **The Draw tab's "N films match" ignores every filter on remount**
   (`public/views/draw.js:82`). `refreshData()` seeds `state.poolCount` from
   `facets.total`, which `server/routes/draw.js:41` computes from the list
   selection alone — genres, year, runtime, topN and `includeWatched` are all
   dropped. Measured on the real library: Ghibli + year ≤ 1990 reports **23**
   against a real pool of **5**; TSPDT + top-100 reports **954** against **97**.
   It also gates the Draw button via `disabled: state.poolCount === 0`.

   Latent second half: `emptyFilters()` sends `includeWatched: true` while
   `normalizeFilters({})` defaults it to `false`. No effect today (nothing is
   marked watched) but it diverges the moment something is — measured 2406 vs
   2455 with 50 films marked.

3. **Explore repaints on every keystroke and drops focus**
   (`public/views/explore.js:140`, `:254`). `browse.js:450` documents the
   contract: *"range inputs and the checkbox must NOT be repainted."* `draw.js`
   honours it by calling `refreshCount()`; Explore calls
   `loadPage({reset:true})`, which paints synchronously at `explore.js:64`
   before its first await. `paint()`'s focus restore only covers
   `#explore-search`, so all five number inputs lose the caret after one digit.

4. **`INCOMPLETE` treats legitimately-empty TMDB fields as broken**
   (`server/refresh.js:22`). The comment directly above excludes `trailer_key`
   for precisely this reason; `countries` and `languages` have the same
   property. Verified against the live API: `getMovie(1578)` (*Raging Bull*) and
   `getMovie(637)` (*Life Is Beautiful*) both return `languages === null`, and
   1204194 returns null for both fields. Five rows therefore re-fetch every
   single day and, because of `ORDER BY ${INCOMPLETE} DESC`, permanently head
   the 250-row queue. `npm run backfill` reports "5 updated" forever without
   converging.

5. **One transient fetch failure permanently kills the poll**
   (`public/views/session.js:41`, `public/views/vote.js:41`). Both catch blocks
   replace the whole panel with a bare error and `clearInterval` with no retry:
   on the host screen a single dropped request wipes the QR code, link and live
   tally mid-movie-night; on a guest's phone it wipes the ballot they are
   ranking. Confirmed as a code path; how likely a blip is on a wired LAN is a
   judgement call, which is why it sits below the four measured ones.

6. **`PATCH /api/lists/:id` 500s on a duplicate name**
   (`server/routes/lists.js:87`). `POST /` guards this with a 400; PATCH does
   not, so it surfaces a raw `UNIQUE constraint failed: lists.name`. API-only
   today — no rename control exists in `views/lists.js`.

**Checked and clean**, worth recording so it isn't re-audited: every `public/`
module's imports resolve under the stubbed-DOM loop from `CLAUDE.md`; Borda
tally and tie-break; the TMDB semaphore's acquire/release handoff; LIKE-wildcard
escaping; the three-state `lists` convention; anonymity-on-write; and
`materialiseList`'s reconcile logic.

### 5.1b Wasted work, found by a caching scan (2026-07-30)

Two worth doing, one deliberately not. All confirmed by execution.

- **`materialiseList` re-downloads every member film, daily**
  (`server/dynamic-lists.js:79`). It calls `getMovie()` for each film the
  discover query returns with **no database check at all**. Measured: all 120
  "Modern Classics" members are already cached, complete, and were refreshed
  the same day — and tomorrow's job will fetch all 120 again. That is ~120 TMDB
  calls a day, ~44k a year, for rows the app already holds and its own policy
  considers good for 150 days.

  It is also a `for…of await` loop, so it **bypasses the 8-way semaphore** in
  `tmdb.js` — 120 sequential round trips rather than 15 batches.

  Fix: look the discovered ids up in `movies` first and only fetch the ones
  absent or genuinely stale. No staleness risk — it hands freshness back to
  `refreshStaleMovies`, which already owns it for the other 2,460 films.

  > Side effect to expect, and it is correct: those 120 stop having
  > `refreshed_at` bumped daily, so they start appearing in the normal 250-row
  > refresh queue like everything else.

- **`GET /api/sessions` is an N+1 that throws away most of what it fetches**
  (`server/routes/sessions.js:144`). Three queries per session — including two
  correlated `group_concat` subqueries for genres and list names — then `.map()`
  keeps four columns and discards the rest. Measured 8.2ms against 0.07ms for a
  single batched join, ~120×. Small at four sessions; it grows linearly with
  history, and the Pi is several times slower than the machine measured.

**Deliberately not doing: the QR image re-request.** `renderOpen` rebuilds the
`<img>` on every 3.5s poll and the route sends `no-store`, so it is re-requested
~340 times over a vote night. Measured 2ms and 1.6KB — below the bar. Kept here
only because the node is destroyed while guests are pointing phones at it;
whether that flickers was never confirmed. Revisit only if someone sees it.

### 5.2 Vocabulary — one concept, several words

A terminology audit of code, schema, API and docs. Recorded here because a
divergence that nobody writes down gets re-litigated every few months. Ranked by
how much confusion each can actually cause; the last two are not naming problems
at all and need a decision about what the thing *is*.

**Cheap and purely internal:**

- **"occasion" is "vibe".** The two are one function call apart: `applyVibe()`
  in `public/occasions.js` calls `poolState.applyOccasion()`. "Vibe" owns the
  schema (`vibes`, `vibe_tags`, `vibe_lists`), the API path, and **100% of the
  user-visible strings** — "Name this vibe", "Delete the X vibe?". "Occasion"
  appears in zero of them. It survives in the filename, `poolState.occasion`,
  `applyOccasion`, the `chip--occasion` CSS class, and §1/§3 of this file.
  ~25 sites, no schema, no API, no stored data, no user-visible text.

  > One caveat: §1's "occasion" is a **superset** — it includes the parametric
  > director/theme nights of §6, which the `vibes` schema cannot express. F10
  > declared §1–§3 stale but never rewrote them, so a cold session still reads
  > the wrong noun in the file that exists to stop exactly that.

- **"draw" (noun) means a published vote session, and is now factually wrong.**
  `history.js` says "past draw" and "No draws yet"; `sessions.js` errors say
  "Publish a draw with at least one movie". Since F5/F6 a lineup can be built
  entirely by search, paste, manual entry or Explore, so **a "past draw" can
  contain zero drawn films**. Worse, `history.js:23` points the user at "the
  Draw tab", which `app.js` has labelled **Lineup** since v2. Winner: "vote" in
  UI strings, `session` in code — both already dominate everywhere else.
  ~10 strings, cosmetic.

- **`source` means two things** — where a *list* came from, and how a *lineup
  film* got there. F5 already calls the latter "provenance"; renaming it is 6
  internal sites.

- **Dead `category`.** No readers left (§5.1 removed the last one) but three
  writers persist, and its schema comment is still the *first* thing in
  `SCHEMA` — presenting it as the live grouping mechanism, and claiming the
  picker renders "Uncategorised" where the picker actually says "Untagged". A
  cold reader hits that 160 lines before the tags comment. Dropping the column
  is a table rebuild and not worth it; rewriting the comment is free.

**Needs a decision about the concept, not the word:**

- **Is the list selection a filter?** The API says yes (`lists` and `topN` ride
  inside `filters`), the UI says no (they sit above the "Filters" card, under
  "Pool setup"), `clearFilters()` says no (it explicitly preserves `lists`, with
  a comment apologising for the name), and `describeFilters()` says maybe (takes
  list names as a *separate* argument, then writes them into a column called
  `filter_summary`). Each is defensible alone; together they mean nobody
  decided. **Settle this before renaming anything** — the rename follows the
  decision. Note the wide rename would be a breaking API change across four
  endpoints plus a stored column, so the internal-only half (`poolState.filters`
  → `poolState.setup`) is the affordable version.

- **`is_active` has three jobs**, and only §0's storage question was settled:
  a user preference, the server-side fallback when no selection is sent, and the
  seed for tonight's selection on first paint. Ticking it on the Lists tab also
  changes tonight's selection, so it is not purely a default. It also has **no
  user-visible name at all** — the checkbox that writes it is unlabelled, while
  Explore tells the user it browses "your active lists" when it actually reads
  the selection.

- **Two chip rows, same labels, different jobs.** The tag-filter row and the
  vibe row sit a few lines apart in the same panel, and the built-in vibes are
  named after the tags they resolve on. So the user sees a chip **"Awards"**
  that *selects* the awards lists, and a chip **"Awards 5"** that merely
  *narrows what the picker displays*. The tag row has no label. Genuinely
  conflated in the UI, not just in the naming.

  > **Deliberately left alone for now (decided 2026-07-30).** Changing it on
  > the strength of a code read would be guessing at a UI problem nobody has
  > actually hit. **Re-check after real use** — the question to answer then is
  > whether the two rows were ever confused in practice, not whether they look
  > confusable on paper. If they were, the fix is probably labelling the tag
  > row rather than moving either.

- **"Kind" of list means two different axes.** `lists.kind` is `seed|custom`
  (provenance). §1's "Kind" column means curated | dynamic | property-filter —
  the axis that actually drives the pool query, and which has no representation
  in the schema at all.

### 5.3 Box office France — spec, awaiting green light

**Goal.** A `Box-office France` list of films French audiences actually went to
see, tagged `box-office`, so a draw can reach *La Cité de la peur* and
*L'Aile ou la Cuisse* — the beloved-but-not-canon register that no rating metric
can surface. Evidence and the source comparison are in `BACKLOG.md`.

#### Source

`fr.wikipedia.org/wiki/Box-office France <year>`. **Verified: 82 pages,
1945–2026, no gaps in the range.** Each carries a wikitable of that year's
releases above some admissions threshold, with the film title as a wikilink.

Not the all-time page: it is cumulative and dominated by recent Hollywood.

#### What the survey found — the parser cannot be one regex

A first pass over 17 sampled years produced *plausible-looking wrong answers*,
which is the dangerous kind. Recorded so the real parser is not written the same
way:

| Symptom | Cause |
|---|---|
| 2008 parsed to 2 rows | admissions are `{{unité|20489303|entrées}}` — the extra parameter broke a regex expecting `{{unité|N}}` |
| 1998 listed *Jean-Marie Poiré* as a film | took the **first wikilink in the row**, which in that layout is the director |
| 1966 reported *Fantomas se déchaîne* at 0.1M (really ~4.5M) | took the **first number in the row**, which was not the admissions column |
| 1950, 1960 reported 0 French films | country marker absent or different in early years |

Three encodings of the same fact, all in live use:

```
country     {{FRA-d}}                                  (template)
            [[Fichier:Flag of France.svg|20px]]        (flag image)
            — absent entirely in the earliest years —
admissions  {{unité|N}}  {{unité|N|entrées}}  {{formatnum:N}}
column name Rang | Classement      Entrées | Box-office France
```

**Therefore: parse by column position, read from the table's own header row,
never by "first link" or "first number".** The header names vary too, so they
need a synonym map — built from data, not guessed.

#### Build order

- **Phase 0 — survey before parsing.** Fetch all 82 pages once, dump every
  table's header row, and build the synonym map from what is actually there.
  Cheap, and it turns every surprise above into a known case up front. Commit
  the survey output so the next person doesn't refetch 82 pages to see it.
- **Phase 1 — the fetcher.** `fetchWikipediaBoxOffice({ lang, pageTitle, ... })`,
  parameterised from the start even though France is its only caller: Spain will
  not reuse it, but a rewrite for the second country that *does* is worse than a
  few unused parameters. Depends on the `fetchWikipediaCategoryAward` split.
- **Phase 2 — resolution.** Wikilink → QID → TMDB id, via the extracted helpers.
  No fuzzy title matching anywhere.
- **Phase 3 — the list.** One seed file, `box-office` tag (already in `TAGS`).

#### Rules

- **Take every row the page lists.** No admissions threshold of our own — if a
  film was a hit that year, that is the qualification. The pages already apply
  their own cut.
- **Francophone by TMDB `original_language`, NOT by the country column**
  (decided 2026-07-30, after measurement reversed the first plan).

  The original rule was "any production country is French-speaking". Measured
  across all 82 years, that admits **69 films beyond French-produced ones, and
  they are almost all Hollywood blockbusters carrying Canadian co-production
  credits**:

  ```
  Dune, deuxième partie [USA/CAN] · X-Men 3 [USA/UK/Canada]
  Kung Fu Panda 2 [USA/Canada] · Man of Steel [USA/CAN/GBR]
  La Pat' Patrouille [USA/CAN] · La Planète des singes [USA/UK/Canada]
  ```

  The country column matches co-production paperwork, not francophone cinema.
  Genuine additions came to two 1945 Swiss films.

  `original_language` is free — every title is resolved to a TMDB id anyway,
  and `movies.original_language` is already what the app's own language filter
  uses, so the list agrees with the filter by construction. It also rescues the
  **183 rows that carry no country marker at all**, which skew French
  (*Le Viager*, *Le Grand Blond avec une chaussure noire*) and which a
  table-only rule would silently drop.

  > **The feared trade-off does not exist — measured 2026-07-30.** The worry
  > was that a French-*produced* film shot in English would drop out. It does
  > not: TMDB's `original_language` tracks the production's origin language,
  > not the spoken dialogue.
  >
  > ```
  > Léon                    English dialogue   original_language = fr  kept
  > Le Cinquième Élément    English dialogue   original_language = fr  kept
  > Le Grand Bleu           English/French     original_language = fr  kept
  > The Artist              silent/English     original_language = fr  kept
  > Dune  {USA, CAN}        English            original_language = en  dropped
  > ```
  >
  > So no country logic is needed at all, in either direction. A proposed
  > refinement — "exclude CAN + any non-francophone country" — was also
  > considered and is unnecessary: it infers language from co-production
  > paperwork, which is what `original_language` reads directly, and it would
  > wrongly admit an anglophone Canada-only production.
  >
  > Method note: the first check of this used hand-guessed TMDB ids and gave
  > the opposite answer, because `Le Dîner de cons` resolved to the US remake
  > *Dinner for Schmucks*. Look ids up; never type them from memory.

  > **The threshold, not the country rule, is the real limit.** Each page
  > carries its own cut — 2006's caption is *"Films sortis en 2006 ayant dépassé
  > 1 000 000 de spectateurs"*. So *Dikkenek* (2006, Belgian, ~350k admissions
  > in France) is **not reachable**, and no country rule changes that: it is a
  > cult film that was never a theatrical hit, exactly like *Le Père Noël est
  > une ordure*. Verified against the 2006 page. Worth stating plainly so the
  > absence isn't later mistaken for a bug in the country matching.
- **Rank, don't store admissions** (decided 2026-07-30). `list_movies` has no
  admissions column and nothing displays them, so the figure is used to order
  films within their year and written as `rank`. The Top-N control already
  understands `rank`, so "the top 20 of 1982" works with no new UI.
- **A weird year warns, it does not fail.** Agreed explicitly: if a year's row
  count looks nothing like its neighbours, print a loud warning naming the year
  and carry on with the other 81. The point is that a layout change gets
  *noticed* rather than silently swallowing a year — but one odd page must not
  cost the whole fetch. The existing seed-level shrink guard still applies to the
  finished list, so a mass failure is still refused at write time.

#### Parser traps, found by building it (2026-07-30)

The phase 0 survey said the corpus was uniform — all 82 pages carry `Titre`,
`Pays` and `Réalisateur`. That was right, and it corrected an earlier claim in
this file that 2008 and 2022 were "laid out differently"; they are not. What
actually bit was smaller and nastier:

- **`|+` is the table CAPTION, not a cell.** On the 2013+ pages the header row
  follows the caption with no `|-` between them, so counting it as a cell
  shifted every column index by one. This did not produce missing rows — it
  produced **wrong numbers that looked plausible**: 2022's *Avatar : La Voie de
  l'eau* came out at 2.7M against a real 14.0M. The single strongest argument
  for parsing by header position and then sanity-checking the result.
- **Pre-1970s pages use `[[Image:Flag of France.svg]]`**, not `Fichier:` or
  `File:`. Missing that left a third of all rows with no country at all.

Two more surfaced only once the finished list was eyeballed, and both are the
same species — a plausible number from the wrong place:

- **A citation URL became an admissions count.** `parseAdmissions`' bare-digit
  fallback matched the id inside
  `[http://www.boxofficestory.com/paris-1972-c23262779/2]`, giving three
  unrelated 1972 films **23,262,779 admissions each** — above *Bienvenue chez
  les Ch'tis*. Three different films landing on one impossible figure is what
  gave it away; nothing crashed.
- **A second table was parsed as the list.** Each page also carries
  *"Box-office parisien par semaine"*, whose header `Film {{n°}}1` normalises to
  `film 1` — which `startsWith` column matching accepted as the title column.
  Matching is now exact.

Tightening to exact matching then silently emptied **1976–1982**, because those
years write `Entrées<ref>Selon les sites…</ref>`: stripping the tags leaves the
footnote text glued to the column name.

Final: **3,668 film rows, 16–80 per year (median 42), only 1945 below 20** (16
rows, plausible for the first post-war year). The top of the list now reads
Titanic 20.6M · Ch'tis 20.5M · Intouchables 19.5M · La Grande Vadrouille 17.3M,
which are the real French all-time records.

> **The lesson worth keeping.** Four separate wrong-number bugs, and not one of
> them crashed, threw, or dropped a visible row. The per-year row-count alarm
> caught **none** of them — every one was found by looking at actual values and
> asking whether they could be true. A guard on volume does not substitute for
> checking that the numbers are sane; both are needed.

#### Iterating on this fetcher

A full run is 82 Wikipedia pages plus ~3,400 TMDB lookups, and every run after
the first re-downloads identical data. `SEED_CACHE_DIR` makes both reusable:

```
SEED_CACHE_DIR=.cache npm run fetch-seeds -- box-office
```

```
.cache/wiki/fr-Box-office_France_1972.wikitext   the raw pages
.cache/tmdb-language.json                        tmdb_id -> original_language
```

Two deliberate choices:

- **Off by default.** A committed seed file should come from a fresh fetch, and
  a cache that quietly served stale data would be a worse bug than the waste it
  saves. `.cache/` is gitignored.
- **The TMDB cache stores the ANSWER, not the response.** A `/movie` payload is
  tens of kilobytes and we need one field of it, so caching responses would mean
  ~120MB to avoid re-reading ~60KB of actual information. It also carries a
  timestamp and expires after 30 days — well inside the six-month cap TMDB's
  terms place on cached data, which is the same constraint that sets the app's
  own 150-day refresh cycle.

#### Result

**1,390 films, 1945–2026**, written to `seeds/box-office-france.json`. Verified:
ranks contiguous 1..N, no duplicate tmdb ids, every entry carries a tmdb id and
a year, and admissions do not leak into the committed file.

```
  1  2008  Bienvenue chez les Ch'tis        9  2006  Camping
  2  2011  Intouchables                    10  2000  Taxi 2
  3  1966  La Grande Vadrouille            11  1985  Trois hommes et un couffin
  4  2002  Astérix : Mission Cléopâtre     12  1958  Les Misérables
  5  1993  Les Visiteurs                   13  1962  La Guerre des boutons
  6  2014  Qu'est-ce qu'on a fait au…      14  2024  Le Comte de Monte-Cristo
  7  1965  Le Corniaud                     15  1998  Le Dîner de cons
  8  2024  Un p'tit truc en plus
```

Per decade: 1940s 60 · 1950s 198 · 1960s 229 · 1970s 222 · 1980s 180 ·
1990s 92 · 2000s 158 · 2010s 135 · 2020s 116. Era-balanced, which was the point
of choosing the per-year pages over the all-time one. Titanic and Avatar are
correctly absent — both were bigger in France than most of this list, and both
are English.

> Cosmetic, not a defect: some `title` values in the seed file are Wikidata's
> English labels (*The Sucker* for *Le Corniaud*). Nothing displays them — every
> entry carries a `tmdb_id`, so `resolveEntry` takes the id path and the movie
> row gets TMDB's own title. The seed title is only ever provenance.

**Seeded and verified** against the real database (2026-07-30), after backing
it up to `data/double-feature.db.pre-boxoffice`:

```
1390/1390 resolved, 0 needing review, 0 unmatched
pool 2,455 -> 3,731 distinct films
ranks 1..1390, so Top-N has something to cut
0 films with original_language != 'fr' got through
picker tag "Box office" appears, vibes unchanged
top 100 -> 100 films;  top 100 + 1960s -> 12;  comedy -> 767
draw from the top 60 returned Le Gendarme de Saint-Tropez, Manon des
Sources, Asterix: Mission Cleopatre
```

#### Open, to settle during the build

- What the earliest years (1945–1965) actually look like, and whether they carry
  a usable country column at all. If not, the list simply starts later — worth
  knowing, not worth blocking on.
- Whether admissions get stored. `list_movies` has no column for them, and
  nothing in the UI shows them. Cheapest honest answer is not to store them at
  all; rank by admissions within the year *at fetch time* and write it as `rank`,
  which the Top-N control already understands.

### Streaming — a link, not cached data

**Reversal of the plan above.** v3 originally specified a providers join table,
a region setting and a refresh cadence drop from 150 days to ~14. All of that is
now unnecessary: TMDB's own watch page is a public URL derivable from the id we
already store.

```
https://www.themoviedb.org/movie/346/watch      → 200, no API call, no key
```

Verified: the page is JustWatch-backed (TMDB's `watch/providers` `link` field
points at exactly this URL) and carries its own country selector, so the guest
picks their own region rather than the host baking one into `.env`.

What this deletes from the plan: the join table, `TMDB_WATCH_REGION`, the
150→14 day cadence change, and the whole staleness problem — provider data is
the fastest-rotting field in the API and this stores none of it.

What it costs: no at-a-glance "▸ MUBI" on the card; the answer is one click
away instead. Given the measured ~30% coverage, roughly seven in ten badges
would have been absent anyway, so the card was never going to carry this well.

> **Trap for whoever implements it:** the id is negated for TV-sourced entries
> and synthetic below −1,000,000,000 for manual ones. Reuse `tmdbUrl()` in
> `dom.js`, which already handles both, and render nothing at all when
> `is_manual` — a manual entry has no TMDB page to link to.

- **Box-office per country — France and Spain first.** National popularity
  cannot be derived from TMDB or IMDb: their vote counts measure international
  reach, so "France loves this" and "the world hasn't seen this" are the same
  number. Admissions tables on the per-country Wikipedia are the signal. Build
  it as one parameterised fetcher plus one `box-office` tag, never one fetcher
  per country. See `BACKLOG.md` for the measurements and open questions.
  - **Prerequisite:** extract `resolveTitlesToTmdb` (titles → QIDs → TMDB ids)
    out of `fetchWikipediaCategoryAward`, where it is currently entangled.
    Box-office reuses exactly that pipeline.
- **Award years via option C** — scrape each award's own Wikipedia article to
  fill the 28–39% coverage gap for BAFTA, César and Goya. Option B (deriving
  release year + 1) stays rejected: it silently mixes real and guessed data in
  one column.

  Two cheaper structural routes were probed first and **both are dead ends**,
  recorded so they aren't re-proposed:

  - *Wikidata ceremony items carry the winner.* They don't. Q115891338 (48th
    César Awards) has `P585` (the ceremony date) and `P179`/`P361` (its series),
    but **no `P1346` winner statement** — the winners are simply not modelled
    on the ceremony item.
  - *Per-ceremony Wikipedia categories.* Also no. A César winner's fr.wikipedia
    page carries `Catégorie:César du meilleur film` and per-*category* awards
    ("Film avec un César de la meilleure réalisation") but nothing per-year. The
    Goya page carries only the plain winners category.

  Option C is however **much cheaper than this roadmap assumed**, because all
  three editions share one invariant: the ceremony is a wikilink whose *display
  text is the year*.

  ```
  fr   * [[15e cérémonie des César|1990]] : '''''[[Trop belle pour toi]]'' …'''
  es     … [[Anexo:V edición de los Premios Goya|1990]] …
  en     {{center|'''1990'''<br>{{small|([[44th British Academy Film Awards|44th]])}}}}
  ```

  Only the winner-vs-nominee signal differs per edition, and in each it is
  unambiguous rather than a judgement call:

  | Edition | Winner marked by |
  |---|---|
  | fr (César) | **List depth** — winner at `*`, nominees at `**` |
  | en (BAFTA) | Table row with `background:#FAEB86` and bold-italic |
  | es (Goya) | Table, 6 wikitables on `Anexo:Premio Goya a la mejor película` |

  Note the Goya article title: `Premio Goya a la mejor película` is a redirect,
  and the API needs `redirects=1` or it returns a 51-character stub.

  Film identity comes from the wikilink → QID → TMDB id, the pipeline the award
  fetchers already use, so there is no fuzzy title matching anywhere.

  > **Self-check to build in:** a parsed ceremony year must land within a year or
  > two of `movies.year`. Anything further out is a mis-parse, and it should
  > refuse rather than write — the same instinct as the shrink guard.
- **Award short names as data.** `dom.js` carries a hardcoded map of list name →
  display name. A `lists.short_name` column would put it with the rest of the
  list metadata in the seed files.
- **Award-winner filter** — "only films that won something" as a pool filter,
  not just a badge. Cheap, since `awards` is already computed.
- **`seed.mjs` keyed on `tmdb_id`** rather than `raw_title + raw_year`.

  **The severity here was overstated.** "Rows re-resolve as new entries —
  duplicating" is not what happens for *resolved* rows: `recordEntry`
  (`server/movies.js:111`) looks the row up by `(list_id, tmdb_id)` before
  inserting and returns `duplicate`, and `list_movies_unique` enforces it at the
  schema level regardless. A changed title costs a wasted TMDB call, not a
  duplicate row.

  What is genuinely exposed is narrower:

  1. **Unresolved rows can duplicate.** `list_movies_unique` is a *partial*
     index (`WHERE tmdb_id IS NOT NULL`), so a `needs_review` entry whose
     `raw_title` changes in the seed file does get a second row.
  2. **`backfill-list-fields.mjs` matches on the same key**, so it would stop
     finding rows it needs to repair.
  3. Wasted TMDB calls on a re-seed after any title change.

  So this is a tidy-up, not a landmine. The safe shape is **additive**: key the
  skip-set on `tmdb_id` *when the entry carries one*, falling back to
  `raw_title + raw_year` when it doesn't. That strictly widens what gets
  skipped, so it cannot introduce a duplicate — and it needs the same change in
  `backfill-list-fields.mjs` or that script silently stops matching.

## 6. Deferred — but the design must not block them

**Director night.** Parametric occasion. Use `/person/{id}/movie_credits`
filtered to `job=Director` (not `with_crew`, see §2). Resolves to an ephemeral
dynamic list.

**Theme night.** Parametric occasion, keyword-based. Verified working:
`with_keywords=<christmas>` returns 306 films including *It's a Wonderful Life*,
*Klaus* and *The Apartment*. Keyword ids must be resolved via `/search/keyword`
first — you cannot query by string.

> Caveat: keywords are crowd-sourced and loose. The christmas query also returns
> *The Hunt* (2012), a Danish drama that merely contains a Christmas scene.
> Fine for inspiration, wrong for a strict promise.

Both are unblocked by exactly two decisions above: the **structured query
object** (§4.3) and the **`▾` parametric chip shape** (§3).

---

## 7. Not planned

- **Kids' night by certification** — killed on evidence, see §2.
- **TMDB Top Rated 100** — evaluated in v1 and dropped: 46% overlap with the
  existing pool, and the non-overlapping half was largely noise because
  `/movie/top_rated` has no vote-count floor. Superseded by §4.3.
- **Ballot-stuffing prevention** — out of scope by design; trusted-friend model.
- **Silent Era PSFL as a seed list** — an exhaustive reference database (24,500+
  films), not a curated "best of". Random draws from it would be a worse
  feature.
- **Per-person watched tracking** — would require accounts, which the whole app
  is designed around not having.
