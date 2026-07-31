# Roadmap

**The live view. Start here.** What is being worked on now, and what is decided
but not built. Nothing here is finished — the moment something ships it moves to
`HISTORY.md`, so this file stays the size of the work in front of you.

Three states, and only three. A fourth would be one person handing work to
themselves.

| State | Meaning |
|---|---|
| 🗣 **open** | A decision is owed. **Do not build it.** The question is stated in the row |
| ⏳ **ready** | Decided. Anyone can pick it up from what is written here **without asking another question** — if a row is ⏳ and its section ends in a question, the row is lying |
| 🔨 **doing** | In progress right now. Three at most |

## v4

| Item | State | Where it stands |
|---|---|---|
| Box office — Spain (ICAA) | ⏳ ready | Enumeration exists (an undocumented `Ano` filter), fuzzy matching accepted here and nowhere else, 90% match floor declared — see §1 |
| Alternative ratings — IMDb | ✅ landed | 3,819 of 3,824 films carry an id; 3,808 matched a rating. Shown beside the TMDB score above a 1,000-vote floor. `npm run imdb-ratings` re-syncs |
| Alternative ratings — Letterboxd | ⏳ ready | **Research, not a build.** Their terms decide it. Writing down the answer *is* the deliverable; any build is v5 |
| National cinema night | ⏳ ready | One parametric vibe. **Decided: filter cached `movies.countries` for v4**, rather than discovering new films — see §3 |
| Director night | 🔨 doing | The person half has landed (`searchPerson`, `getDirectorCredits`, two routes). Remaining: the `▾` chip, and the slot list — see §3 |
| A slot list needs a visible label | ✅ landed | Explore names the selection, and the chip reads back the chosen value ("Robert Eggers ▾") |
| `seed.mjs` keyed on `tmdb_id` | ✅ landed | Additive key in both scripts, and the predicate is now exported and tested — the first thing in `seed.mjs` that could be |
| `includeWatched` default | 🗣 open | README says exclude, the UI ships include. Inert until something is actually marked watched |
| LICENSE, and seed-list provenance | 🗣 open | Not code. The repo is public and therefore all-rights-reserved by default; TSPDT's complete 1,000-entry ranking is the strongest provenance flag. Consciously accepted for now — see `docs/evidence/publication-audit.md` |

Deferred, so they are not re-proposed early: **v5** — US box office, cultness,
actor's night, a Letterboxd build, household memory, nominees as well as
winners. **v6** — a design pass with Impeccable. Both in `BACKLOG.md`.

---

### 1. Box office — Spain, via the ICAA catalogue
> **The admissions figures are only served in the SPANISH locale.** The English
> pages omit the box-office block entirely — no *Recaudación*, no
> *Espectadores*, and no tab where they would go. Nothing 404s and nothing looks
> wrong; the film's page simply renders without the one thing this list needs.
>
> Set the locale first (`GET /CatalogoICAA/es-es?q=true`, keeping the cookie)
> and the detail page carries:
>
> ```
> Recaudación: 682.612,05 €   Espectadores: 1.039.120   Nacionalidad: España
> ```
>
> Verified against both figures quoted below: *Viridiana* 1.039.120 and
> *Los Otros* 6.411.003, exactly. **Cost is the real constraint** — a detail
> page is 57 KB and takes 2.4–7.0 s, and there are ~11,000 of them.

**What enumeration actually costs, now measured.** `SoloEspana` is sent as
**1 or 0**, not `true` — which is why an earlier probe found it did nothing —
and `Metraje=LA` restricts to feature films. Together:

```
Ano=1994&SoloEspana=1&Metraje=LA   150 films   (from 1000 unfiltered)
Ano=1961&SoloEspana=1&Metraje=LA   111
Ano=2010&SoloEspana=1&Metraje=LA   294
```

~150/year, so ~525 listing requests covers 75 years. Cheap. It is the *detail*
pages that are expensive — 57 KB and 2.3 s each, ~11,000 of them — and they do
not carry the figure anyway.

