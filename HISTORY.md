# History

Shipped work, kept for its reasoning. **Not part of the startup reading list** —
open it when you want to know *why* something is the way it is, and nothing more.

The durable conclusions from all of this already live in `DECISIONS.md`; what is
here is the working that produced them, plus the item-by-item record of what
each version actually did. Sections keep their original numbering so older
commit messages and cross-references still resolve.

> Some of the text below describes code as it stood when written, and parts of
> it are now wrong — `poolFacets` no longer hardcodes `is_active = 1`,
> `public/occasions.js` no longer exists, `lists.kind` is `lists.origin`. That
> is expected of an archive and is precisely why it was moved out of the path a
> session reads by default. Trust the code; trust `DECISIONS.md` for decisions.

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

---

## 5. v3 — done

Shipped 2026-07-30. Kept for the reasoning and the traps, which stay true; the
detail is in §5.1–§5.3 below.

**Fixes.** Seed-file `tags` no longer stripped by a re-fetch (a live regression
— Ghibli had already lost its). Award badges resolve on the `awards` tag, not
the dead `category` column. Six scan findings, each re-verified by execution
before being touched. Two pieces of repeated work removed: dynamic lists
re-downloading all 120 members daily, and the History N+1.

**Features.** Box office France (1,390 films, 1945–2026). Award years from the
ceremonies themselves — 104 gaps filled, 13 wrong values corrected. Streaming as
a link rather than cached data. Award short names as `lists.short_name`. An
award-winner pool filter. Expand/collapse all in the picker.

**Vocabulary.** A list selection is not a filter; an occasion is a vibe;
"draw" as a noun for a published session is a vote.

> **Traps that outlived the work.** `|+` is a table caption, not a cell.
> `pgrep -f` matches the watcher's own command line. A committed `.gitignore`
> rule (`data/*.db.*`) is the only thing keeping real ballots out of a public
> repo. And a note written to prevent a bug can cause it — §5.3's ceremony-year
> invariant was wrong for two of three editions.

---

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
  > director/theme nights of §7, which the `vibes` schema cannot express. F10
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

  > **Settled 2026-07-30 — see §6.6.** The second axis needed no representation,
  > because it was three separate things that each already had one:
  > `query_json IS NOT NULL`, tags, and a pool-query clause that was never a
  > list. The word "kind" is retired and the column becomes `origin`.

### 5.3 Box office France — the spec, and what building it changed

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
- **Award years via option C — ✅ landed 2026-07-30.** Coverage went 20→49/51
  (César), 29→77/78 (BAFTA), 11→38/40 (Goya): **104 gaps filled and 13 existing
  values corrected**, with 0 lost and no other field touched.

  **The year does NOT come from the article.** An earlier version of this
  section claimed all three editions "wikilink the ceremony with the year as
  the display text". That is true only of the César, and acting on it would
  have written systematically wrong years:

  | Edition | Ceremony markup | Printed year means |
  |---|---|---|
  | fr César | `[[15e cérémonie des César\|1990]]` | the ceremony ✅ |
  | en BAFTA | `'''1990'''` beside `[[44th British Academy Film Awards]]` | the **films**; the 44th was held 1991 |
  | es Goya | `[[Anexo:I edición…\|I edición - 1986]]` | the **films**; the I edición was held 1987 |

  The offset is not even constant — the **1st BAFTAs were held in 1949 and
  honoured 1947 releases**, a gap of two. Trusting the printed year would have
  reintroduced exactly the confidently-wrong-year failure that got "release year
  + 1" rejected.

  **What works: the article gives the winner, Wikidata's ceremony item gives the
  date.** Both halves were probed separately earlier and *both were written off*
  — ceremony items carry `P585` but no winner, and there are no per-ceremony
  categories. Neither is usable alone; together nothing is guessed:

  ```
  article  → 47th British Academy Film Awards → Schindler's List
  Wikidata → P585 on that ceremony            → 1994
  ```

  The one genuine invariant across all three editions: **the winner is a
  bold-italic wikilink** `'''''[[Film]]'''''` and the nominees around it never
  are. `CEREMONY_ANCHORS` holds the one per-edition regex, capturing the
  ceremony's page title — never a year.

  > **Why 13 existing values were overwritten rather than preserved.** They came
  > from `P585` on the *film's* award statement, which is inconsistently
  > populated and sometimes records the film's year: `Schindler's List` was
  > stored as 1993 against the 47th BAFTAs held in 1994. A ceremony item's own
  > date is the ceremony by definition, so it wins.

  > **The sanity gate is load-bearing.** A ceremony landing outside 0–3 years
  > after release is rejected, not written — the point of this route over a
  > derived year is a specific true fact, so a wrong one is worse than the
  > absent value it replaces. It rejected nothing on the real run, which is what
  > a good alarm looks like.

  Verified end to end: `Parasite` renders `Palme d'Or 2019 · Oscar 2020`, the
  per-award offset the schema comment exists to protect.

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

---

## 6.2 Box office — United States (deferred to v5)
> **Deferred to v5, decided 2026-07-30.** Everything below stands — the *axis*
> is settled and it still replaces the reach-sorted list, which is why that item
> stays dropped. What is missing is a **source**: France had 82 verified per-year
> Wikipedia pages, and no US equivalent has been probed. That plus the unresolved
> dollars-vs-admissions question is two open ends on an item v4 does not need,
> while Spain, IMDb and the two dynamic-list fixes are all ready. Kept here rather
> than moved, because the reasoning is what stops the reach-sorted list being
> re-proposed.

**The reach-sorted list is dropped as a separate item.** It was described as a
third axis — "box office surfaces *Ch'tis*, reach surfaces *Ace Ventura*" — and
that framing does not survive contact with the numbers.

*Ace Ventura* **was** a US box-office hit: roughly $72M domestic in 1994, around
thirteenth for the year. It sits comfortably in any per-year US box-office list.
So the film used to justify a separate reach axis is reached by ordinary box
office, and the axis is not needed to get it.

What the three measures actually are:

| Measure | What it counts | Reaches |
|---|---|---|
| **Acclaim** | rating, with a vote floor | Parasite, Portrait de la jeune fille en feu |
| **Box office** | tickets sold, one country, one year | Ch'tis, Ace Ventura, Le Corniaud |
| **"Reach"** (vote counts) | how many people *rated* it, ever | mostly anglophone films |

The third is the weak one, and `BACKLOG.md` already measured why: *Le Père Noël
est une ordure* has 11,588 IMDb votes **not because it is obscure but because it
never left France**. Vote-count reach measures *anglophone* familiarity, so as a
"popularity" axis it is a worse-sourced restatement of "was this film big in
America" — which US box office answers directly and honestly.

**So: extend box office to the US.** Same fetcher shape, a new source, one more
`box-office` list.

> **One genuine difference from France, and it needs a decision during the
> build.** French per-year pages give **admissions**, which are immune to ticket
> price inflation. US sources give **gross in dollars**, which are not. Within a
> single year that does not matter, so a per-year list is safe; a *global* rank
> across decades would put 2019 above 1975 for reasons that have nothing to do
> with how many people went. Either rank per-year, or find an admissions-adjusted
> source, or state plainly on the list that it ranks dollars.

**What is genuinely left over** once box office covers France, Spain and the US
is the thing box office structurally cannot see: films whose fame arrived
*after* the cinema, through television and home video. *Le Père Noël est une
ordure* is the canonical case — a modest theatrical run and total cultural
saturation. That is **cultness**, it is a real axis, and it is **v5**. It is not
the same thing as reach, and it will need its own evidence before it gets built.

---

## 6.4 The two dynamic-list gaps — landed in v4
Both were logged as "no such list exists yet". v4 creates such lists, so both
become live. Plain-language versions, since neither is obvious from its title:

**"`dynamic` the mechanism vs `dynamic` the tag."** A list is *query-backed*
when `lists.query_json` is set — that is the mechanism, and it is what makes
"Modern Classics" re-derive itself instead of needing a re-seed. Separately,
lists carry **tags**, and one of those tags is also called `dynamic`; the
"Modern Classics" vibe resolves on it.

Today there is exactly one query-backed list and it is the only list tagged
`dynamic`, so the two coincide and nothing misbehaves. The moment national
cinema night adds a second query-backed list, tagging it `dynamic` would sweep
it into the **Modern Classics vibe** — a vibe about recent acclaim would
silently start including Japanese cinema. The tag is doing two jobs: "this
updates itself" and "this belongs to the modern-classics family".

~~Fix: the vibe pins its list explicitly, and `dynamic` as a tag becomes purely
descriptive.~~

> **That fix would not have worked — corrected 2026-07-30, during the build.**
> Pinning is **additive**, not a replacement: `resolveVibe`
> (`server/vibes.js:43-54`) returns `tag matches ∪ pinned lists`. Keeping
> `tags: ['dynamic']` and pinning list 17 alongside it would have left every
> future query-backed list joining the vibe exactly as before. The schema
> comment says as much — *"a vibe draws on tags, on specific lists, or both, and
> resolves to the union"* — which is why the wrong fix reads plausibly.

**What was done instead: the tag keeps its job and changes its meaning.**
`dynamic` was doing two at once — "this updates itself" and "this belongs to the
modern-classics family" — so it was renamed to the second, `modern`
(*"Modern classics"*). The vibe stays **tag-driven**, which preserves the
property tags exist for: a second recent-acclaim list should join on its own.
The mechanism half needs no tag at all, because `query_json IS NOT NULL` answers
it exactly and is what `findDynamicLists` has always used.

> **Confirmed 2026-07-30: `modern` is the name.** Recorded because it was a
> naming call made mid-build, which is the failure mode `category` vs `tag` came
> from. Every tag in `TAGS` now names a *family* and none names a mechanism —
> that invariant is the thing to protect, more than the particular word.

> **A migration was required, not just a seed-file edit**, for a reason that is
> not obvious: `ensureBuiltinVibes` skips any vibe whose **name** already
> exists, so editing `BUILTIN_VIBES` is a no-op on every database that has
> booted once. The Modern Classics vibe would have gone on resolving against a
> tag nothing carried, and selected no lists at all. See `retagDynamicAsModern`
> in `server/db.js`.

> **One visible loss, and where it should come back from.** The picker no longer
> shows an "Auto-updating" tag chip. If that information is wanted, it belongs
> to `query_json IS NOT NULL` as a per-list badge — never again as a tag.

