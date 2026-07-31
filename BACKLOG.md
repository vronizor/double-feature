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
