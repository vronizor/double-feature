# Roadmap — v2

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

## 4. Work items, in order

### 4.1 + 4.2 — build these together

**Sequencing note:** 4.1 is the cheapest item in isolation, but its Top-N
control lands *inside* the list picker that 4.2 rebuilds with categories.
Building 4.1 first means building that control twice. Do them as one piece of
work.

They also both modify the **same** SQL — the list-membership subquery in
`buildPoolQuery`:

```sql
m.tmdb_id IN (
  SELECT lm.tmdb_id FROM list_movies lm
  JOIN lists l ON l.id = lm.list_id
  WHERE l.is_active = 1        -- §0 replaces this with an explicit id set
    AND lm.tmdb_id IS NOT NULL -- 4.1 adds the rank constraint here
)
```

so §0, 4.1 and 4.2 are one careful change to that subquery plus one set of
tests, not three.

### 4.1 `list_movies.rank` + Top-N  — cost: LOW, risk: LOW

One nullable column and one conditional control. No external dependency, no new
concepts. Note it is a **per-list** rank (a film can be #3 on one list and
unranked on another), so it belongs on `list_movies`, not `movies`.

> **Trap: re-running `npm run seed` will NOT backfill this column.**
> `scripts/seed.mjs` builds an `existing` set keyed on `raw_title + raw_year`
> and filters those entries out of `pending`, precisely so re-runs don't
> re-spend TMDB calls. Every already-seeded row would therefore keep
> `rank = NULL` forever. Needs a dedicated backfill script (follow the
> `scripts/backfill.mjs` precedent) that reads the seed JSON and updates rows
> in place — no TMDB calls required, since rank comes from the seed file, not
> the API.

### 4.2 Awards lists + `lists.category` + grouped picker — cost: MED, risk: LOW

The centrepiece. Wikidata fetchers for Best Picture, Palme d'Or, BAFTA, and
whichever national awards prove additive (**check overlap first** — measured on
a 30-film sample, Palme d'Or is 80% already in the pool while Oscars are only
28%, so festival lists mostly re-label films you already have while mainstream
awards genuinely expand).

`lists.category` — `canon` / `awards` / `family` / `festivals` / `collection` /
`dynamic`. Single category per list: a list can honestly belong to two (BFI's is
both *family* and *canon*), but single-category is what keeps the grouped picker
clean, each list rendering exactly once. Treat it as display grouping, not
taxonomy. Revisit only if it bites.

> **Trap: this is a data migration, not just a column.** Two gaps the mockup
> doesn't show:
> 1. The **7 existing lists** need categories assigned — a one-off update, not
>    something `ensureColumn`'s default can do meaningfully.
> 2. `POST /api/lists` creates custom lists with no category. Either the create
>    UI gains a category picker, or the grouped picker must render an
>    **"Uncategorised"** bucket. Pick one deliberately; don't let user-created
>    lists silently vanish from a grouped picker.

**Award year is deliberately NOT stored.** For most awards the ceremony is
release year + 1, so `movies.year` already answers "winners from the 90s" well
enough. Recency for the Awards occasion comes free from the existing year
filter.

### 4.3 Dynamic (query-backed) lists — cost: MED, risk: MED

Launch with one: crowd-pleasers at `vote_count.gte=5000`.

**Materialise, don't special-case.** Store the query on the list and have a
refresh job repopulate its `list_movies` rows. The pool query, filters and the
whole draw path stay completely unchanged — a dynamic list looks identical to a
static one downstream. Far cheaper than a second code path through
`buildPoolQuery`.

**Store the query as a structured object**, e.g.
`{kind:'discover', params:{...}}`, **not a frozen URL string.** This is the hook
that lets director/theme night inject a parameter later without a migration.
It is the one piece of future-proofing worth paying for now.

Risk: the tuning is taste-dependent and TMDB's data drifts, so the vote floor
will need revisiting. Keep it configurable rather than hard-coded.

### 4.4 "Replace" + lineup provenance — cost: LOW, risk: LOW

Drew 2, don't like them, don't want to remove them by hand: `[Replace 2]`
redraws them in place.

**Requires provenance per lineup entry.** The lineup mixes films that were
drawn with films someone specifically asked for (search, paste, manual, Explore).
Replace must only swap out the **drawn** ones, or it throws away a deliberate
pick. Since `lineup.js` is an in-memory singleton, this is a property on the
entry object — **zero schema cost**. `lineup.add(movie, source)` where source is
`'draw' | 'added'`.

Refinement worth having: keep a session-scoped "already seen" set so repeated
Replace cycles through fresh options instead of re-offering something just
rejected. Pass it as `exclude`, which `drawFromPool` already supports.

### 4.5 Streaming badge — cost: LOW, risk: LOW

Free to fetch via `append_to_response`. Needs a providers join table (same shape
as `movie_genres`), a region setting in `.env` next to `HOST_LAN_IP`, and card
/ modal display.

One knock-on: provider data goes stale far faster than the rest (films leave
services monthly), and the refresh job runs a **150-day** TTL at **250
films/day**. Tightening the whole cycle to ~14 days costs `2042 / 14 ≈ 146`
films/day — *below* the existing 250/day budget, and providers then ride along
free. So this is a cadence change, not new infrastructure.

### 4.6 Loop-closers — cost: LOW, risk: LOW

**Mark the winner watched from the results screen.** The app picks a film and
never learns whether it was watched; `watched` is only ever set by hand from a
card, so the exclusion filter accumulates nothing on its own.

**Reset the lineup after voting closes.** Once a session closes, the lineup that
produced it is still staged. Only "← New lineup" clears it.

> **Trap:** `renderSessionPanel` is shared between the host screen and the
> History tab. Clearing on close must be gated to the host's *own live* session —
> opening an old session in History must never wipe the lineup being built.
> `draw.js`'s `showSession()` owns the lineup lifecycle, so pass a callback
> (`onClosed`) rather than clearing from inside the panel.

Also decide: should closing offer "re-vote with the same films"? If so, clear on
leaving the results screen rather than on close.

### 4.7 Test coverage — not an afterthought

v1 held **127 tests green** through every refactor, which is the only reason
those refactors were safe. The new work needs matching coverage:

- `buildPoolQuery` with an explicit list-id set (§0) — including the empty-set
  case, which must return nothing rather than everything
- rank / Top-N filtering, including the `rank IS NULL` (unranked list) path
- the rank backfill script — idempotent, and doesn't touch already-correct rows
- dynamic list materialisation, including a film **dropping out** of the query
  on re-materialisation
- lineup provenance: `Replace` must swap only `'draw'` entries and leave
  `'added'` ones alone

### Before starting: back up the database

The live DB holds 2,042 films, real watched flags and session history.
`ensureColumn` is additive and safe, but a re-seed or a dynamic-list
re-materialisation is not.

```bash
cp data/double-feature.db data/double-feature.db.pre-v2
```

---

## 5. Deferred — but the design must not block them

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

## 6. Not planned

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