**"`materialiseList`: write rank, and wrap in a transaction."**
Re-running a query-backed list *reconciles* rather than rebuilds: rows already
present are kept, new ones inserted, departed ones deleted. It never **updates**
a row that stayed.

> **Corrected 2026-07-30 — this was logged wrongly, and the fix is bigger than
> the entry claimed.** The original wording said rank *"is written once, at first
> materialisation, and never again"*. It is not written at all. The insert is
> `INSERT INTO list_movies (list_id, tmdb_id, raw_title, raw_year, status)` —
> there is no rank column in it, and `rank` does not appear anywhere in
> `server/dynamic-lists.js`. Verified against the real database: Modern Classics
> has **120 rows and 0 ranks**, against 1000/1000 for TSPDT and 1390/1390 for
> Box-office France.
>
> So the job is not "update rank on reconcile" — it is **write rank in the first
> place, from the discover result order, and then keep it correct when membership
> moves**. The knock-on worth naming: that makes `discoverMovies`' sort order
> semantically load-bearing, which it currently is not. A list ranked by
> `popularity.desc` means something; one ranked by whatever discover happened to
> return does not.

Without it a *ranked* dynamic list would have no ranks at all on day one, and
then frozen ones if they were written naively — a film ranked #5 last year still
reading #5 after dropping to #40. **National cinema night ranked by popularity is
exactly such a list**, so this lands first.

The transaction half is smaller: the insert/delete loop is not atomic, so a
crash mid-run leaves the list half-updated. It self-heals on the next run, but a
draw in between would be made from a list that never existed.

---

## 6.6 "Kind" of list — the word is retired, landed in v4
**Decided 2026-07-30.** The question was which of two meanings `kind` should
carry: `lists.kind` is `seed|custom` (provenance), while §1's table used "Kind"
for curated | dynamic | property-filter. The answer is neither — **there is no
missing axis to name.** All three things §1 called a kind already have a home,
and none of them is the `kind` column:

| §1 called it | Where it actually lives | Status |
|---|---|---|
| curated vs **dynamic** | `query_json IS NOT NULL` | already exact — §6.4 says so itself |
| **property filter** | `buildPoolQuery` clauses | never was a list; it has no row in `lists` and never will |
| the *family* (canon, awards, box-office, national) | `list_tags` | already the picker's grouping mechanism |

So the third kind the schema supposedly had no word for does not exist.
National cinema night does not add one; it adds a **second query-backed list**,
which is what §6.4 is about. Defining "kind" would have created a fourth
overlapping vocabulary next to `category` — the column §5.2 records as dead
precisely because it duplicated tags.

**The work — ✅ landed 2026-07-30.** The column is renamed `kind` → `origin`, so
the surviving concept says what it is. Seven call sites, one of them
user-visible:

```
server/routes/lists.js:45    ORDER BY l.origin DESC, l.name
server/routes/lists.js:75    INSERT INTO lists (name, origin, is_active) VALUES (?, 'custom', 0)
server/routes/lists.js:117   list.origin === 'seed'  -> deletion needs ?force=true
public/views/lists.js:66     first 'custom' list is the default selection
public/views/lists.js:527    renders the raw value in a badge-origin chip
public/views/lists.js:539    force-delete gate, mirrors routes/lists.js:117
scripts/seed.mjs:46          INSERT INTO lists (name, origin, category, ...)
```

> **The seventh site nearly got missed, and the reason is worth keeping.**
> This section originally said *six*. `grep -rn kind scripts/` returned
> **nothing** for `scripts/seed.mjs` — not because the string was absent but
> because the file draws a progress bar with box-drawing and symbol characters,
> so grep classifies it as binary and reports matches only as
> *"binary file matches"*, or in a pipeline, silently drops them. **Use
> `grep -a` when sweeping this repo**, or the seeder is invisible. A missed
> rename there would not have failed a single test — no test exercises
> `seed.mjs` — and would have surfaced as a broken `npm run seed` much later.
>
> Migration: `ALTER TABLE lists RENAME COLUMN kind TO origin`, guarded both
> ways. `CREATE TABLE IF NOT EXISTS` never alters an existing table, so without
> it every database that had booted once would keep `kind` and every query
> against `origin` would fail. Verified on a copy of the real database: the
> column renames, all 17 rows keep `seed`, and `/api/lists` returns `origin`.

> **Traps for whoever does it.** The badge at `views/lists.js:527` prints the
> *value*, so `seed`/`custom` stay on screen unchanged and the rename is
> invisible to the user — that is the point, and it is also why a careless
> find-and-replace on the string "kind" would break the `badge-kind` CSS class
> and `toast(message, kind)` in `dom.js`, neither of which has anything to do
> with lists. Rename the column and its six call sites, nothing else.
>
> `parseListQuery` also has a field called `kind` (`{kind, params, limit}`,
> always `'discover'`). **Leave it alone** — it is the query's kind, not the
> list's, and it is the hook a parametric vibe injects into. Renaming it would
> undo the very distinction this decision draws.
>
> And per `CLAUDE.md`: the schema lives in one template literal in
> `server/db.js`, so no backticks in any comment written near it.

---

## 6.7 The guest vote route 404 — landed in v4
Found by running the app out of a git worktree at
`.claude/worktrees/…` on 2026-07-30. The host UI worked; `/vote/abc` returned
**404**. Same file, same handler, two different mechanisms reaching it:

```
GET /          200   served by express.static, which has a root set
GET /vote/abc  404   served by res.sendFile(<absolute path>), which does not
```

`send` applies its `dotfiles` rule to the path **relative to `root`**. Static
sets one, so it checks `index.html` and passes. `sendFile` here is called with a
bare absolute path and no `root`, so the whole path is checked, `.claude` is seen
as a dot component, and the default `dotfiles: 'ignore'` turns a file that
plainly exists into a 404.

**Fix** — give `sendFile` a root, in `server/index.js`:

```js
const index = (req, res) => res.sendFile('index.html', { root: join(ROOT, 'public') });
```

> **Why this is worth fixing rather than filing as an artefact of how it was
> found.** It is latent in a normal checkout, so no test on a normal path can
> catch it — `test/api.test.js`'s *"the SPA is served for the guest route"*
> passes there and fails from a dotted directory, which is the only reason
> anyone saw it. But it is the route **guests** load on their phones, its
> failure mode is a blank 404 rather than an error, and any deployment under a
> dotted directory hits it. The host screen would keep working, so the QR code
> would look fine and only the guests would be broken.

---

---

---

## 7. v4 — done

Shipped 2026-08-01, 41 chunks. Kept for the reasoning and the traps.

**Features.** Box-office España from the ICAA register (1,567 films, 1945–2026).
IMDb ratings beside TMDB's, joined exactly on `imdb_id`. Director night as the
first parametric vibe, with a `▾` chip and a reusable slot list. Country as a
pool filter. Both a per-year and an overall rank on every box-office list.

**Fixes.** The guest vote route 404ing under any dotted install path. The
`dynamic` tag doing two jobs at once. `materialiseList` never writing rank at
all. `seed.mjs` keyed on `tmdb_id`. `lists.kind` renamed to `lists.origin`.

**Protections.** The database is snapshotted before migrations run. The upgrade
path has tests. The test suite is hermetic — no credentials, no network.

**Process.** The knowledge base split by durability: startup reading fell from
2,062 lines to 668. `NOTES.md` became the inbox. Reports moved from
session-end to chunk-end.

### 7.1 The lesson v4 actually taught

Every serious problem this version hit had the same shape: **a source or a
routine that answered successfully with less than it had.** None failed. None
threw. Each produced a plausible number that a guard then approved.

```
ICAA served box office only in the Spanish locale — English pages, HTTP 200, no figures
ICAA pagination re-served page 1 without a session cookie AND an XHR header
TMDB's response omits the alternative title that produced the match
Lumiere's XLSX export returns metadata, correct MIME type, zero admissions
A per-film catch turned fetch failures into "no admissions", deleting six years
recordEntry dropped rank on unresolved rows — 98 of 1,567
```

The match-rate floor is the sharpest case. It correctly refused a seed at
89.9%, then passed at exactly 90.0% — on a list where *8 Apellidos Vascos*, the
biggest Spanish film ever made, was unmatched along with three other #1s of
their year. **A number can pass a test the thing it describes would fail.** The
round that fixed it was run because the *unmatched list* looked wrong, not
because the rate did.

Every one of these was caught by a count that did not add up — 81 rank-1 rows
against 82 years, 24 films in every year, 1,450 films where 1,570 were
expected — and only because someone looked. Volume guards and rate guards sit
downstream of the failure; they cannot see a wrong answer that arrives in the
right shape.

> **The asymmetry worth carrying into v5.** An unmatched entry is visible and
> fixable — it sits in a reconciliation queue. A *wrongly* matched entry is
> `resolved`, invisible, and permanent, because that screen only shows rows
> that failed. So the match rate guards the recoverable failure while nothing
> guards the unrecoverable one. Measured false-positive rate on the Spanish
> list was about 3–4% before the language preference; it is unmeasured after.

---

## 8. v5

### 8.1 The vibe row: deselect, and delete somewhere deliberate

A ✕ sat against the active vibe chip and deleted the vibe. Reported from real
use as a button too risky to sit there, and that reading is correct: beside an
active selection, the only thing a ✕ plausibly announces is "clear this
selection". Its obvious meaning and its real effect were different, and the
price of the confusion was a saved vibe destroyed by someone reaching to
unselect one.

The two meanings are now separate controls. Clicking an active chip deselects
it — the reading the ✕ was falsely offering, attached to something that means
it. Deletion moved behind an Edit toggle, where every chip is a delete button
at once, because a single dangerous chip sitting in a row of ordinary ones
would be the same trap rebuilt.

**Deselecting had to undo the vibe, not just drop its label.** Dropping the
label is one line and wrong: the row would go quiet while the pool that vibe
built stayed in play, leaving a Custom pool nobody customised. It returns to
the app default instead — the lists the Lists tab marks active, no filters, no
top-N — so there is one "no vibe" state rather than one per vibe you happened
to leave from.

Two consequences that were not obvious going in:

- **Deleting a vibe no longer always means deleting the active one.** The old ✕
  only rendered on the active chip, so clearing the vibe label on delete was
  unconditional and correct. Edit mode can delete any chip, so that had to be
  gated — otherwise deleting an unused vibe would silently un-label the one
  still applied.
- **A parametric vibe cannot use click-to-deselect.** Its chip carries a ▾ and
  promises a chooser, so clicking it must keep opening the picker. Without
  something else it would have become the one kind of vibe with no way out, so
  the picker carries its own Clear whenever that vibe is the one in play.

### 8.2 Applying a vibe no longer unfolds Pool setup

**A reversal.** It opened the panel on the reasoning that a vibe changes the
whole pool, so the host should see what it did rather than take a summary on
faith. Use disagreed: the point of a vibe is not having to look, and unfolding
the panel every time buried the Draw button under a control surface nobody
asked for. The count under the button already reports the change, and the panel
is one click away.

The comment that carried the original reasoning was rewritten in place rather
than deleted, so the next reader finds out it was tried and why it lost.

### 8.3 One rating leads, the other goes to hover

Both scores sat on the same line — `★ 6.9 · IMDb 7.3` — which asks the reader
to arbitrate between two authorities before they can read a film's score at
all. Two numbers competing for one glance means neither gets it.

So the preference **orders** the two rather than selecting one, and that
distinction is the whole design. Selecting would blank the line on the ~27% of
this library with no IMDb score; ordering falls through to whichever exists. A
film with both leads with your choice and carries the other on hover; a film
with one shows that one and offers no hover, which is the same rule the
streaming link already follows — absent means "not enough votes", never "badly
rated".

**The vote count is gone from the display.** It hung off the IMDb score alone,
which made the two read as different *kinds* of number, and it answered a
question nobody asks while choosing a film. The vote floor still does the job
it was added for, silently.

Two things fell out of doing it once instead of three times. The rating markup
was duplicated across the card, the detail overlay and the vote screen — and
the vote screen had quietly never shown IMDb at all, so guests ranking films
saw a different number from the host who drew them. Sharing one helper settled
that as a side effect. The decision half is a pure function, so it is tested
without a DOM; the node half is a one-liner around it.

### 8.4 Country chips say USA, not United States of America

A display map with a fall-through, not a translation of the data: the filter
still keys on the full name, `movies.countries` still stores it, and the full
name is on hover.

**Deliberately not ISO codes for everything**, which is what the roadmap row
literally asked for. A row reading `FR · US · IT · GB · DE · JP · BE · ES` is
uniformly compact and uniformly unreadable — "CH" and "SE" are guesses for most
people, and "France" was never the problem. Only the names that actually
overflow are shortened, in the form people say rather than the form a standard
prescribes. Seven entries cover it, and anything unlisted renders as itself.

### 8.5 Cannes Grand Prix — a second bite at Cannes

Configuration, as the roadmap promised: a QID, a slug, and the same `P166`
route every other Wikidata award uses. 63 films, **100% carrying a TMDB id**,
so no matching problem at all.

**The QID was settled by counting films, not by reading names**, which the
`Golden Bear` note already warned is necessary — a label search for "Grand
Prix" returns a 1982 video game first, and three other festivals award a grand
prix of their own. Q844804 is the one that returns 63 films.

Worth having, and measurably so: **only one of the 63 also holds a Palme
d'Or**, so this is 62 films the Cannes axis could not previously reach. That is
the opposite of the Palme's own note, which records 58% redundancy against a
canon-heavy library and admits it was included for the axis rather than the
additions.

**The name is historically overloaded and the list reflects it.** Before 1955,
and again in the 1960s, the top prize at Cannes was itself called the Grand
Prix — which is why *The Third Man* (1949) is the oldest entry. An old row here
means "top prize of its year", not "runner-up", and the seed note says so.

### 8.6 Actor's night — not director night with the job swapped

The roadmap said this was director night with `job` swapped, and that the chip,
the slot list and `applyParameter` all already took a `param.job`. The plumbing
half was right. The TMDB half was wrong, and it would have shipped an empty
night.

**Acting is not a crew job.** It lives in the `cast` array, and `job ===
'Acting'` matches **zero** crew entries — measured live, where Toshiro Mifune
returns 167 cast credits against 13 crew ones, and those thirteen are producer
credits plus a single directing one. Swapping the string in the existing crew
filter returns nothing at all: no error, no films, just a night that quietly
does not exist. So the job now selects a *function* rather than a filter value.

**The billing cut is the `with_crew` argument at the other end of the credits.**
`with_crew` was rejected for directors because it counted any crew role and
returned Kurosawa as an assistant director on other people's films. The cast
array fails identically in the opposite direction: Mifune is billed 127th in
*Port Arthur*, which is not a Mifune film in any sense a viewer would mean. Top
ten billing is the honest reading of "their film".

Ten is loose on purpose rather than tuned. Measured across four actors it keeps
83–97% of a filmography, and `order` was present on **every** credit, so the
rule loses nothing to missing data. Mifune resolves to 150 films of 167, which
is exactly what the measurement predicted before the code existed.

### 8.7 Box office — United States

818 films, all carrying a TMDB id, ranked within their chart year. The last
country on the box-office axis.

**The plan was wrong in two ways, and both would have produced a plausible
list rather than a broken one** — which is the failure mode this project keeps
meeting.

*First, modern pages carry TWO annual tables.* "Calendar Gross" is what a film
earned **during** that year; "In-Year Release" is films **released** in it. A
December release earns its money the following January, so the two disagree —
*Ghost* tops 1990's calendar, *Home Alone* tops 1990's releases. Neither is
wrong; they answer different questions. This list takes the release-year table,
because that is the rule Box-office France already follows and a list has to
mean one thing.

*Second, the gaps were three times as wide as recorded.* Not 1946 and 1975 but
1946, 1948, 1975, 1976, 1977 and 1979 — verified by reading those pages, not
inferred from a parser returning nothing, which would have been the same
observation with none of the confidence.

**The weekly number-one table is never used.** It is a membership test rather
than a magnitude: a film that sat at #2 all year is excluded while one that won
a quiet January weekend is in.

**`overall_rank` is deliberately absent, departing from France and Spain.**
Those rank on admissions, which count people and therefore compare across
eighty years. This source has only money — rentals before about 1980, domestic
gross after, neither inflation-adjusted. An all-time ranking would sort 2019
above 1975 for reasons that have nothing to do with how many people went, and
would do it silently under a column promising otherwise. Within-year is the
whole of what the data supports, and a top-3 cut still selects 233 films across
78 years, which is the era balance the per-year rank exists to give.

**Four of the six gaps were recovered from `<year> in film`.** That source was
rejected for the main route because its tables switch to worldwide gross in
1988 — a reason that does not reach years ending in 1979. The fallback is gated
on the section naming the United States, so 1975, whose only chart is headed
"Worldwide gross", is refused by the same rule that admits the others rather
than by a hardcoded exception. *Star Wars* and *Rocky* came back; *Jaws* and
*Alien* did not, and the seed note says so in those words.

**Exact header matching lost seven years before anyone noticed a number.** The
first matcher accepted "gross" and "rental" and silently dropped 1968-1974,
whose pages write the unit into the column name as `Gross ($)`. Found by a
count that did not add up, again. The synonym list is now read off the corpus,
and rental outranks a bare gross chart so 1969 and 1970 stay on the same
measure as the rest of their era.

### 8.8 A cached re-run of a fetcher, in 16 seconds instead of three minutes

Raised from use: re-running a fetcher cost an afternoon. Two causes, and the
smaller one was the one that looked like the problem.

The identity steps — page title to QID, QID to TMDB id — had no cache, so
iterating on a *parser* re-resolved 800 titles through two APIs every run. They
have one now, with **no expiry**: the entire reason this pipeline resolves
through identifiers rather than titles is that identifiers do not drift. Misses
are cached too, as null, so a title that resolves to nothing is not re-asked
forever.

The larger waste was dumber. Each per-year loop carried `await sleep(1500)` for
politeness, and it fired whether or not a request had actually happened — so a
fully cached run of an 81-year source spent three minutes sleeping between
reads of local files. The throttle moved into `fetchWikitext`, where it runs
only on a real network fetch. **3m11s to 16s, with byte-identical output across
runs.** Throttle the thing being throttled, not the loop around it.

### 8.9 The card's meta line stops breaking badly

Two field notes, one cause, and the cause was packing a wrapping line into a
single string.

`keepNameTogether` (v4) makes a director's name unbreakable, which fixed names
splitting mid-word but meant a long name now moves to the next line **whole**,
stranding the separator behind it: `1994 ·` with nothing after it. Worse, the
rating span's own text began with `" · "` and carried `white-space: nowrap`, so
the line could not break before the rating either — with *Estibaliz Urresola
Solaguren* it was pushed past the card's edge and clipped, leaving a bare star
and no number. A film's score, silently gone.

Both are properties of the string, not of the names. The line is now a wrapping
flex row of items:

- **The rating is its own item**, so a line break happens *before* it rather
  than through it. It can no longer be pushed out of the card.
- **The separator is drawn in CSS on the item that FOLLOWS it**, so it travels
  with that item. It can appear at the start of a wrapped line, which reads as
  a continuation; it can no longer be left dangling at the end of one, which
  reads as missing text.

`white-space: nowrap` stays on the rating — it keeps `★ 7.9` from splitting
between star and number — and is now safe, because the break happens at the
item boundary instead.

### 8.10 "Custom" stops looking like a chip

Reported from use: *what does "Custom" do? it's not clickable.* Correct on both
counts — it is a readout saying no vibe is applied and this pool was built by
hand, and it was sitting at the end of a row of pressable chips at the same
size. Anything in that row reads as a control, because everything else in it is
one.

It moves onto the field label — "Tonight is… — custom" — where it cannot be
mistaken for either a chip or a button. Edit mode's "pick one to delete" moved
with it for the same reason.

### 8.11 A parametric list CAN be ranked, and the blocker was never mechanism

Investigated, not built — the build is v6. `applyParameter` omits `rank` from
its insert, so slot rows are NULL, and `rank IS NULL` already means "not
ranked" rather than "excluded", so Top-N correctly leaves director night alone
today.

Ranking is also *safer* here than on a query-backed list. The v4 hazard was
that `materialiseList` reconciles and never updates a row that stayed, freezing
ranks while membership moved. A slot list has no such path: every apply wipes
and rewrites it, so ranks would be recomputed by construction.

