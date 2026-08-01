# Backlog

Improvements worth doing but not scheduled. Unlike `ROADMAP.md`, nothing here
is committed to a version — this is the "we noticed, we decided not to now"
list, kept so the reasoning doesn't have to be rediscovered.

---

## Evidence

The long measurement write-ups live in `docs/evidence/` rather than here, so a
session that only needs to know *what was decided* never pays to read *how it
was decided*. Each is read on demand.

| Write-up | Settled |
|---|---|
| [Award years](docs/evidence/award-years.md) | Scrape the ceremony tables. Option B (release year + 1) rejected — a confidently wrong year is worse than an absent one |
| [Popularity vs acclaim](docs/evidence/popularity-vs-acclaim.md) | Two different axes. Rating-sorted can never reach the 6.6–7.0 band people actually put on |
| [National box office](docs/evidence/national-box-office.md) | Per-year Wikipedia for France; ICAA for Spain. Vote counts measure anglophone reach, not national love |
| [Pre-publication audit](docs/evidence/publication-audit.md) | No secrets on any ref. Four questions consciously accepted |

## v5 — deferred with a decision, not undecided

These were considered during v4 planning and consciously pushed out. Distinct
from "Unscheduled" below, which is material nobody has ruled on yet.

- **US box office.** Moved out of v4 on 2026-07-30. The *axis* is settled and
  still supersedes the reach-sorted list below — that stays dropped. What is
  missing is a **source**: France had 82 verified per-year Wikipedia pages and
  the US equivalent was never probed, so the item had two open ends (source, and
  whether to rank dollars or find admissions) on a version that already carries
  Spain, IMDb and two dynamic-list fixes. See `ROADMAP.md` §6.2, which keeps the
  full reasoning.

  **US counted admissions: CLOSED, 2026-08-01.** There is no public, per-film,
  counted US admissions source, at any year, under any licence. Counted data
  *does* exist — Comscore Swift and EntTelligence measure actual ticket
  issuance — but it is a private settlement asset sold to studios, never
  published at title level. Every public "US tickets sold" figure without
  exception is gross ÷ average ticket price, including NATO's own and the MPA
  THEME reports, whose chart sources its attendance line to *"NATO (Ticket
  Price), BLS (Consumer Price Index)"*. Lumiere has no US market. The
  structural reason: France and Spain publish admissions because a state
  mandate compels it; the US chose private measurement instead.

  > **And admissions would be a worse cross-era measure than it looks, even if
  > it existed.** US admissions ran ~4 billion a year in the 1940s against a
  > population of 140M, peaked at 1.58bn in 2002, and are ~780M in 2025 — while
  > population grew ~20%. A raw count therefore measures **how central cinema
  > was to the culture in the release year**, not how popular the film was. Any
  > cross-era use needs normalising per capita, at which point it becomes a
  > share-of-audience metric and the counted-versus-estimated distinction
  > largely stops mattering. This is the same reason ranking happens within a
  > year and never across.

  **Sourcing answered 2026-07-31.** Three findings, one of which dissolves the
  blocker:

  - **The US has no COUNTED admissions.** Every "tickets sold" figure for the
    US is derived — gross divided by that year's average ticket price. France
    and Spain both count actual tickets. So a US admissions column would be an
    estimate wearing the same name as two columns of measured data, which is
    worse than not having it.
  - **⚠️ `<year> in film` changes units THREE times and says nothing.**
    1950–1975 is domestic **rentals** (the distributor's share, ~40–50% of
    gross); 1980–1987 is domestic **gross**; and **1988 onward is WORLDWIDE
    gross** — so the modern half is not a US list at all. The flip is exactly
    between 1987 and 1988. A single parameterised fetcher over this family
    would concatenate three incompatible things into one list. Ten rows a year,
    against France's 30–80.
  - **✅ The source to use: `List of <year> box office number-one films in the
    United States`.** Verified: exists **1946–2026 with no gaps**, ~50 weekly
    rows per year, 8–43 distinct films, titles wikilinked → QID → TMDB, so **no
    fuzzy matching**. CC BY-SA, so derived data may be committed.

    Its real advantage is that **"was #1 for at least one weekend" is a rank,
    not an amount** — so ticket-price inflation, rentals-versus-gross and
    dollars-versus-admissions all stop mattering at once. It answers the
    question admissions were wanted for, without needing admissions.

    It reaches the register too: 1994 yields *Ace Ventura*, *Dumb and Dumber*
    and *The Mask*.

    > **⚠️ It is NOT the same metric as France, and the list must not pretend
    > otherwise.** France ranks by magnitude — tickets sold, 30–80 films a year.
    > This is a membership test on peak position: did the film top the chart for
    > at least one weekend, 8–43 films a year, unranked. A film that sat at #2
    > for ten weeks behind a juggernaut is **excluded** despite outselling most
    > of the year, while a film that won one quiet January weekend is **in**.
    > 1965 yields eight films because *The Sound of Music* held #1 for months.
    >
    > **So name it for what it measures** — "US box-office #1s", not
    > "Box-office USA" — and say in the note that membership means topping the
    > chart, not selling the most tickets. It still carries the `box-office`
    > tag, so it groups with France and Spain in the picker; what it must not do
    > is imply their metric.

    > **Better still: the SAME pages carry an annual top-N table**, so no
    > stitching between families is needed. Verified across eleven years:
    >
    > ```
    > 1946        weekly #1s only, no annual table
    > 1950-1978   Rank | Title | Distributor | Rental      (1975 has none)
    > 1981-2026   Rank | Title | Distributor | Domestic gross
    > ```
    >
    > **Domestic throughout** — never worldwide, which is what disqualified
    > `<year> in film`. The rental→gross switch around 1980 does not matter,
    > because ranking happens only WITHIN a year: this is France's own rule
    > ("rank within the year, do not store the figure"), and applying it here
    > dissolves the units objection entirely rather than working around it.
    >
    > So there are two usable shapes on one page family: the annual top-N,
    > which is France's shape and ranks by magnitude, and the weekly #1s, which
    > is a membership test but has no gaps at all. **Prefer the annual table
    > where it exists and note the gaps** (1946, 1975 confirmed; the full gap
    > list is unmeasured).

    > Traps, found by inspection: the column order shifts (1946 leads with
    > `Week ending`, later years with `#`), so **parse by header**; `rowspan`
    > carries multi-week runs and a naive row reader drops them; 1946 has
    > literal `TBD` rows; **2020 has 30 weeks, not 52** — COVID, a real value
    > that would trip a France-style shrink guard, so whitelist it; and the
    > mid-1960s are genuinely thin (1965 gives 8 films, because *The Sound of
    > Music* held #1 for months).

  > **The dollars-vs-admissions objection dissolves under the rule this project
  > already uses.** France's decision was "rank within the year, do not store
  > the figure", because `list_movies` has no column for it and nothing displays
  > it. Apply that here and the rentals-versus-gross problem disappears too:
  > ranking only ever happens *within* one year, where the unit is consistent,
  > and no cross-decade comparison is ever made. What was blocking this item was
  > a question that the existing rule had already answered.

- **Award badges should show the year each award is NATURALLY labelled by —
  which is not the same rule for every award.** Raised from field notes:
  *Burnt by the Sun* renders "Oscar Intl. 1995" while Wikipedia and ordinary
  usage call it the **1994** winner. That is correct: we store the ceremony
  year, and the 67th Academy Awards were held in March 1995 for 1994 films.

  Spot-checked across the real database, and the conventions genuinely differ:

  | Award | Natural label | Ceremony year we store |
  |---|---|---|
  | Oscars, BAFTA, Goya | the year of the FILMS | one year later |
  | Cannes, Venice, Berlin | the festival year | the same year — no ambiguity |
  | César | the CEREMONY year (French usage: "César 2012" for a 2011 film) | already correct |

  So applying "year of films" everywhere would fix the Oscars and **break the
  César**.

  **Two tempting shortcuts, both unsafe, both already measured:**

  - *Subtract one from the ceremony year.* The offset is not constant — the
    1st BAFTAs were held in 1949 for 1947 releases.
  - *Use the film's release year.* **Nomadland** is the counter-example, live in
    this database: TMDB dates it 2021, it won the Golden Lion in **2020**, and
    its Oscar and BAFTA both honoured **2020** films. Every awards body calls it
    a 2020 film and TMDB does not.

  So the honoured year has to be a **scraped fact, not a derived one** — the
  ceremony article states which year's films it covers, and the fetcher already
  identifies that article. Real work, and the reason this is v5 rather than a
  label tweak. Note the data itself is right and should not be touched; what
  changes is which of two known true facts gets displayed. *(From field notes.)*

- **One rating shown, the other on hover — with a toggle for which is
  primary.** Currently both TMDB and IMDb sit on the card meta line, which is
  two numbers competing for the same glance. Better: pick one in settings and
  reveal the other on hover. The vote count should not be surfaced at all — it
  exists to decide whether a rating is *shown*, not to be read. *(From field
  notes.)*

- **Abbreviate country and language chips.** "United States of America" is a
  badge wider than the row it sits in. ISO alpha-3 (USA, FRA, JPN) for
  countries and the same treatment for languages. Cosmetic, but the country
  chips only just arrived and are the widest thing in the Filters card.
  Note `movies.countries` stores full names, so this is a display map rather
  than a data change — and the map has to be complete, because a country that
  falls through to its full name would be the widest chip again. *(From field
  notes.)*

- **Lumiere (European Audiovisual Observatory) — ~34 countries in one source.**
  Verified live 2026-08-01. `lumiere.obs.coe.int/movie/{id}` returns a
  `Market | Distributor | Release date | 1996 | … | 2025` table: per film, **per
  country, per year**, counted admissions sourced from the same statutory
  national tallies France's CNC and Spain's ICAA publish. *Parasite* returns 31
  markets — DE 1,077,773, GB 1,632,625, CZ 64,639. Plain `curl`, no account, no
  session, no locale trick.

  **One integration replaces a dozen national ones**, which is what Spain's
  15,000-page crawl argues for. Search is `POST /search` by title; there is no
  release-country filter.

  > **⚠️ The XLSX export is a decoy — verified.** `/movie/{id}/export` returns
  > HTTP 200, a genuine 11 KB spreadsheet, correct MIME type, plausible
  > filename — and **no admissions at all**. Its 136 strings are title,
  > director, production year, producing countries and a few external ids. A
  > pipeline trusting the file extension would ship a list with no data in it.
  > **The admissions exist only in the HTML.**
  >
  > That same export is quietly useful for a different reason: it carries
  > **IMDb and Wikidata ids per film**, which is the exact matching problem that
  > made Spain expensive.

  **Limits, all real.** Coverage is 1996–2025 only, so it cannot reach the
  1945–1995 span France and Spain already have. **There is no US market** —
  confirmed, so it does nothing for the US question. The licence grants
  nothing: `/disclaimer` is a copyright notice and a liability waiver, and
  production-country searches are capped at 200 results *"due to copyright
  restrictions from our data providers"*. **So: fetch at runtime, commit
  nothing** — the same rule as the IMDb dataset. And the figures are the
  Observatory's own "minimum estimates": *Parasite* shows **SE 274** for
  Sweden, which is not plausible, so per-country values need sanity-checking or
  a market whitelist before display.

  **Shape if built:** resolve films already in the library by title, parse the
  market table at runtime, cache locally, keep the cache out of git. Thousands
  of targeted fetches rather than a catalogue sweep.

- **KOBIS / KOFIC (South Korea) — the one worthwhile addition beyond Lumiere.**
  Korea sits outside Lumiere's footprint and its admissions are the most
  rigorously counted of any source found: KOBIS is the national ticketing
  reconciliation network, so `audiCnt` is actual ticket issuance rather than a
  tally after the fact. REST/JSON, free key, 3,000 requests/day; the endpoint
  answers live and returns a "key required" error unauthenticated. Unresolved:
  earliest supported date, exact terms. It is daily box office, so a film's
  total is accumulated across days rather than read off a lifetime table.

- **Checked and unusable:** **Japan/Eiren** publishes national aggregates
  1955–2025 and per-title figures in *yen*, not admissions. **BFI** publishes
  GBP gross per film and admissions only in aggregate — take GB from Lumiere.
  **Cinetel** (Italy) is a paid trade subscription. **FFA** (Germany) 404s at
  the documented URL. **PISF** (Poland) does collect mandatory returns but its
  box-office page timed out twice — unresolved rather than disproven, and
  Lumiere covers PL anyway.

- **Box office for other countries — partially surveyed, 2026-08-01.** The
  en.wikipedia `List of <year> box office number-one films in <country>` family
  exists well beyond the US, but **almost all of it is shallow**:

  ```
  Australia 1990-2025 (35y)   Japan (28y)        Mexico 2001-2026 (24y, gappy)
  South Korea 2006-2026       Turkey 2005-2025   Romania 2008-2026
  Spain 2007-2025             Italy (~20y, gappy)  Brazil (15y)
  Argentina · Chile · Colombia · Belgium · Taipei · Philippines · Canada — thin
  ```

  **That shallowness is disqualifying on its own terms.** France reaches 1945
  and Spain 1945 via ICAA; a list starting in 2006 would be exactly the recency
  skew that made the all-time French page the wrong source in the first place.
  These are era-unbalanced by construction.

  So the honest reading is that the per-year Wikipedia route is good for
  **France and the US only**, and any further country needs its own national
  source the way Spain needed the ICAA. Survey incomplete — headers and annual
  tables were not reached before the agent running it stalled.

- **Box-office France ranks globally; Box-office España ranks per year.**
  Found 2026-08-01 by checking the data rather than the doc, and they disagree.
  France is 1,390 rows with 1,390 distinct ranks and a single rank=1
  (*Bienvenue chez les Ch'tis*, the biggest French film of all time). Spain is
  76 rows with rank=1, one per year, max rank 20.

  **`HISTORY.md` §5.3 records the France decision as per-year** — *"the figure
  is used to order films within their year and written as `rank`… so 'the top
  20 of 1982' works with no new UI"*. That is not what was built, and "the top
  20 of 1982" does not work: Top-N=20 returns the twenty biggest French films
  ever, from twenty different years.

  Two consequences:

  - **The same Top-N control means opposite things on two lists carrying the
    same tag.** Top-N=10 gives France's ten biggest films ever and Spain's top
    ten of *every* year — 760 films.
  - **It undoes the reason France was built from per-year pages at all.** That
    source was chosen over the all-time page *for era balance*; a global rank
    with a Top-N cut reproduces the all-time page's recency skew exactly.

  **Cheap to fix, contrary to first appearance.** Re-ranking looks impossible
  because the admissions figures were deliberately not stored — but a global
  rank already preserves the correct relative order *within* each year, so
  per-year rank is a dense re-numbering of existing ranks grouped by year. No
  re-fetch, no new data.

  > Worth deciding at the same time whether **both** ranks are wanted. A global
  > rank genuinely answers "the 100 biggest French films ever", which a per-year
  > rank cannot; a per-year rank answers "the top 5 of each year", which a
  > global one cannot. They are different questions and `list_movies` has room
  > for only one. Per-year is the one the feature was designed around.

- **Cannes Grand Jury Prize as a second Cannes list.** Today only the Palme
  d'Or is carried. The Grand Prix is the runner-up award and reaches a
  different set of films. Same Wikidata `P166` route as the Palme, so it is a
  fetcher parameter rather than new machinery. *(From field notes.)*

- **The vibe delete button is too easy to hit.** The `✕` on an active vibe
  chip reads as "clear this selection" and actually deletes the vibe. One
  click, no confirmation on the affordance itself, and it sits where a
  deselect control would. Proposed: drop the `✕` entirely, let clicking an
  active chip deselect it, and move deletion somewhere deliberate — an "edit
  vibes" affordance. *(From field notes.)*

- **Do not auto-expand Pool setup when a vibe is applied.** Currently applying
  a vibe opens the setup panel. **This reverses a deliberate choice**, recorded
  in `views/draw.js`: the panel was opened so the host could see what the vibe
  actually did rather than take a one-line summary on faith. The counter-case
  is that it is noise every time, and someone who wants the detail can open it.
  Whoever does this should update that comment rather than leave it
  contradicting the code. *(From field notes.)*

- **Actor's night.** The same shape as director night — a credit-filtered
  person list with `job` swapped — which is why v4 builds director night as
  exactly that rather than as a one-off. See `ROADMAP.md` §6.5.

## v6 — deferred with a decision

- **Where the database lives — decide before the Pi.** It sits at
  `~/double-feature-data/double-feature.db`, reached by `DB_PATH`, because
  parallel worktrees each got their own empty `data/` and real state landed in
  whichever tree was last run. Merging per chunk removed that cause, so the
  outside-the-repo path is now belt-and-braces rather than load-bearing, and
  moving it back to `./data/` is a file move plus four lines of `.env`.

  Two things must stay true whichever way it goes. The database is **never
  committed** — it carries guests' names against their ballots in a public
  repo, and the IMDb-derived numbers are licensed for use and not
  redistribution. And on the Pi, `DB_PATH` must be **unset**: `docker-compose`
  bind-mounts `./data:/app/data` and passes `.env` into the container, so an
  absolute macOS path would send the container looking for a directory it does
  not have. *(Raised by the owner 2026-08-01: "we might swap it back in before
  sending to the pi".)*

- **A Box-office vibe.** *(From field notes, 2026-08-01.)* One chip selecting
  the box-office lists, the way Awards selects the award lists. Deferred rather
  than done because it is worth one chip only once there is more than one such
  list to gather: France and Spain are seeded, the US is a live v5 item, and the
  vibe is more useful built on top of the finished set than added now and
  edited twice.

- **Building a rank onto parametric lists.** *(From field notes, 2026-08-01.)*
  v5 answers only whether it is possible — see `ROADMAP.md`. The build lands
  here if the answer is yes.

- **Let the reconciliation screen reach ALREADY-RESOLVED entries, not only
  those under review.** Today it lists `needs_review` rows. A row that matched
  *confidently but wrongly* is `resolved`, so it never appears there and nobody
  ever looks at it again.

  That makes the two failure modes asymmetric in a way the guards do not
  reflect: an unmatched entry sits in a visible queue and can be fixed, while a
  wrong match is invisible and permanent. The match-rate floor guards the
  recoverable failure; nothing guards the unrecoverable one.

  > **The two examples this item used to cite are FIXED and must not be quoted
  > as live.** *Marco* (2024) resolving to the Malayalam film of identical
  > title and year, and *Tierra de Nadie* to *Mob Land*, were both corrected by
  > the Spanish-language candidate preference at the end of v4 — verified
  > against the database 2026-08-01: they now resolve to *Marco* (`es`) and
  > *Barren Land* (Spain/Mexico). Left here because the paragraph misled a
  > later session into reporting them as live defects. **The problem is real;
  > those instances are not.** The measured false-positive rate of about 3–4%
  > on a 57-pair inspection was taken *before* that fix and is unmeasured
  > after — which is itself the argument for this item, since nothing would
  > tell you if it had got worse.

  Wanted: browse a list's resolved entries, see what each matched to, and
  re-open one for correction. Cheap in principle — `list_movies` already stores
  `candidates_json`, and the screen already knows how to re-resolve a row.
  *(Raised by the owner while inspecting the Spain seed.)*

- **Run Impeccable over the UI** (`https://impeccable.style/`). A design tool
  for AI-generated interfaces — "the missing design vocabulary for agents" —
  offering a command set (`/polish`, `/distill`, `/typeset`) and a detector of
  58 checks for the visual tells of machine-written UI. Available as a Claude
  Code skill, an npm CLI, a Chrome extension and a CI step.

  **Why v6 and not sooner.** It is a pass over the *presentation* of a UI whose
  shape is still moving: v4 alone adds a parametric chip that does not exist
  yet, and a picker that has to survive a second family of query-backed lists.
  Polishing before those land means polishing twice. It also wants a stable
  design system to respect, and this app's is a single hand-written
  `styles.css`.

  Worth stating plainly because it is not obvious: **this is a cosmetic pass,
  not a feature**, and nothing in v4 or v5 depends on it.

## Unscheduled

Nobody has ruled on these. Where an item is scheduled, `ROADMAP.md` is the
authority on its state — this file only says why it is worth doing.

Cultness and Letterboxd moved here from v5 on 2026-07-31: both were "deferred
with a decision", and neither decision was really made. Cultness has no data
source at all, which is the whole problem rather than a scheduling detail, and
Letterboxd depends on an answer nobody has yet obtained. Committing a version
to something unobtainable is how a roadmap stops being believed.


- **Cultness.** The axis that survives the reach-sorted list being dropped:
  films whose fame arrived *after* the cinema, through television and home
  video. *Le Père Noël est une ordure* is the canonical case — a modest
  theatrical run and total cultural saturation, invisible to every box-office
  source by construction. Needs its own evidence before it is built; there is
  no obvious data source, and that is the whole problem — which is why it sits
  here rather than in a version.

  **Researched 2026-07-31: no dedicated source exists, and three plausible ones
  fail on inspection.** Pageview *seasonality* detects calendar ritual rather
  than cultness — *Home Alone* scores 10.6 and *Die Hard* 6.3, but *The Big
  Lebowski* scores 1.14 and *Office Space* 1.11, below *Twister*. Wikipedia's
  `List of cult films` is real and substantial (2,754 films, CC BY-SA) and
  contains **none** of *Le père Noël est une ordure*, *Les Bronzés font du
  ski*, *La Cité de la peur* or *Les Tontons flingueurs* — the same anglophone
  skew already measured on vote counts, failing the exact case the feature
  exists for. Home-video sales are not public anywhere. TV audiences appear in
  fr.wikipedia prose with no numbers.

  **What does work, and needs no new source:** fr.wikipedia pageviews (CC0,
  free, no key) divided by admissions from the `Box-office France` pages the
  app already parses. Measured over 59 French films with ≥1M admissions across
  1979, 1982, 1988 and 1994, it ranks *Le père Noël est une ordure* **first**,
  then *Les Bronzés font du ski*, *La Cité de la peur* and *La vie est un long
  fleuve tranquille* — four of the top five are the target register, and
  ordinary blockbusters sit 3–5× lower.

  Not yet trustworthy: *La Reine Margot* is a false positive at rank 5 (the
  article draws traffic for the historical queen), *Le Gendarme et les
  Extraterrestres* a false negative at the bottom (its fame flows to the series
  article), and n=59 across four years of one country is suggestive rather than
  validated. **Validate against a labelled set of 30–50 films before this
  becomes a version item.**

- **Letterboxd ratings — ❌ CLOSED, answered 2026-07-31.** Not "no API today";
  an explicit, current, published refusal, plus a terms clause forbidding the
  fallback. Both checked live.

  Their API beta page states access is not granted *"for data-analysis,
  visualization or recommendation projects, for LLM or GPT-related use, for
  private or personal projects"* — three of which describe this app exactly.
  `api.letterboxd.com` returns 401, the docs 403.

  Their Terms of Use forbid *"any robot, spider, scraper, deep-link, or other
  automated data gathering or extraction tool"*. Note `robots.txt` would have
  given the wrong answer: it permits `/film/<slug>/` pages. The prohibition is
  in the terms, not in robots.txt.

  The only machine-readable thing offered is a per-member RSS diary — one
  person's own ratings, carrying a handy `tmdb:movieId`, but not the community
  average, so it cannot serve "alternative ratings" at all.

  **This does not become yes without Letterboxd changing policy.** The v4
  research debt is discharged; the item is closed rather than parked.

- **Household memory.** The app picks a winner and then learns nothing —
  `watched` is only ever set by hand, so nothing accumulates between nights.
  Beyond `ROADMAP.md` F3 (mark the winner watched), the fuller version is a
  one-tap rating from guests' phones after the film, while the ballot is still
  open. No accounts needed: the session already knows who ranked. Would give
  History something worth revisiting and the exclusion filter something to work
  with.

- **Nominees, not just winners.** Wikidata models nominations (`P1411`) and the
  Wikipedia categories have sibling nominee categories. Would multiply the pool
  considerably and dilute "award winner" as a signal; noted rather than
  proposed.

## Dropped

- **A reach-sorted "popularity" list.** Dropped during v4 planning
  (2026-07-30). It was framed as a third axis — "box office surfaces *Ch'tis*,
  reach surfaces *Ace Ventura*" — and that framing does not survive the numbers.

  *Ace Ventura* **was** a US box-office hit: roughly $72M domestic in 1994,
  about thirteenth for the year. It sits comfortably in any per-year US
  box-office list, so the film used to justify the axis is reached without it.

  And "reach" measured by vote counts carries the exact language skew measured
  further up this file: *Le Père Noël est une ordure* has 11,588 IMDb votes not
  because it is obscure but because it never left France. So vote-count reach
  measures **anglophone familiarity**, making it a worse-sourced restatement of
  "was this big in America" — which US box office answers directly.

  **Superseded by extending box office to the US** (`ROADMAP.md` §6.2).

  > What genuinely survives is a *different* thing: films whose fame arrived
  > **after** the cinema, via television and home video. *Le Père Noël est une
  > ordure* again — a modest theatrical run and total cultural saturation. That
  > is **cultness**, no box-office source can see it, and it is a v5 item
  > needing its own evidence. It is not reach.


- **Worker-pooling the refresh job.** `refreshStaleMovies` does `Promise.all`
  over up to 250 films, which looks alarming but isn't: `request()` in
  `server/tmdb.js` already gates every call on a semaphore of 8
  (`MAX_CONCURRENCY`), so those 250 promises queue behind it rather than firing
  concurrently. The protection already exists.