**Source: the ICAA *Catálogo de Películas*** (`sede.mcu.gob.es/CatalogoICAA`),
the Spanish film institute's own register. Verified live: an unauthenticated
JSON endpoint, `/Buscador/GetPeliculasPreview?T_general=<title>`, and a detail
page carrying *espectadores*, *recaudación* and co-production percentages.

```
1952  BIENVENIDO MISTER MARSHALL      26.204 espectadores
1961  VIRIDIANA                    1.039.120
1984  SANTOS INOCENTES, LOS        2.033.935
2000  OTROS, LOS                   6.411.003
2022  AS BESTAS                    1.112.098
```

Seventy years deep, official, and admissions rather than revenue — better data
than Wikipedia would have given. Rejected alternatives are in `docs/evidence/national-box-office.md`:
es.wikipedia has no per-year series, the ministry's other per-year files are
Rentrak-sourced PDFs covering only 2016–2025, and Wikidata has 26 films total.

**Decided: fuzzy title matching is accepted for this list, and only this list.**
That is a real departure — every other list resolves through a TMDB id or a
Wikidata QID precisely to avoid title matching. ICAA has neither, and stores
titles article-last and upper-cased (`VERDUGO, EL`, `OTROS, LOS`). So this needs
a normaliser that undoes that convention before matching, and it will be the
first place in the codebase where identity is a guess.

Given that, the guard rails matter more than usual:

- **Match on title + year, never title alone.** `normalizeTitle` in
  `server/tmdb.js` already folds accents, punctuation and leading articles, and
  `scoreCandidate` already encodes "confident" as an exact title match within a
  year. Reuse them rather than writing a second matcher.
- **Anything not confidently matched goes to `needs_review`**, exactly as an
  imported custom list does. The reconciliation screen already exists. Do not
  silently drop and do not silently guess.
- **Report the match rate.** If it comes in materially below the 98–100% the
  QID route achieves, that is a finding worth acting on, not a number to bury.

**Settled 2026-07-30: enumeration exists. The Wikipedia fallback is not needed.**

`GetPeliculasPreview` is only the type-ahead — a 3-character minimum, capped
results, and the wrong tool for this. The page's own search JS calls a different
endpoint, and its guard clause explicitly permits an **empty** `T_General` as
long as any one filter is set:

```
sortOrder, T_General, Metraje, Calificacion, Ano, Ano_Calificacion,
Paiscopro, Pais, Titulo, Director, productora, distribuidora,
Interprete, Fotografia, Guionista, Musica, SoloEspana, SoloVideo, SoloPorno
```

`Ano` is the axis this section said did not exist. Probed live:

```
GET /CatalogoICAA/?Ano=1994   42 pages x 24 = ~1,000 titles
GET /CatalogoICAA/?Ano=1961   22 pages
```

> **The trap, and it is the silent kind.** Plain
> `GET /CatalogoICAA/?Ano=1994&page=2` returns **HTTP 200 carrying page 1
> again** — pages 1, 2 and 3 came back with identical id sets. Pagination is only
> honoured with a session cookie *and* `X-Requested-With: XMLHttpRequest`; with
> both, the same three pages intersect at zero. A fetcher written the obvious way
> would collect the same 24 films 42 times, deduplicate to 24, and report
> success. Nothing throws, nothing 404s, and the per-year row count would look
> merely small rather than wrong — exactly the wrong-number failure mode `DECISIONS.md` §3 exists to prevent.

Two consequences for the build:

- **`SoloEspana=true` does nothing over the query string** (42 pages either way),
  so "Spanish films only" cannot come from the listing filter. The preview JSON
  carries an `EsCineEspanol` flag per film; that is the cut to use.
- **The listing is everything classified in Spain that year, foreign films
  included** — ~1,000 for 1994. So this enumerates the catalogue, and the
  Spanish-cinema filter happens after.

Rough cost: ~3,000 listing requests across ~75 years, plus one detail page per
Spanish film for the *espectadores* figure. Comparable to the France build.

**Match-rate floor, declared before the build rather than after** (per the
guard rails above): if confident title+year matching lands below **90%**, the
list is not seeded and the shortfall is investigated. The France route achieved
98–100% through QIDs; a materially worse number means the normaliser is wrong,
not that Spanish cinema is harder. And per `DECISIONS.md` §3, a rate is not
evidence — eyeball actual matched pairs, because 97% tells you nothing about
whether *Viridiana* matched the right film.