What actually blocked it was meaning. Chronological rank would make "top 10"
mean "his first ten films", which is what the code comment says and why it was
left NULL. **Rating is a meaning that works** — "the top 10 Kurosawa" is a real
question, and `movies` already caches both scores. The condition is a vote
floor: sorting a filmography by raw rating puts an obscure early title with a
handful of votes at #1, which is precisely why TMDB Top Rated 100 was dropped
and why Modern Classics needed 5,000 votes.

### 8.12 Award badges say the year the award is called by

The item was filed as real work — scrape the honoured year from each ceremony
article, add a column, migrate, backfill. It turned out to be a display
transform, because v3 had already scraped the thing it needed.

The database stores the **ceremony year**, and that stays the truth. What
changed is only how it is spoken:

| Award | Stored | Shown |
|---|---|---|
| Oscars, BAFTA, Goya | 1997 | 1996 — academies name the award for the films |
| César | 2012 | 2012 — French usage names it for the ceremony |
| Cannes, Venice, Berlin | 2019 | 2019 — festivals award within the year |

**The distinction that nearly lost this item** is that `DECISIONS.md` rejects a
derived award year — but that rejection is about deriving from the *release*
year, which genuinely is unsafe: TMDB dates *Nomadland* 2021 while every awards
body honoured it as a 2020 film, and *The Graduate* is a 1967 film BAFTA
honoured in 1969 because it reached UK cinemas in 1968. Deriving from the
*ceremony* year is arithmetic on a scraped fact. The two read alike and are not
alike, so the reversal now says which is which.

Measured across the real library before writing any of it: the constant holds
for every award from the mid-1930s onward. **The known exception is the 1st
BAFTAs**, held 1949 for 1947 releases — a two-year gap — so that ceremony shows
no year at all rather than a confident 1948. It affects one film here, *The
Best Years of Our Lives*. Pre-1935 Academy Awards covered spans rather than
calendar years and are left as they fall, because "Oscar 1928" is how the first
ceremony is normally cited.

283 badges shift by a year. *Burnt by the Sun* — the film that raised this from
field notes — now reads `Oscar Intl. 1994` beside its `Grand Prix 1994`, which
was the complaint: one film, one year, two awards that used to disagree.

An unknown award defaults to no shift, so a festival list added later is right
without touching the rules and only a new academy award needs a line.

### 8.13 A research probe was seeded as a real list

`seeds/icaa-1945-2026.probe.json` was an artifact of v4's Spanish work and had
been sitting in `seeds/`, which is the only thing that decides what becomes a
list. `seed.mjs` reads the whole directory, so it was seeded as an **active,
user-visible list of 1,568 films** named after its own filename — it carries no
`name` field, and the loader falls back to the basename. It sat beside
Box-office España, with which it shared 1,409 films, so Spanish box-office
films were in the draw pool twice.

Moved to `docs/evidence/`, where the rest of that measurement already lives.
The loader now also refuses `*.probe.json`, because a convention about where to
put a file is not a guard, and the directory listing is what actually decides.

### 8.14 Closing v5

Nine chunks. The box-office axis finished with the United States, Cannes gained
its second list, actor's night joined director night, and five things reported
from actually using the app were fixed — the vibe row, the ratings, the country
chips, the card's meta line, and the award badge years.

**What v5 taught, and it is one lesson in three costumes: the thing that looks
like the work is often not the work.**

*Actor's night* was filed as "director night with `job` swapped". The plumbing
half was right and the data half was wrong — acting is not a crew job, and
building it as written would have shipped an empty night with no error at all.

*Award badge years* was filed as a scrape, a column, a migration and a
backfill. It was a display transform, because v3 had already scraped the fact
it needed. The item had been sized by a reversal in `DECISIONS.md` that rejects
deriving an award year — from the *release* year, which is a different and
genuinely unsafe operation. Two sentences that read alike, one filed as months
of work.

*Box-office US* was filed as one source with two documented gaps. It was two
sources, six gaps, and — found only after shipping it once — two different
definitions of what a year's chart means.

In each case the plan was written by someone who had read the source and not
yet touched it, which is the normal condition of a plan. What caught all three
was the same habit: measure before building, and inspect the values rather than
the counts.

**The sharpest instance is the one that got past the first pass.** Box-office
US shipped with calendar-year ranks before 1982 and release-year ranks after,
and every check it had said fine: 784 films, all resolved, empty review queue,
spot-checked #1s correct in every era. The list was wrong in a way no count
could see, because both halves were individually right. It took a research pass
asking what the numbers *meant* rather than whether they were there.

> Carried into v6 as a third trap: **a source can answer with MORE than you
> asked for, in a shape that fits.** When a page offers two tables, the question
> is not which one parses.

Two smaller things worth keeping. A research probe had been sitting in `seeds/`
and was therefore an active 1,568-film list, because the directory is the only
thing that decides — a convention about where to put a file is not a guard. And
re-running a fetcher dropped from three minutes to sixteen seconds once the
politeness sleep stopped firing for requests that were being served from cache.

Version 6.0.0.

---

## 9. v6

### 9.1 An overall rank that was really year order

Found by reading values that every count agreed with.

`splitBoxOfficeRanks` was written to do one thing — recover the per-year rank
from a list stored globally — and it correctly assumed a global rank contains
the within-year order. It then applied the converse, which is false: for a list
already stored per-year it wrote row position as the overall rank. Ordered by
per-year rank, that is every year's #1 followed by every year's #2, so
Box-office US ended up claiming that the biggest film in its history was
whatever topped 1946. *Duel in the Sun*, then *Welcome Stranger*, then *The Red
Shoes* — a perfect chronology presented as a ranking.

The list had been shipped with **no** overall rank on purpose, because its
source is an annual top ten with nothing ranking 1962 against 1994. The
migration filled the column anyway.

**Nothing failed, and nothing could have.** The column was 100% populated,
densely numbered from 1, and read by no query in the app. Every guard this
project has was satisfied. It is the same lesson v4 and v5 both taught, in a
third costume: *inspect values, not just volumes.*

The repair keys on two conditions rather than a list name, because either alone
catches something legitimate. Ranks must repeat, which a genuine global rank
never does; and reading rank in overall-rank order must never step down, which
only a sequence generated from that ordering achieves. On the real database
Box-office US stepped down 0 times against France's 617 and España's 681, so
the genuine pair is nowhere near the boundary.

> **The limit is written into the code rather than left to be discovered.** A
> real all-time ordering that interleaved its years in strict rotation would be
> byte-identical to a generated one, and this would clear it. Nothing could
> distinguish them — the data would be the same data. No box-office history is
> that tidy, but the next thing to copy this pattern might be.

Also settled here: `overall_rank` is now documented as **legitimately NULL**,
meaning the source gave no cross-year figure, rather than as a column awaiting
a back-fill. That distinction is the whole defect.

Version 6.2.0.

### 9.2 The wrong match becomes visible

The reconciliation screen showed only the **answer** — the film a row points
at — which is why a wrong match was permanent. An entry that failed to match
sits in a visible queue and gets fixed; one that matched the wrong film is
stored `resolved`, looks exactly like the 7,000 correct rows around it, and is
never seen again. The match-rate floor guards the recoverable failure and
nothing guarded the other.

Three things, and the backend needed none of them: the resolve route never had
a status guard, and `raw_title` is kept on every row, so the capability was
always there and only the screen was missing.

**Say what a row matched FROM**, wherever that disagrees with what it matched
to. On every row it would be noise, since most agree exactly; where they
disagree is where the mistakes are. A matching title with a different year is
the case that matters most and looks wrong least — *Psycho* 1960 against
*Psycho* 1998.

**A queue of matches worth checking**, which re-runs *the matcher's own*
confidence rule against what each row actually ended up pointing at. The
question is "would the matcher wave this pair through today", and reusing
`scoreCandidate` rather than inventing a second notion of agreement is the
whole point — a bespoke rule could disagree with the matcher in either
direction and neither answer would mean anything. Measured: **458 of 7,358
resolved rows, 6.2%**, concentrated in España (13%), France (10%) and Criterion
(5%). A queue that can actually be worked through.

**Re-match reuses the reconciliation editor** rather than getting its own. It
is the same act — point this raw title at the right film — and the only
differences are what the header says and that leaving is a cancel rather than
a drop.

> **The flag is a prompt, never a verdict**, and the live data says so loudly.
> Most flagged rows are *correct* matches made across a title variant: *Three
> Men and a Baby* → *3 Men and a Baby*, *Por Un Puñado De Dólares* → *A Fistful
> of Dollars*. Fuzzy matching is accepted on the Spanish list by decision, so a
> flag there frequently marks a match that is both loose and right. Narrowing
> it would need TMDB's alternative titles per row, which is a network call per
> row and a different feature.

Two smaller corrections fell out. `candidates_json` is cleared when a row
resolves, so the backlog's claim that re-matching could offer the stored
candidates was wrong — a re-match works from search and paste, which is right
anyway, since the stored candidates are where the wrong answer came from. And
the suspect filter runs in JS after the rows are read, so it must not be handed
a page: filtering the first 200 rows alphabetically would have quietly reported
"3 worth checking" on a 1,469-row list.

Version 6.3.0.

### 9.3 One chip for the box office

Awards gathers nine award lists behind one chip; the three box-office lists
had none, because the vibe was worth building only once there was more than
one list to gather. The US list landed in v5, so it is built once over the
finished set rather than added early and edited twice.

Tag-driven, like Awards, so a fourth country would join it without anything
being edited.

**It carries a Top-N of 5, and that cut is the feature rather than a
decoration.** Measured on the real library:

```
             uncut      top 5 per year
films        3,654      1,202
1950s          457        143
1960s          504        148
1970s          514        146
1980s          460        150
1990s          386        149
2000s          444        149
2010s          427        149
```

Uncut, the chip selects most of the library and barely narrows anything. Cut,
every decade from the 1950s to the 2010s lands within two films of 149. This
only works because all three lists now rank *within* a year — the same cut
before §9.1 would have meant "France's five biggest films ever" beside "the
top five of every Spanish year", which is the defect that version fixed.

