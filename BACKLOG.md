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

- **Cultness.** The axis that survives the reach-sorted list being dropped:
  films whose fame arrived *after* the cinema, through television and home
  video. *Le Père Noël est une ordure* is the canonical case — a modest
  theatrical run and total cultural saturation, invisible to every box-office
  source by construction. Needs its own evidence before it is built; there is
  no obvious data source, and that is the whole problem.

- **Letterboxd ratings.** v4 researches whether it is obtainable at all and
  records the outcome; any *build* is v5, and only if their terms allow it.
  See `ROADMAP.md` §6.3.

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


- **Alternative ratings on hover (IMDb, Letterboxd, SensCritique).** Show a
  second opinion beside TMDB's score on the card or in the detail overlay.
  Needs an assessment of what is actually obtainable — partial notes from the
  session that raised it:

  | Source | Status | Notes |
  |---|---|---|
  | **IMDb** | 🔨 **scheduled for v4** — see `ROADMAP.md` §6.3 | Official dataset `title.ratings.tsv.gz`, **8 MB**, every title, updated daily, free for personal/non-commercial use. Joins exactly via `imdb_id`, which TMDB already returns in the detail response — no fuzzy matching. Would need an `imdb_id` column plus a backfill. |
  | **SensCritique** | ❌ verified blocked | Returns 403 to scripted requests, same as criterion.com. The family-films seed list had to be exported by hand for this reason. |
  | **Letterboxd** | 🔍 **v4 researches it, does not build it** — see `ROADMAP.md` §6.3. | No public API historically; believed to be invite/beta only. Needs checking before any design — do not assume scraping is acceptable, their terms are the deciding factor. |

  Design notes if picked up: the licence on the IMDb data is
  personal/non-commercial, which fits this app but means **the dataset must not
  be committed to the repo** — fetch at setup/refresh time and store only the
  derived numbers. Worth deciding whether this is display-only (a second score
  in the overlay) or feeds a metric, because the popularity-vs-acclaim finding
  above showed that a bigger sample does **not** fix the language skew.

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
