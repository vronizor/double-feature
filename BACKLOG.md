# Backlog

Improvements worth doing but not scheduled. Unlike `ROADMAP.md`, nothing here
is committed to a version — this is the "we noticed, we decided not to now"
list, kept so the reasoning doesn't have to be rediscovered.

---

## Award years for BAFTA, César and Goya

**The gap.** Award badges show the ceremony year (`🏆 Palme d'Or 2019`) from
`list_movies.award_year`. Coverage is uneven, because it comes from Wikidata's
point-in-time (`P585`) qualifier on the award-received statement:

| Award | Source route | Award-year coverage |
|---|---|---|
| Oscar — Best Picture | Wikidata `P166` | 97/97 (100%) |
| Oscar — Best International | Wikidata `P166` | 71/71 (100%) |
| Golden Lion | Wikidata `P166` | 65/66 (98%) |
| Palme d'Or | Wikidata `P166` | 80/82 (98%) |
| Golden Bear | Wikidata `P166` | 80/86 (93%) |
| **César** | Wikipedia category | **20/51 (39%)** |
| **BAFTA** | Wikipedia category | **29/78 (37%)** |
| **Goya** | Wikipedia category | **11/40 (28%)** |

The three national awards came from Wikipedia categories precisely because
Wikidata's `P166` data for them is thin — and the year lives on that same thin
statement, so the gap is inherited. Films without a year render as plain
`🏆 César`, which is correct but less interesting than `🏆 César 1998`.

Two ways to close it, neither taken yet.

### Option B — derive the year as release year + 1

All three are held in February/March for the *previous* year's films, so
`award_year = movies.year + 1` would be right in the overwhelming majority of
cases, and gets coverage to 100% for nothing.

- **For:** trivial, no new source, no new fetching.
- **Against:** silently mixes real and guessed data in the same field, with no
  way to tell them apart afterwards. It will be wrong sometimes — festival
  timing shifts, films with an early-festival release the year before general
  release, re-releases — and a *confidently wrong* year is worse than an absent
  one at movie night. If this is ever done, store it in a separate column (or
  flag it) rather than overwriting `award_year`, and consider rendering derived
  years differently (`~1998`).

**Note this only works for these three.** Cannes awards a film in its own
release year, so the same derivation applied to the Palme d'Or would be off by
one — *Anora* is released 2024, Palme d'Or **2024**, Oscar **2025**. That
single film is the reason `award_year` is stored rather than computed.

### Option C — scrape the ceremony tables (the complete fix)

Each award's own Wikipedia article carries a full year-by-year winners table:

- `en.wikipedia.org/wiki/BAFTA_Award_for_Best_Film` — 10 wikitables, 546 rows
- `fr.wikipedia.org/wiki/César_du_meilleur_film`
- `es.wikipedia.org/wiki/Premio_Goya_a_la_mejor_película`

Parse year → winning film, match to the entries already fetched from the
category (by Wikidata QID where the table links to an article, which avoids
fuzzy title matching).

- **For:** genuine data, 100% coverage, no guessing.
- **Against:** the most work, and it's exactly the prose-table parsing the
  category route was chosen to avoid. Those tables also mix winners and
  nominees, so the parser has to distinguish them — usually by bold or by a
  separate column, and the convention differs between the three language
  Wikipedias.

**Recommendation if picked up:** C, not B. The whole point of the badge is a
specific true fact; a guessed year undermines the feature it's meant to serve.
C is contained — one parser per award, run once at fetch time, and a bad parse
shows up immediately as a year that doesn't match the film's release year.

---

## Popularity vs acclaim — the metric problem

**The finding that matters: sorting by rating selects for critical acclaim, not
for crowd-pleasing.** This is not a tuning issue; it is structural, and it
applies in every language.

Measured on TMDB:

```
Ace Ventura            ★6.6      Parasite                ★8.5
The Mask               ★7.0      Your Name.              ★8.5
Dumb and Dumber        ★6.7      Into the Spider-Verse   ★8.4
Austin Powers          ★6.6      Avengers: Infinity War  ★8.2
Wayne's World          ★6.7      Green Book              ★8.2
```

The films people put on for a good evening cluster at 6.6–7.0. The current
"Crowd-Pleasers" list sorts by rating, so its *lowest* entry is 8.2 — it cannot
reach them. **That list is misnamed**: it is "recent, widely-seen, highly-rated",
i.e. recent acclaim. It even contains Parasite, which is already on the canon
lists it was meant to counterbalance.

Two distinct axes, needing two distinct lists:

| Axis | Sort | Gives you |
|---|---|---|
| **Acclaim** | rating, with a vote floor | Parasite, Spider-Verse, Portrait de la jeune fille en feu |
| **Popularity** | reach / admissions, with a rating *gate* | Ace Ventura, Taxi, Les Visiteurs |

Renaming the existing list (to something like "Modern Classics") and adding a
separate reach-sorted one is probably the honest fix.

## National popularity — box-office admissions

**The gap.** International vote counts cannot distinguish "this country loves
it" from "the world hasn't seen it". Both look like a low number. Le Père Noël
est une ordure has 11,588 IMDb votes not because it is obscure but because it
never left France.

Measured against a list of twelve French comedies everyone in France knows
(Le Père Noël est une ordure, Taxi, La Tour Montparnasse Infernale, Astérix &
Obélix : Mission Cléopâtre, Les Visiteurs, La Cité de la peur, Le Dîner de cons,
Les Bronzés font du ski, OSS 117, Bienvenue chez les Ch'tis, Intouchables,
La Grande Vadrouille):

| Approach | Hit rate |
|---|---|
| Global IMDb floor ≥50k | 3 / 12 survive |
| French-specific floor, sorted by rating | 4 / 30 of the resulting top 30 |
| French-specific floor, sorted by reach | 6 / 30 — top is still Léon, Amélie, Le Cinquième Élément |

No normalisation fixes this, because the signal isn't in the data. And
La Tour Montparnasse Infernale rates **5.8** — beloved-but-badly-rated is a real
category that no quality metric will ever surface.

**What would work: box-office admissions**, which measure what a country's
audience actually went to see. Per-country Wikipedia keeps this:

- `fr.wikipedia` — *Liste des plus gros succès du box-office en France*
  (3 wikitables, 232 rows)
- equivalents exist for other countries; the pattern generalises, and is the
  same shape as the award lists already built from language Wikipedias

**Design as a general mechanism, not a French special case.** One fetcher
parameterised by country → a list per country ("Box-office France",
"Box-office España", …), all under a `popular` or `box-office` category so the
picker groups them and one occasion chip can select the lot. That is what keeps
list proliferation manageable: categories absorb breadth, the picker stays one
click per group.

### Measured 2026-07-29: the per-year articles are a far better source

The all-time page above (*Liste des plus gros succès du box-office en France*)
is **not** the one to use. fr.wikipedia carries a **`Box-office France <year>`
article per year**, back to at least 1970, and it answers three of the open
questions below outright.

Sampled nine years, parsing rows for a wikilinked title plus an admissions
figure:

```
1970:  42 rows, 28 French   top FR: Le Gendarme en balade 4.9M
1976:  37 rows, 23 French   top FR: L'Aile ou la Cuisse 5.8M
1982:  45 rows, 27 French   top FR: L'As des as 5.5M
1988:  29 rows, 10 French   top FR: Le Grand Bleu 9.2M
1994:  33 rows, 11 French   top FR: Un Indien dans la ville 7.9M, La Cité de la peur 2.2M
2001:  48 rows, 23 French   top FR: Amélie 8.6M, La Tour Montparnasse infernale 2.1M
2015:  82 rows, 19 French   top FR: Les Nouvelles Aventures d'Aladin 4.4M
2008:   2 rows              ← layout differs, parser fell over
2022:   1 row               ← same
```

Why this source is the right one:

- **Nationality is a column in the table** (`{{FRA-d}}`, `{{USA-d}}`), so
  "French films France went to see" needs no cross-reference against
  `movies.countries` at all. Open question 1 dissolves.
- **The figure is admissions (`Entrées`), not revenue**, so ticket-price
  inflation never enters. Open question 2 dissolves.
- **Per-year, not cumulative**, so re-release totals don't pile onto old films
  the way the all-time list makes them. Open question 3 dissolves — and per-year
  gives era balance for free, which is the whole reason the all-time list fails:
  it is dominated by recent blockbusters and Hollywood.
- Titles are `[[wikilinked]]`, so identity goes link → QID → TMDB id through the
  pipeline the award fetchers already use. No fuzzy title matching.

**It reaches the target register.** *La Cité de la peur*, *La Tour Montparnasse
infernale*, *L'Aile ou la Cuisse*, *Un Indien dans la ville*, the *Gendarme*
films — exactly the beloved-but-not-canon films no rating metric can surface,
and the reason this whole item exists.