> **The justification changed under measurement.** The first draft of this
> comment said an uncut selection would bring back the recency skew that
> per-year sources exist to avoid. The numbers say otherwise: uncut is lumpy
> (386 to 514) but not recency-skewed. The honest argument is size and
> evenness, and the comment now says that instead. Recorded because a
> plausible-sounding reason that the data does not support is exactly what
> this project keeps catching itself doing.

Version 6.4.0.

### 9.4 Two things that were quietly untrue

Both found while building the Box office vibe, neither caused by it.

**Two orphaned rows in `list_tags`**, tagging lists 20 and 21, neither of
which exists. The table declares `ON DELETE CASCADE`, so this should be
impossible — but SQLite enforces foreign keys only when a connection sets
`PRAGMA foreign_keys`, and it is off by default on every new one. The app sets
it; something that opened the database once without it did not.

The symptom was the new vibe reporting five resolved lists where three exist.
Nothing downstream was wrong: the pool query joins `lists`, so a phantom id
matches nothing, and the count was identical with and without them. **A number
the host reads rather than a pool they draw from** — which is precisely why it
would have sat there indefinitely.

The sweep covers `list_tags`, `vibe_tags` and `vibe_lists` and stops there. A
row in one of those is a property of its parent and means nothing without it,
so deleting it loses nothing. `list_movies` and the ballot tables cascade too
and are deliberately excluded: they carry content, and an orphan in one would
mean something had gone properly wrong and should be looked at rather than
swept. `PRAGMA foreign_key_check` gives the whole picture when that is wanted;
it now returns empty on the real database.

**A deleted built-in vibe comes back on the next restart.** `ensureBuiltinVibes`
runs on every boot and asks only whether the name is present. Two things said
otherwise: the function's own comment claimed "editing or deleting one sticks",
and a test called *"built-in vibes are seeded once and never re-added after
deletion"* deleted a vibe and then never re-ran the seeder — so the one
assertion that would have caught it was the one missing.

The behaviour is **accepted, not fixed**. Making a delete stick needs a record
of intentionally-removed built-ins, which is real machinery for a problem
nobody has hit; the built-ins are six ordinary starting points and their
returning is a small harm. What was not acceptable was a comment and a test
name that each said the opposite of what the code does. Both now describe it,
and the test asserts the return rather than implying it cannot happen.

> A test whose name claims a property it does not assert is worse than no test,
> because it is read as coverage. This is the second time in v6 that the wrong
> thing was written down confidently — the first was §9.1's invented rank.

Version 6.5.0.

### 9.5 A Top-N cut says which group it cut

One control, one meaning — the top N of each ranked group — but the group is
whatever a list ranks within, and that differs. Top-N=10 is ten films from
TSPDT and about eight hundred from Box-office France. The number alone cannot
tell you which happened, and that was the honest complaint against it.

The fix is a label, not a second control. A second one was considered and
rejected: on most of a selection one of the two would always be a no-op, which
is the lookalike-controls trap already recorded in `DECISIONS.md`. So the pool
summary now reads `top 5 per year` where the group is a year, `top 5` where it
is the list, `top 5, per year on some lists` for a mixed selection, and
`top 5 (no ranked lists)` where the cut did nothing at all — that last case
mattering because "top 5" would otherwise describe a narrowing that never
happened.

> **The first detector was wrong, and the real library caught it.** It asked
> whether ranks REPEAT, reasoning that a per-year list has a #1 for every year.
> True, but so does any poll with ties: Sight and Sound has 264 ranked rows
> across 71 distinct positions and was read as per-year. The right question is
> how many rows sit at rank **1** — 82 for France, 81 for the US, exactly one
> for Sight and Sound, TSPDT and Modern Classics. Measured across every ranked
> list before the change went in, which is the only reason it was caught: the
> tie-heavy list is the single counter-example in the library.

The label is duplicated between `public/dom.js` and `server/pool.js` — the
browser needs it live while the host builds a pool, the server needs it when
writing a finished session's summary, and there is no module shared between
them. The duplication is small, deliberate, and cross-referenced in both.

Version 6.6.0.

### 9.6 The "On:" line says where the film placed

`On: Box-office España` answered "is this film on anything" and stopped. The
rank is the more interesting half, and it was already stored: *Judas* (1952) is
not merely on the Spanish box-office list, it is **#1 of 1952**.

```
On: Box-office España #1 of 1952
On: Sight & Sound Greatest Films (2022 critics’ poll) #20 · The Criterion
    Collection · TSPDT 1,000 Greatest Films #10
```

Three shapes in one line, and the phrasing distinguishes them without a legend.
`#1 of 1952` is a position within that year; `#20` with no year is a position
across the whole list; a list with no ranks at all (Criterion, Ghibli) shows its
name alone, exactly as before. The same `by_year` fact that decides what a
Top-N cut means decides which phrasing a membership gets, so the two can never
disagree.

`movies.lists` changed from a comma-joined string to an array of memberships.
Cheap, because it had exactly one consumer in the whole frontend — the modal
line itself — so there was no reason to bolt a second field alongside it. Three
server queries build it and they now share one SQL fragment rather than three
near-copies that had already drifted in their column aliases.

> `list_shape` is a CTE, not a correlated subquery. The per-list "does this rank
> by year" aggregate is computed once per statement rather than once per
> membership row of every hydrated film — which for a 200-film draw over a
> 1,567-row list is the difference between one pass and several hundred.

A film on nothing returns `[]` rather than `[null]`: `json_group_array` over no
rows gives an empty array, but a LEFT JOIN that matched nothing would have
produced a single null entry and the modal would have rendered a membership
that does not exist. Asserted, because it is invisible until it is not.

Version 6.7.0.

### 9.7 A parametric list can be ranked, by rating

`applyParameter` left every rank NULL, and the code comment gave the reason:
a filmography has no order of its own, and the obvious one is wrong, because
chronological positions would make "top 10" mean "his first ten films".

Rating is a meaning that works — "the top 10 Kurosawa" is a question people
ask — and both numbers were already cached, so nothing new is fetched. Against
the real library:

```
 #1  8.6  404,001  Seven Samurai (1954)
 #2  8.4   72,758  High and Low (1963)
 #3  8.3  103,236  Ikiru (1952)
 #4  8.3   23,610  Red Beard (1965)
 #5  8.2  153,447  Ran (1985)
 …
#30  5.6    2,850  The Most Beautiful (1944)
#31  5.9      231  Song of the Horse (1970)
#32  6.5      222  Those Who Make Tomorrow (1946)
```

The floor is **1,000 IMDb votes**, not the 5,000 the Modern Classics query
needed. That number is right for a query sorting the whole of TMDB; it is wrong
for a closed set of one director's films, where it would strip most pre-1960
work out of a Kurosawa or an Ozu — deleting the canon to keep out noise the set
does not contain. The bottom three rows above are the floor working: two films
rating 5.9 and 6.5 on about 220 votes each sit *below* one rating 5.6 on 2,850.

Ties break on vote count, which is why Ikiru precedes Red Beard at 8.3.

> **Nothing is left NULL, and that is the subtle part.** A NULL rank means "this
> list is not ranked", and a Top-N cut deliberately KEEPS those films —
> otherwise asking for the top 100 would delete every unranked list from the
> pool. Correct across lists, wrong within one. Leaving the unrateable films
> NULL here would have made "top 10 Kurosawa" return ten good films *plus*
> every obscure title that could not be rated. So they sink to the bottom of
> the order instead of floating out of the cut, and the test asserts the
> absence of NULLs directly rather than trusting the ordering to imply it.

Two ways to be unrateable and both land there: too few votes, and no IMDb
rating at all. The second is ordinary rather than exceptional — ratings arrive
from a script run by hand, so a film fetched into the library today carries
none until it is next run.

The slot list ends up with distinct ranks and a single #1, so it reads as an
end-to-end ranking rather than a per-year one, and the Top-N label calls it
`top 10` rather than `top 10 per year`. That falls out of §9.5's rule without
anything being special-cased.

Version 6.8.0.

### 9.8 Closing v6

Eleven chunks. **The version that made the app trust itself**, which is not
what it was scheduled to be — v6 opened as consolidation-and-ship and turned
into a run of things that were quietly wrong and said nothing.

What shipped: re-matching a resolved entry, with a queue that flags the matches
worth checking; a Box office vibe; Top-N labels that name the group they cut;
the `On:` line carrying rank; parametric lists ranked by rating; and the
corrections below.

**Four things were confidently recorded and false.** That is the number worth
carrying forward, because none of them failed, threw, or dropped a row.

- `BACKLOG.md` described France's global rank and Spain's per-year rank as a
  live disagreement. It had shipped in v5. The stale entry cost a session one
  wrong recommendation before anyone checked the code.
- A back-fill migration invented the `overall_rank` it wrote, so Box-office US —
  shipped with no cross-year ordering on purpose — claimed its biggest film of
  all time was whatever topped 1946. Fully populated, densely numbered,
  meaningless.
- `ensureBuiltinVibes` was commented as making a delete stick. It does the
  opposite, and the test named for that property never asserted it.
- The reason recorded for deferring the design tool was wrong on the facts. The
  tool assumes no design system; the real obstacle was that our DOM is built in
  JavaScript, which nobody had written down.

> **The pattern across all four: a confident claim, no failure, and nothing that
> would ever contradict it.** Every one was caught by reading values or source
> and asking whether the claim could be true — never by a test, a guard or a
> tool. v4 taught the same lesson about counts; v6 taught it about prose.

**A detector was run over the UI and produced one actionable finding**, while
missing a WCAG AA failure it had the rule for. Also caught this version: an
Explore count printed twice on every load, a guest submit button live at zero
picks, a guest link that disagreed with the QR beside it, two orphaned rows in
`list_tags`, and a text colour at 3.66:1.

The next version is the first that adds no data at all. Its evidence is
[docs/evidence/ui-review.md](docs/evidence/ui-review.md).

Version 6.12.0.

---

## 10. v7

### 10.1 The lineup stops looking like a truncated search

Four small changes with nothing structural between them, taken first because
none of them is invalidated by the rail that follows — and because the version
that changes only how things look should show something on its first day.

**`auto-fill` was keeping the columns it could not fill.** The default draw is
two films, so the payoff screen rendered as two cards in the first two of five
slots with three empty columns after them: the shape of a search that returned
too little, not of tonight's lineup. `auto-fit` collapses the empty tracks, and
centring the row finishes it.

