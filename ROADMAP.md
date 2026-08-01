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

## v5

| Item | State | Where it stands |
|---|---|---|
| Box office — United States | ⏳ ready | **Source found and verified.** `List of <year> box office number-one films in the United States`: 1946–2026 no gaps, and the SAME pages carry an annual top-N table — `Rental` 1950–1978, `Domestic gross` 1981–2026, domestic throughout. Wikilinked, so no fuzzy matching — see §1 |
| Cannes Grand Prix | ⏳ ready | A second Cannes list beside the Palme. Same Wikidata `P166` route, so a fetcher parameter rather than new machinery |
| Actor's night | ⏳ ready | Director night with `job` swapped. The `▾` chip, the slot list and `applyParameter` all already take a `param.job` |
| Award badge years | ⏳ ready | Show the year each award is naturally labelled by. Needs the honoured year **scraped** from the ceremony article, never derived — see `BACKLOG.md` |
| One rating primary, other on hover | ⏳ ready | Two scores on one line compete for the same glance. Pick one in settings, reveal the other on hover, and drop the vote count from display entirely |
| ISO abbreviations for chips | ⏳ ready | "United States of America" is wider than the row it sits in. Display map only — `movies.countries` keeps full names |
| The vibe `✕` is too easy to hit | ⏳ ready | It reads as "clear this selection" and deletes the vibe. Clicking an active chip should deselect; deletion moves somewhere deliberate |
| Do not auto-expand Pool setup | ⏳ ready | **Reverses a decision recorded in `views/draw.js`** — update that comment rather than leaving it contradicting the code |
| `includeWatched` default | 🗣 open | README says exclude, the UI ships include. Inert until something is actually marked watched |
| LICENSE, and seed-list provenance | 🗣 open | Not code. The repo is public and therefore all-rights-reserved by default; TSPDT's complete 1,000-entry ranking is the strongest provenance flag — see `docs/evidence/publication-audit.md` |

Deferred, so they are not re-proposed early: **v6** — a design pass with
Impeccable, and letting the reconciliation screen reach already-resolved
entries. **Unscheduled** — cultness, Letterboxd, household memory, nominees as
well as winners, and box office beyond France/Spain/US. All in `BACKLOG.md`.

---

### 1. Box office — United States

**Source:** `List of <year> box office number-one films in the United States`
(en.wikipedia). Verified 2026-08-01: **1946–2026 with no gaps**, and each page
carries two usable tables.

```
weekly #1s     every year, ~50 rows        a membership test, no gaps anywhere
annual top-N   Rank | Title | Distributor | Rental          1950-1978
               Rank | Title | Distributor | Domestic gross   1981-2026
               absent in 1946 and 1975
```

**Take the annual table where it exists** — it is France's shape, ranked by
magnitude — and note the gaps. Titles are wikilinked, so identity goes
link → QID → TMDB id through the pipeline the award and France fetchers already
use. **No fuzzy matching**, unlike Spain.

**The unit changes and it does not matter.** Rentals are the distributor's
share, roughly half of gross, and the switch is around 1980. Ranking happens
only *within* a year, where the unit is consistent — France's own rule, and
applying it here dissolves the objection rather than working around it.

> **Do not use `<year> in film`.** Those tables switch to **worldwide gross in
> 1988**, so the modern half is not a US list at all. That is a change of what
> is measured, not of units, and no ranking rule rescues it.

**Name it for what it measures.** The weekly-#1s shape, if used, is a
membership test: a film that sat at #2 for ten weeks is excluded while one that
won a quiet January weekend is in. The annual table does not have that problem.

**There are no US admissions, and there never will be.** Every public "tickets
sold" figure is gross ÷ average ticket price, including NATO's own and the
MPA's. Counted data exists inside Comscore and EntTelligence as a private
settlement asset and is never published per title. France and Spain publish
admissions because a state mandate compels it; the US chose private
measurement. See `BACKLOG.md`.

---

### 2. Traps carried into v5

Read `DECISIONS.md` §3 first. The two that bit hardest in v4 and will bite
again:

- **A source can answer successfully with less than it has.** Locale-gated
  data, pagination that re-serves page 1, an export with the right MIME type
  and no data in it. Check that a 200 carries what it should.
- **A guard sits downstream of the number it checks.** A match-rate floor
  cannot see that the matched films are the wrong ones. Inspect values, not
  just volumes — every real failure in v4 was found by a count that did not add
  up, never by a threshold.