---

### 2. Alternative ratings — IMDb now, Letterboxd only researched
**IMDb, build it.** `title.ratings.tsv.gz` is ~8 MB, covers every title, is
refreshed daily, and joins **exactly** on `imdb_id` — which TMDB already returns
in the detail response, so there is no matching problem at all. Needs an
`imdb_id` column on `movies`, a backfill, and display beside the TMDB score.

> **Licence rule, non-negotiable:** the dataset is licensed for personal and
> non-commercial use, which fits this app — but it **must not be committed to
> the repo**. Fetch it at setup or refresh time and store only the derived
> numbers. This is the same distinction the `.gitignore` already enforces for
> `data/*.db`.

**Letterboxd: research only, do not build.** Historically no public API, believed
invite-only. **Their terms are the deciding factor and must be read before any
design** — do not assume scraping is acceptable. Any build is v5. Recording the
outcome of the research, either way, is the deliverable here.

SensCritique stays **closed**: verified 403 to scripted requests, same as
criterion.com.

---

### 3. National cinema night, and director night
Both are query-backed. The two dynamic-list gaps they depended on have landed —
rank is now written from discover order and the reconcile runs in a transaction
(`HISTORY.md` §6.4).

**National cinema night.** Already established as nearly free:
`movies.countries` is cached, and TMDB's `with_origin_country` works for a
dynamic list.

**Decided 2026-07-30: one parametric vibe, not one list per country.** The
alternative — a fixed, tagged list per country, groupable in the picker — is
simpler in isolation and reuses machinery that already exists. It loses on two
counts. It reintroduces the list-proliferation risk `BACKLOG.md` flags, at the
worst possible scale, since there is no natural stopping point between five
countries and fifty. And **director night needs the `▾` chip regardless**, so
the parametric shape is being built either way; choosing lists here means
building both interactions and maintaining them in parallel. One chip shape,
three callers — national cinema night, director night, and actor's night in v5.

> The related question, **"what is a *kind* of list?"**, is settled — the word
> was retired rather than defined (`DECISIONS.md` §4).
> The short version: a per-country dynamic list is not a third kind, it is a
> second query-backed list, and nothing new needs naming.

**Director night.** Resolve the person,
then `/person/{id}/movie_credits` filtered to `job=Director`. **Never
`with_crew`** — measured, it returns 112 films for Kurosawa including 1936
comedies where he was an assistant director, because it matches any crew role.

Parametric, so it needs the `▾` chip: a value chosen at selection time rather
than a list sitting in the picker. That interaction is the part worth getting
right, because **actor's night in v5 is the same shape with `job` swapped** — if
director night is built as a one-off rather than as "a credit-filtered person
list", v5 rewrites it.

---

### 5. A slot list needs to say whose it is

Found in real use, not by reading: applying **Director night ▾ → Robert Eggers**
correctly put his ten films in the pool, and Explore then showed ten films with
nothing anywhere saying *why*. It looks like the library changed under you.

The name already exists — the slot list is called "Director night — Robert
Eggers" — so this is a display gap, not a data one. Two places need it:

- **Explore**, which shows the films but never names the selection behind them.
- **The chip**, which reads "Director night ▾" whether or not a director is
  chosen. It should read back the current value once there is one.

Worth doing in v4 because it is the difference between a feature that works and
one a person can tell is working. The slot list is deliberately hidden from the
picker, which is exactly why nothing else surfaces its name.

---

### 4. Theme night — unblocked, not scheduled

Parametric like director night, keyword-based. Verified working:
`with_keywords=<christmas>` returns 306 films including *It's a Wonderful Life*,
*Klaus* and *The Apartment*. Keyword ids must be resolved via `/search/keyword`
first — you cannot query by string.

> Caveat: keywords are crowd-sourced and loose. The christmas query also returns
> *The Hunt* (2012), a Danish drama that merely contains a Christmas scene. Fine
> for inspiration, wrong for a strict promise.

Needs the same `▾` chip as director night, so it costs little once that lands.