It is one property in the roadmap and two in the end, because the obvious
version is wrong. Uncapped `1fr` tracks give two cards the whole width —
~525px each — and the poster is `aspect-ratio: 2/3` at full width, so a double
feature would have stood two 790px-tall posters on the page. Capping the track
at 260px trades column count for card size: five columns become three at full
width, on the one grid meant to be looked at rather than scanned. Explore keeps
`auto-fill` for exactly the opposite reason, so the change is scoped to a
lineup-only class rather than made to the shared grid.

**The draw was mute.** The app's one moment of theatre added films below the
fold and said nothing, on a page tall enough that nothing visibly moved. It now
names them — `Drew Sound of Freedom and Fort Apache` — and scrolls the first
one into view.

Naming rather than counting is the point: the count is already on screen in the
heading, and the titles are what the host clicked for. Past three the list stops
being readable at a glance and becomes `and 3 more`.

**Every path emits exactly one toast, and that is a constraint rather than a
style.** Toasts are all `position: fixed` at the same offset, so a second one
lands underneath the first and neither can be read. When the pool comes up
short that single toast is the shortfall, which is the thing the host can act
on; the draw still announces itself by scrolling.

**The announcement is a persistent live region, not a `role` on the toast.** A
live region has to be in the document before its text changes to be reliably
announced; a node arriving with both the role and the text already on it is
announced by some screen readers and silently ignored by others. One empty
region is created on first use and every later message is a text change inside
it — which also means every existing toast in the app became audible, not just
this one.

**`.chip` had no `:hover` at all** — the most-clicked control in the app was
inert until clicked. Behind `@media (hover: hover)` so a touch screen does not
strand the last-tapped chip in a hover state it can never leave, and ordered
before the active-state rules so an active chip keeps its own colours and gets
a brightened variant instead.

Verified in the running app rather than reasoned about: the lineup grid computes
`260px 260px 0px` with `justify-content: center`, the live region carries the
drawn message, and the hover is visibly distinct. One thing could **not** be
observed — the smooth scroll animation never runs in an automation tab, because
`document.visibilityState` is `hidden` there and animations are throttled. The
target and the destination were verified instead, by scrolling to the same
element with `behavior: 'auto'`.

Version 7.1.0.

### 10.2 A live vote is visible, and unrepeatable

Two halves. The server half is the one that mattered: `POST /api/sessions`
checked the lineup and the films and never asked whether a vote was already
open, so publishing a second one over a live one worked for six versions and
nothing anywhere said no.

**Why that is worse than it sounds.** The guest link and the QR are both just
"the vote" — neither carries anything identifying which. A second open session
does not compete with the first; it *replaces* it for everyone who scans from
that moment, while the ballots already cast sit on a session nobody can reach
any more. The failure is silent on both sides: the host sees a working QR, the
guests see a working ballot, and two groups vote on different things.

It refuses rather than resolving. The host has exactly two ways past, and both
are deliberate acts with different meanings — **close**, which keeps the vote
and computes its result, or **cancel**, which throws it away. Neither is
inferable from "publish this other lineup", so picking one on the host's behalf
would be guessing at the more destructive kind of decision.

**The client half is why the guard is livable.** Publishing swapped the whole
Draw tab for the session panel and nothing persisted that view, so a host who
reloaded — or opened the app on the kitchen tablet instead — got an empty
lineup and no trace that voting was open. A guard alone would have turned that
into a refusal they could not act on. A banner above the tab now names the live
vote and routes back to it, derived from `api.history()` rather than remembered,
because the case it exists for is precisely the one where nothing was
remembered. A failed lookup shows no banner rather than a guess: the guard is
the guarantee, the banner is the convenience.

**`onClosed` became `onEnded(outcome)`.** The panel had no hook at all for
cancellation, so a cancelled vote would have left the banner claiming a vote
was live. Making it one callback carrying its outcome rather than two callbacks
also settled something the old name had blurred: a **closed** vote spends the
lineup that produced it, while a **cancelled** one leaves that lineup the single
thing worth keeping, since republishing it is the likely next move. The History
tab still passes nothing, so opening last week's result cannot touch tonight's
lineup.

One existing test had to give a session back at the end. It published and never
closed, which was invisible while a second open vote was legal.

Verified against a throwaway copy of the real database, driven in a browser: the
banner appears on a cold load of a tab that has never seen the vote, publishing
a second is refused with the lineup left intact, "Go to it" reaches the live
panel, leaving by "← New lineup" brings the banner back, and cancelling clears
it. The confirm dialogs were stubbed rather than clicked — a real modal blocks
the automation channel outright.

Version 7.2.0.

### 10.3 Publish stops being the last thing on the page

Publish had been the last thing after every card in the lineup — four screens
down on a phone with five films staged, which is a strange place to put the
point of the screen. It sits in a `.lineup-sticky` now, the same shape the
guest's Submit already used.

**A wrong explanation was committed here and then withdrawn; this paragraph is
the correction.** The bar was first measured sitting 2,578px down the page with
`position: sticky` computed and doing nothing, and that was blamed on its parent
being a grid — the theory being that a grid item's containing block is its own
area, leaving no room to travel. A block wrapper was added on that basis.

**The theory was wrong and the wrapper was a no-op.** Tested by flipping the
same page between the two wrappers and measuring: the bar pins identically as a
grid item and as a block child, and in the original conditions *neither* pins.
The guest screen settled it independently — `.vote-sticky` has had a grid parent
the whole time and pins correctly across a ten-film ballot.

What is actually true is a plain property of `position: sticky`: it cannot pull
an element beyond its own containing block. A two-film lineup gives the bar only
its own ~440px of travel, so sitting 2,578px down a 3,297px page it cannot reach
the viewport until the lineup nearly does. With eight films it pins from the
first pixel. **That is the behaviour to want, not a bug to route around** — a
Publish button hovering over a lineup nobody can see is worse than one that
arrives together with it.

The lesson is the one `DECISIONS.md` §3 already records in another form: a note
written to prevent a bug can cause one. The first measurement was real, the
inference from it was invented, and only a controlled A/B — same page, same
scroll, one variable — separated them.

**"Add a specific film" stopped claiming half the tab.** It sat in a `1fr 1fr`
grid beside the draw controls on the reasoning that neither had priority, and
that was wrong in both directions at once: half the screen stood empty on the
many nights nobody adds a named film, and a 480px column crushed the search
results on the nights they do. One permanent secondary button that expands to
full width lets the two states stop sharing a size. As a side effect the vibe
chips now fit on one row instead of three.

Its three inputs became one box, and the interesting part is what that
required. A themoviedb.org URL is unambiguous and adds the film outright. **Bare
digits are not**: 1917, 300, 2012 and 1408 are all real titles AND plausible
TMDB ids, so letting `parseTmdbInput` read them as an id would have quietly put
the wrong film on somebody's night — searching `1917` returns the Sam Mendes
film first, and the id reading would have skipped it. Bare digits therefore
search like any other text, and the id reading is *offered* above the results
rather than chosen. The panel's open state moved into view state so that adding
one film does not close the panel on a host part-way through adding a second.

**One defect fixed rather than reported, deliberately.** `candidate.lists` is an
array of membership objects and the search card interpolated it into a string,
so every film already on one of your lists read `Already on: [object Object]`.
It was in the panel this chunk rebuilt, it was one line, and shipping the
rebuilt panel with that on screen was not defensible. Named as an exception
here because the standing rule is that findings are reported, not folded in.
The same line also treated an empty array as truthy, printing nothing after the
colon for a film known to the library but on no list.