**Decided: take every row the page lists.** No admissions threshold of our own —
if a film was a hit that year, that is the whole qualification. The per-year
pages already apply their own inclusion rule (2001's table is "films exceeding
1,000,000 spectators"), and second-guessing it would only re-import the
popularity-vs-acclaim mistake from the other direction.

**What it costs and what it misses:**

- ~55 pages instead of 1, and **the layout is not stable across years** — the
  2008 and 2022 pages parsed to 2 and 1 rows against 30–80 for the others.

  > **This is not an admissions threshold — it is a broken-parser alarm.** 2008
  > did not have two hits; the 2008 page is laid out differently and the parser
  > fell off it. The two are easy to confuse and the distinction matters: without
  > a per-year row-count sanity check, a page whose markup changes silently
  > contributes nothing and that year quietly vanishes from the list, reported as
  > a success. Exactly the failure the F8 shrink guard exists to catch, one level
  > down. Take every row the page lists — *and* refuse the year if the count
  > looks nothing like its neighbours.
- *Le Père Noël est une ordure* (1982) is genuinely absent, and always will be:
  it was a modest theatrical release that became a cult film through television.
  **Box office measures cinema admissions**, so a film famous from TV reruns is
  outside what this feature can ever reach. Worth stating plainly rather than
  tuning for.

**Spain has no equivalent — dropped from v3, deferred to a later version.**
Probed `Anexo:Taquilla de España`, `Anexo:Películas más taquilleras en España`,
`Taquilla de España <year>` and searches around them: all missing. es.wikipedia
does not curate box office the way fr.wikipedia does.

A wider search (2026-07-30) turned up three candidates and one dead end. Kept
so the next attempt starts here rather than repeating the search:

| Lead | Status |
|---|---|
| `Anexo:Cine en <year>` (es.wikipedia) | **Most promising.** Exists per year, 5 tables, mentions *taquilla* — the per-year shape that worked for France. Needs a proper look at whether the tables carry admissions or just releases. |
| `Liste des plus gros succès du box-office en Espagne` (fr.wikipedia) | Exists, but all-time and therefore Hollywood-dominated — the same weakness that made the French all-time page the wrong source. |
| `List of highest-grossing films in Spain` (en.wikipedia) | Exists. Same all-time weakness. |
| Wikidata `P2142` + `P3005 = Q29` | **Dead — 26 films total.** Far too sparse, and it is revenue rather than admissions. Do not re-propose. |

**Off-Wikipedia sources were searched too** (2026-07-30), after the first pass
wrongly confined itself to Wikimedia out of habit. The official-looking option
is real but not usable as-is:

**ICAA / Ministerio de Cultura — "Histórico de taquilla y espectadores"**
(`cultura.gob.es/cultura/areas/cine/datos/taquilla-espectadores.html`).
Per-year files of *recaudación y espectadores* for films with Spanish
production participation, in Spanish territory. On the face of it this is a
better fit than the French Wikipedia pages: it is admissions, and it is already
scoped to Spanish films, so no nationality rule is needed at all.

Three problems, any one of which is disqualifying today:

1. **It only covers 2016–2025.** Ten years, against 82 for France. The whole
   point of this feature is reaching *Bienvenue chez les Ch'tis*-era and older
   beloved films; a decade-deep list is exactly the recency skew the all-time
   page was rejected for.
2. **PDFs, not structured data.** Every year is a PDF. That is a categorically
   harder and more fragile parse than wikitext, with no header row to key on.
3. **Licensing.** The page states plainly that the figures are *"elaborados por
   Rentrak y no son datos oficiales del ICAA"* — commercial Comscore/Rentrak
   data hosted by the ministry, not government open data. Redistributing it in
   a seed file is a genuinely different question from Wikipedia's CC-BY-SA, and
   would need answering before any code is written.

**The better thread for a future attempt** is the ICAA's own *Catálogo de
Películas* (`sede.mcu.gob.es/CatalogoICAA`), which is official rather than
Rentrak-sourced and appears to span decades. It is a search UI, so the open
question is whether any bulk export or API exists behind it. Not investigated —
Spain is deferred.

> Note for whoever picks this up: both government hosts fail strict TLS
> verification (incomplete certificate chain). They are fine over plain `curl`;
> it is the servers' chain, not a fetch bug.

That kills the "one parameterised fetcher, many countries" premise for now —
it does not survive contact with the second country. Two consequences:

1. **Build the France fetcher parameterised anyway** (language, page-title
   pattern, column names), even though France is its only caller. The cost is
   nil and the alternative is a rewrite when a second country arrives.
2. Spain needs a source *found* before it can be scoped at all. Official
   admissions data comes from the ICAA rather than Wikipedia, which is a
   different kind of source (and a different licence question) from everything
   in this repo so far — so it is a research task, not a build task.

**Open questions before building:**

1. Does the table separate domestic productions from Hollywood films released in
   that country? "Biggest box office in France" includes Titanic and Avatar.
   Cross-referencing `movies.countries` (already cached) is the likely fix, but
   it needs checking — and it may be that *both* cuts are wanted:
   "French films France loved" vs "what France went to see".
2. Do admissions skew so heavily recent that they need the same per-era
   treatment as vote counts? Ticket-price inflation affects revenue but
   admissions counts should be fairer; unverified.
3. Older films' admissions are often cumulative across re-releases. Whether
   that's a problem or a feature is a judgement call.

**Risk to watch: list proliferation.** A country list per country, plus canon,
awards, family, collections, dynamic — this is how a picker becomes unusable.
The category grouping built in v2 is what makes it survivable, and any new
family of lists should arrive with a category rather than as loose entries.

## Unscheduled

- **Alternative ratings on hover (IMDb, Letterboxd, SensCritique).** Show a
  second opinion beside TMDB's score on the card or in the detail overlay.
  Needs an assessment of what is actually obtainable — partial notes from the
  session that raised it:

  | Source | Status | Notes |
  |---|---|---|
  | **IMDb** | ✅ verified obtainable | Official dataset `title.ratings.tsv.gz`, **8 MB**, every title, updated daily, free for personal/non-commercial use. Joins exactly via `imdb_id`, which TMDB already returns in the detail response — no fuzzy matching. Would need an `imdb_id` column plus a backfill. |
  | **SensCritique** | ❌ verified blocked | Returns 403 to scripted requests, same as criterion.com. The family-films seed list had to be exported by hand for this reason. |
  | **Letterboxd** | ❓ unassessed | No public API historically; believed to be invite/beta only. Needs checking before any design — do not assume scraping is acceptable, their terms are the deciding factor. |

  Design notes if picked up: the licence on the IMDb data is
  personal/non-commercial, which fits this app but means **the dataset must not
  be committed to the repo** — fetch at setup/refresh time and store only the
  derived numbers. Worth deciding whether this is display-only (a second score
  in the overlay) or feeds a metric, because the popularity-vs-acclaim finding
  above showed that a bigger sample does **not** fix the language skew.

Nothing here is committed to a version. The measurement write-ups above are
kept because the v3 items in `ROADMAP.md` reference their evidence.

- **Household memory.** The app picks a winner and then learns nothing —
  `watched` is only ever set by hand, so nothing accumulates between nights.
  Beyond `ROADMAP.md` F3 (mark the winner watched), the fuller version is a
  one-tap rating from guests' phones after the film, while the ballot is still
  open. No accounts needed: the session already knows who ranked. Would give
  History something worth revisiting and the exclusion filter something to work
  with.

- **A genuinely reach-sorted "popularity" list.** The third axis, still empty.
  Distinct from box-office (v3): box-office measures what one country went to
  the cinema for, reach measures what the world has seen. Box-office France
  surfaces *Bienvenue chez les Ch'tis*; reach-sorted surfaces *Ace Ventura* and
  *Austin Powers*. Neither substitutes for the other. Sort by reach with a
  rating **gate** rather than a rating sort — see the metric write-up above for
  why rating-sorted can never reach them.

- **Nominees, not just winners.** Wikidata models nominations (`P1411`) and the
  Wikipedia categories have sibling nominee categories. Would multiply the pool
  considerably and dilute "award winner" as a signal; noted rather than
  proposed.

- **Separate "dynamic" as a mechanism from "dynamic" as a tag.** Query-backed
  lists are identifiable by `query_json IS NOT NULL`, but the Crowd-pleasers
  vibe resolves on the `dynamic` *tag*. A second query-backed list family would
  therefore be absorbed by that vibe whether or not it belongs there. Gated on a
  second query-backed list existing — not on box office, which produces static
  scraped lists.

- **`materialiseList`: set rank on reconcile, and wrap in a transaction.** The
  reconcile path keeps existing rows and never updates rank, so a *ranked*
  dynamic list would freeze its ranks at first materialisation while membership
  moved on. No such list exists yet. The missing transaction self-heals on the
  next run.

## Dropped

- **Worker-pooling the refresh job.** `refreshStaleMovies` does `Promise.all`
  over up to 250 films, which looks alarming but isn't: `request()` in
  `server/tmdb.js` already gates every call on a semaphore of 8
  (`MAX_CONCURRENCY`), so those 250 promises queue behind it rather than firing
  concurrently. The protection already exists.