Verified in a browser against a copy of the real database: the bar pins across
an eight-film lineup at every scroll position, a URL adds outright ("Added 12
Angry Men"), `1917` returns the film with the id offered beside it, and the
membership line reads `Already on: BAFTA — Best Film, Modern Classics (last 10
years)`.

Version 7.3.0, corrected in 7.4.0.

### 10.4 The guest's sticky bar was never broken

Raised as a suspicion off the back of 10.3 and closed by measuring it: a
ten-film ballot on a 2,628px page keeps the Submit bar pinned to the viewport
bottom at every scroll position. No change was needed and none was made.

Worth the round trip anyway, because chasing it is what exposed the wrong
explanation in 10.3 — the guest bar has had a grid parent since it was written,
so "a grid parent breaks sticky" could not survive it working. **A suspicion
that a second surface shares a defect is a cheap thing to check and a very
expensive thing to assume.**

Version 7.4.0.

### 10.5 Pool setup leaves the flow

The keystone of v7, and the one all four review passes converged on: opening
Pool setup pushed the whole tab down, at its worst leaving the Draw button
~2,900px down a ~3,600px page — four viewport heights below the vibe chips that
had just changed the pool. It is a destination now rather than an accordion: a
sticky rail where there is room beside the content, a full-screen sheet where
there is not, and neither can displace the Draw button because neither is in
the same column as it.

**The reuse held.** `renderTagFilter`, `renderListPicker` and
`renderFilterPanel` all moved unchanged, which is what kept this a day's work.
The entire cost of that reuse was two CSS lines: both panels size themselves
against the *viewport* — the filters by a media query, the picker by a 280px
track minimum — so on a wide screen they laid out for a wide screen and
overflowed a 300px rail.

**Pool state is read back as removable pills.** The string they replace read
`20 lists · top 5 per year · Drama · 1960–1969` and could only be acted on by
opening the panel and hunting for whichever control had produced the clause you
wanted gone. Every pill now carries its own undo. The list count deliberately
does not: "no lists" is not a narrowing of the pool, it is an empty pool.

They repaint on their own, like the pool count already did, because the value
inputs deliberately do not call `paint()` — a repaint on every keystroke throws
the caret out of the number field being typed in. Verified: typing `1960` adds
the pill while the caret stays in the field.

**An overlay helper came out of `openMovieModal`, and it was incomplete.** The
modal closed on Escape and on a backdrop click and stopped there: it announced
`aria-modal="true"` while never taking focus, so Tab from an open dialog walked
the page behind it, and the page behind stayed scrollable. Focus-in, Tab
trapped, focus restored to whatever opened it, and a scroll lock all belong to
*being* an overlay rather than to showing a film, so they now live in
`openOverlay` and the modal gets them for free. **That closes the focus half of
the modal row in `ROADMAP.md`** — what remains there is its lack of actions.

The trap list is queried on every Tab rather than once on open, because the
sheet repaints its own contents as filters are picked and a list captured at
open time would trap focus against nodes that no longer exist.

**One defect found by building it: duplicate element ids.** `rangeInputs` gives
its year and runtime fields fixed ids so focus survives a repaint, so rendering
the filter panel in both the rail and the sheet put two `#filter-year-min` in
one document — and `display: none` hides an element without removing it, so
below the rail's breakpoint `getElementById` would answer with the copy nobody
can see. The rail renders empty while the sheet is up; only one copy is ever
live.

Verified in a browser against a copy of the real database: the rail pins at
`top: 16` through a long scroll and does not overflow, the sheet opens with
focus inside it and the page behind locked, typing inside the sheet updates the
pills in the column behind, and removing a pill clears the underlying filter.

⚠️ **Two things are NOT verified.** The duplicate-id fix landed after the
browser extension disconnected, so it is reasoned and not seen. And **no part
of this has been rendered at phone width** — the sheet was exercised by calling
its opener directly, which proves it works and says nothing about how it looks
at 390px. That is the standing v7 gap, not a new one.

Version 7.5.0.

### 10.6 Finishing the keystone against a real narrow window

Everything 10.5 left unverified, plus what verifying it found.

**The sheet was never full-screen.** `.modal-card` sets `max-height: 90vh` and
is defined further down the stylesheet, so at equal specificity it beat
`.sheet-card` on source order and capped the sheet at 631px of a 701px viewport
— the same 90% every time, which is what gave it away. The backdrop also
centres its child inside 20px of padding, right for a film's detail card and
wrong for a destination. Both fixed; the sheet now fills the viewport exactly,
scrolls internally, and keeps its header pinned.

**Focus did not come home.** Closing the sheet repaints the tab, which destroys
the very button the overlay had just restored focus to. The opener carries a
stable id now and is re-focused after the repaint — the same contract
`preserveFocus` already states for anything that must survive one.

**The duplicate ids were only half prevented.** Opening the sheet set the owner
but did not repaint, so both copies of the filter panel existed until something
else happened to repaint. Opening now repaints immediately, and `openOverlay`
reports *every* exit — its own control, Escape, and a backdrop click — so the
rail is refilled however the sheet is dismissed. Measured at each step: exactly
one `#filter-year-min` in the document throughout.

**A narrow window was finally rendered.** `resize_window` was asked for 390×844
and produced 614px of inner width — Chrome's minimum, reported as success,
which is the recorded trap doing exactly what the trap list says it does. 614px
is still below the rail's breakpoint, so **for the first time in this project
the responsive switch has been seen rather than reasoned about**: the rail is
`display: none`, the sheet's opener is visible, the sheet fills the screen, and
nothing overflows horizontally. It is not 390px, and the sub-500px layout
remains unobserved.

Version 7.6.0.

### 10.7 One string stopped setting the width of the page

From field notes, and the fix is not where the symptom is.

The vote panel prints what the vote was drawn from — every selected list joined
with " + ", which at twenty lists is a **571-character** string — inside a
`.badge`, and `.badge` is `white-space: nowrap` because a badge is normally two
or three words. So the page gained a horizontal scrollbar and the nav, the QR
panel and the poster strip all shifted with it.

**Clamping the badge was necessary and not sufficient**, which is the part
worth writing down. With the badge held to 52ch and ellipsised, the page still
measured 3,586px against a 1,440px viewport. `.stack` — the app's default
vertical layout, used by nearly every view — is a grid with no
`grid-template-columns`, so its single column is `auto`, and **an auto grid
column is max-content**. The track kept asking for the untruncated string
regardless of what the badge was allowed to display, and every ancestor grew to
match: `.app` correctly 1,100px with a 3,400px card inside it.

`minmax(0, 1fr)` on `.stack`, and on the `1fr` half of `.publish`. Explicitly
one column that is allowed to shrink, which is what both were always assumed to
be.

The string itself is untouched — it is the honest record of what a vote was
drawn from, so it stays whole in the DOM, on hover, and in History where the
layout can take it. Measured after: page scroll width equal to the viewport,
badge 347px and ellipsised, all 571 characters still there.

Checked across all four tabs, because `.stack` is everywhere: no overflow, no
collapsed cards.

Version 7.7.0.

### 10.8 The filter chips fold away

From field notes, raised as soon as the rail made it visible: Genres, Country
and Language are about forty chips between them, so the rail was one long
scroll with the year and runtime controls stranded below all of it. The panel
was always that long — the rail simply put it somewhere you look.

`<details>` and `<summary>`, not a button and a class. It is a disclosure
widget, the element exists, and the keyboard behaviour and screen reader
announcement come with it.

**A group with a selection is always open**, because you must be able to see
what is narrowing your pool without hunting for it, and the summary carries a
count when it is shut. Groups opened merely to browse are remembered separately
for the session — every chip click repaints the panel, and without that the
group would fold shut under the host mid-decision. Verified: opening Genres by
hand, then picking a chip, leaves it open with a "1" against it and an
`Action ×` pill in the column beside it.

**It did not shorten the rail much, and that is worth recording rather than
claiming otherwise.** Collapsed, the three groups save ~360px of a ~4,300px
rail. The rest is the list picker: all twenty lists are selected by default, a
group with a selection defaults to open, so every one of the eight groups is
expanded on a first load. The chip groups were the reported problem and are
fixed; the picker's default is a separate question and is now in `ROADMAP.md`.

Version 7.8.0.

### 10.9 A built-in vibe's identity stops being its name

Asked as a design question — must renaming a built-in really be a migration
every time? — and the answer turned out to be that the current arrangement is
not merely inconvenient, it is broken.

**Measured before touching anything.** `ensureBuiltinVibes` asked "is there a
vibe called `Cinephile`?", and `PATCH /api/vibes/:id` already accepts a name.
So renaming `Cinephile` to `Film buff` through the real route and restarting
produced **eight** built-ins: the renamed one, and a freshly re-seeded
`Cinephile` beside it. Reachable today; the only reason nobody had hit it is
that the UI does not expose renaming yet.

The cause is that the name was doing two jobs. `builtin_key` splits them: a
stable slug is identity, the name is data. One migration claims a key for each
of the seven existing built-ins by the name it has today — the last time a name
is ever used as a handle — and from there:

- Renaming a built-in in `BUILTIN_VIBES` is a **one-word edit**, and it reaches
  databases that have already booted. `Director night` became `Director's night`
  that way, which is what prompted the question.
- Renaming one through the API no longer duplicates it. Verified end to end on
  a copy of the real database: rename, restart, still seven.
- `name_custom` records that a host has taken the name over, so a later seed
  change cannot overwrite a name they chose. The key is ours, the name is theirs.

Three things worth keeping about the edges. The backfill only fills a NULL key
and only matches the original name, so it cannot disturb a database where
someone has *already* been given a duplicate by the old behaviour — deciding
which of two rows is "really" Cinephile is not a migration's business. The
rename-on-seed checks for a name clash first, because `name` is UNIQUE and a
host who has given some other vibe the name we are moving to would otherwise
crash the boot; leaving the old name is survivable, refusing to start is not.
And the unique index on the key is partial, since every custom vibe has NULL.

**A second inconsistency fell out of it.** Slot lists are named from
`param.label`, independently of the vibe, so they read `Director night —
Kurosawa` and `Actor night — Bruce Willis` beside vibes called `Director's
night` and `Actor's night`. That reached the vote panel, where the summary is
what a published vote records itself as drawn from. The template is possessive
now; slot lists are found through their `vibe_lists` link and never by name, so
existing ones simply take the new name on their next apply.

`lists` still identifies by name, and `DECISIONS.md` has said so since v4. The
same shape would fix it; not done here.

Version 7.9.0.

### 10.10 Explore puts its library first, and the rail becomes a component

~1,600px of controls stood between the heading "Explore the library" and the
first poster. The tab is now title, subtitle, search, sort, grid — the first
poster sits **311px** down — with the same pool controls in the same rail the
Draw tab uses.

**The rail was extracted rather than copied**, which is what the roadmap
predicted would make it worth building: `createPoolDestination` owns the rail,
the sheet, the opener button and the one rule that keeps them honest — only one
copy of the controls may be live, because `rangeInputs` gives its fields fixed
ids and `display: none` hides an element without removing it. Draw was moved
onto it in the same change, so there is one implementation and not two.

It also erases an inconsistency the tab's own subtitle was carrying. "Same
filters as Draw" was true of the filters and false of the chrome: Explore laid
its picker out flat and permanently expanded while Draw had folded the same
picker away. Both now show the same controls in the same place, and Explore
gains the tag filter it never had.

Verified in the browser on both tabs after the extraction: rail present with
picker and filters and no overflow, exactly one `#filter-year-min` in the
document at rest, in the sheet, and after closing it, and the rail refilling on
Escape. Draw kept its pills, its Draw button and its own sheet.

Version 7.10.0.

### 10.11 The modal earns its interruption

The other half of the row whose focus bug closed in v7.5. The overlay had
**zero** actions, so the sequence was: decide in here, close it, find the card
again, act there.

It has `Mark watched` and `+ Add to lineup` now, and the buttons are the same
ones the card uses — one implementation, so they cannot drift.

**The actions are passed in, never built in `dom.js`.** That module imports
`prefs.js` and nothing else on purpose, and an overlay that could add to the
lineup itself would have to reach for `lineup` and `api`. The overlay shows a
film; what you can *do* with one belongs to whoever is showing it. `browse.js`
supplies them, because that is where the card lives too.

Adding from the overlay closes it — the decision is made, and leaving it up is
just asking to be dismissed — and repaints the view behind, so the card
underneath immediately reads `In lineup ✓`.

**Placement was wrong first and worth recording.** Spanning the modal's full
width under the trailer put the actions past a 315px video embed and off the
bottom of the overlay: present, and unreachable without going looking for them.
They sit in the info column under the links now, which is the end of the block
you actually read to decide. Measured: visible with the overlay unscrolled.

Version 7.11.0.

### 10.12 The orphaned separator, third attempt

v4 drew the separator after each item and left `1994 ·` dangling at the end of
a line. v5 moved it to a `::before` on the following item — where it travels
with that item and lands at the START of the next line instead, `· ★ 6.0`. Each
attempt moved the orphan rather than removing it.

**CSS cannot express the rule.** There is no selector for "is the first thing
on its line": that is a fact about how a row wrapped, not about the tree, and
it changes with the width of the card. So it is measured after layout —
`offsetTop` per item, all reads in one pass and all class writes in another,
because interleaving them makes every write invalidate layout and every
following read recompute it. On a 120-row grid that is 120 forced reflows
instead of one.

**The measurement alone was not enough, and this is the part that mattered.**
With the separator in flow it has width, so suppressing it on a wrapped item
frees that width — and the item can then pull back onto the previous line,
where it needs a separator again. Bistable: measured wrapped, unmarked it fits,
marked it wraps. Caught by re-measuring the sweep's own output and finding one
row that permanently disagreed with it —
`2010 · Jean-Loup Felicioli, Alain Gagnol · ★ 6.5`.

The separator is drawn **out of flow** now, absolutely positioned inside the
column gap. It contributes nothing to any item's width, so hiding it cannot
change where anything wraps, and one pass settles. Verified: three consecutive
sweeps over 120 rows, 11 of them wrapping, with zero disagreement each time,
and zero again after a resize to a different width.

The sweep installs itself — a `MutationObserver` for repaints, a
`ResizeObserver` for a rewrap that no DOM change caused — rather than being
called from each view's `paint()`, because one of those calls eventually gets
forgotten and that is exactly how a defect this cosmetic survives three
versions. `childList` only, so writing classes cannot retrigger it.

Version 7.12.0.

### 10.13 One control shape stops meaning four things

Vibe presets, list-group jump chips, genre/country/language filters and display
toggles were all fully-round pills that turned solid yellow when active, sitting
in four rows within ~600px — and four of the seven vibe names recurred verbatim
in the rows below them. With `Cinephile` applied, the group row still painted
`All` in that same active yellow, so two unrelated "selected" states stacked in
one column saying different things.

**The tag-filter row is deleted outright.** It narrowed which lists the picker
showed, which the group headers already do by collapsing — a second mechanism
over the first, and the one carrying the contradictory `All`.

What is left is two kinds of control that now look like two kinds of control: a
**pill** is a preset you apply, a **token** is a value you include or exclude.
Tokens are square-cornered and carry an explicit `+` or `−`, so the tri-state
stops resting on colour alone — include and exclude were yellow, and red with a
strikethrough, and nothing else.

This answers a question `DECISIONS.md` had deliberately left open since v5,
where the entry said the row should not be changed on the strength of a code
read and that the real question was whether the two rows had ever actually been
confused. Four independent review passes converging on it is that evidence.

**One defect hardened while in there.** The tri-state advanced from a state
captured at render time and pushed with no guard, so a click landing on a node
a repaint had already replaced could add a key the group already held.
Demonstrated: two entries for Comedy made the pool summary read
`Action/Comedy/Comedy` — corrupt state and a sentence describing it wrongly in
the same breath. It now reads the group itself and never pushes a duplicate.
Not reachable by ordinary clicking, which is why it had survived; a real
double-click was measured and is correct either way.

Version 7.13.0.

### 10.14 The picker's counts stop contradicting themselves

"20 of 20 lists selected", with 29 checkboxes underneath it. Both numbers were
true — a list appears under every tag it carries, and seven of the twenty carry
more than one — and nothing reconciled them, so the header read as a bug.

**Decided in favour of keeping the repetition and saying so.** A list genuinely
belongs to several tags: Studio Ghibli is animation, a collection, and family
viewing, and hiding two of those to make an arithmetic tidy would be answering
a display question by deleting information. The header now says
`20 of 20 lists selected · 7 appear under more than one tag`, and names them on
hover.

Measured rather than assumed: 20 lists, 29 rows, and the seven are Disney
Animated Canon, Studio Ghibli, The Criterion Collection, and the four festival
awards that are both `awards` and `festivals`.

Version 7.14.0.

### 10.15 A group opens when it has something to say

A picker group defaulted to open if ANY list inside it was ticked. The intent
was right — do not hide lists you are drawing from — and the default state of
this app is all twenty lists ticked, so every one of the eight groups
qualified. All eight opened on every fresh load, and a rule meant to say "look
here" fired everywhere and therefore pointed at nothing: ~4,300px of rail,
uniformly checked.

It opens on a **partial** selection now. All-on and all-off are both uniform,
and the group header already says which one you are in — `Awards 9 lists · 634
films · 9 on`. Part-selected is the only state you cannot read off the header,
so it is the only one that opens itself.

The cost is honest and small: on a fresh load nothing is expanded, so "which
lists are in Awards?" costs one click. Against scrolling 4,300px past 29 ticked
boxes to reach the filters below, that is the better trade.

Version 7.15.0.

### 10.16 Three things the rail only revealed on a phone

All three reported from real use within minutes of the app going on the LAN,
and all three are the rail meeting a 300px column for the first time.

**A summary that grew wrapped its controls into a ragged third line.** Adding
"· 7 appear under more than one tag" pushed the picker's header to two lines,
which shunted "Deselect all" onto a line of its own under the other two. The
summary is a sentence and the buttons are controls, so they get a line each
now.

**"all" and "none" are one control in two halves.** Left to wrap
independently in a group header, "none" stranded itself under "all" and read
as a stray button. Both pairs — the group's and the picker's — wrap as a unit
or not at all.

**Turning a group off used to fling it open.** Clicking `none` on a COLLAPSED
group pinned it open and expanded it. The pin exists for a good reason —
unchecking the last list in a group you are looking at would otherwise collapse
it instantly, yanking the checkbox out from under the cursor — but it was
ungated, and nothing about "I do not want these" asks to see them. It now pins
only a group that is already open. Verified all four ways: `none` and `all` on
a collapsed group leave it collapsed, and a group opened by hand stays open
even when every list in it is unchecked.

Version 7.16.0.

### 10.17 Three more from the phone, and one of them was mine

**The sheet's sticky header was see-through.** Reported with a screenshot of
"The canon · 3 lists · 2,442 films" reading straight through the "Pool setup"
bar. `.modal-card` carries 24px of padding, so a sticky header inset by it
leaves a 24px strip above and beside it that its own background never covers.
Negative margins pull the header out to the card's edges — and `top: -24px`,
not `0`, because the sticky offset still resolves against the card's CONTENT
box, so `top: 0` pinned it 24px down and left the strip. Measured both times:
header top 24 against card top 0 before, 0 and 0 after, with the topmost pixel
belonging to the header at every scroll position.

**A parametric vibe forgot its value the moment anything else changed.** Pick
Director's night → Steven Spielberg → top 10, and the chip fell back to a bare
"Director's night ▾" while the Top-N caption two panels away still read "of
Director's night — Steven Spielberg". One screen saying both things.

The chip read back its value only while the vibe LABEL was applied, and any
hand-edit clears that label to Custom — deliberately, and the Top-N cut counts.
The original rule existed to stop a chip claiming "Robert Eggers" when nothing
of his was in play, which is right; `active` was simply the wrong test for it.
The chip now reads back its value while its **slot list is in the pool**, which
is the honest condition and still reverts on its own when you switch vibes. The
label continues to say Custom, because the pool as a whole genuinely is.

**The draw button lied about its own number.** Typing 5 into the size field left
a button reading "Draw 2" beside a count that had already updated to "fewer than
the 5 you're drawing". The field deliberately does not repaint — a repaint per
keystroke throws the caret out of the field being typed in, the same reason the
filter value inputs don't — so the label was rendered once and never again. It
repaints on its own now, like the pool count, and so does the film/films word
beside it.

Version 7.17.0.

### 10.18 One stale render, reported three different ways

All three came from one sequence — Spielberg, then award winners, then draw,
then Clear all — and all three are the same shape: something rendered once from
state that changed afterwards.

**The Draw button died and stayed dead.** After "Clear all" the count read
"1 new film matches" beside a Draw button that could not be clicked. The button's
`disabled` came from `state.poolCount` at paint time, and `refreshCount` is
async — "Clear all" did not await it, so the repaint used the previous count of
zero and nothing re-evaluated the button when the real number arrived. Removing
the same film from its card worked, and that is the tell: that path awaited the
count before painting. `paintCount` now refreshes the button's disabled state
too, which fixes every path rather than the one that was reported.

**The "custom" label lagged a whole interaction behind.** Ticking "only films
that won an award" demoted the pool but left the label claiming the vibe until
something else repainted — usually the next draw, which is why it looked like
drawing had caused it. The range inputs deliberately do not repaint, because a
repaint per keystroke throws the caret out of the field; a checkbox holds no
caret, so it gets the full repaint and the label is honest immediately.

**The parametric chip went grey while still being what was drawn.** v7.17 made
it keep its VALUE when the pool is hand-edited, and stopped there — so it read
"Director: Steven Spielberg" in the unselected grey while that was exactly what
the pool was drawing from. The highlight now follows the same condition as the
value: this vibe's slot list is in play. The "custom" note on the label above is
what says the pool has been edited since.

### 10.19 Two columns on a phone

A 390px screen leaves ~358px of content, and a 190px track minimum needs 396px
for two — so every grid collapsed to a single full-width card, one ~537px
poster per screen, on a tab whose job is browsing. Below 560px the minimum
drops to 150px, which measures `171px 171px` against the old rule's single
`358px`. The lineup is included: a double feature is two films and seeing both
at once is the point of the screen.

**Deliberately a media query and nothing else**, so reverting is deleting one
block — it is an experiment, and the phone is the only place it can be judged.

Version 7.18.0.

### 10.20 The person picker takes the caret with it

Opening Director's night or Actor's night has exactly one possible next move —
type a name — and it took a second tap to reach the only input on offer. The box
is focused as it appears now, so a phone brings the keyboard up with the picker
rather than after it.

**A microtask, not `requestAnimationFrame`**, and that was worth finding out.
The node is not in the document when it is built — it is returned into a paint
that appends it, and `focus()` on a detached element does nothing — so the call
has to be deferred. rAF was the first attempt and never ran: **Chrome does not
run rAF at all in a background tab.** Harmless for a host, who is by definition
looking at the page, but it would have parked the focus until the tab came
forward and then taken it at a moment nobody asked for. A microtask runs as
soon as the paint that appended the node has finished, throttled by nothing.

Version 7.19.0.
