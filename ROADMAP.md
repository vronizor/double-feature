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

## v7 — the UI version

Every previous version added data. **This one changes only how it is shown**, and
the evidence for all of it is [docs/evidence/ui-review.md](docs/evidence/ui-review.md)
— four independent passes over the running app, three of which converged on the
same three problems without seeing each other's output. Read that before
proposing anything here.

The shape of the answer, in one line: **disclosure by destination, not
expansion in place.**

| Item | State | Where it stands |
|---|---|---|
| One control shape stops meaning four things | ⏳ ready | Answers a question `DECISIONS.md` left open for two versions, and the answer is yes. Four pill rows sit within ~600px; four of seven vibe names recur verbatim below; with `Cinephile` active the group row still paints `All` in the same active yellow, so two contradictory "selected" states stack in one column. **Delete the tag-filter chip row outright** — it is a second narrowing mechanism over group headers that already narrow. Keep pills for vibes only; filters become checkbox-tokens |
| The meta line stops orphaning its separators | ⏳ ready | Third attempt, and the first two each moved the orphan rather than removing it: v4 left `1994 ·` trailing, v5's fix left `· ★ 6.0` leading. **CSS cannot express the rule** — there is no selector for "starts a line". Two parts: split the two logical rows so a dot never falls between `127 min` and `· Adventure, …`, then measure `offsetTop` after render and suppress `::before` on any item that begins a line. **Batch the reads**: all offsets in one pass, then all class writes, or a 100-card grid thrashes layout. Re-run on a debounced `ResizeObserver` |
| The modal earns its interruption | ⏳ ready | **Half of this landed in v7.5.** The focus bug is fixed — the overlay extracted for the pool sheet takes focus on open, traps Tab, restores focus to whatever opened it, and locks the page behind it, and `openMovieModal` runs on it. What remains is the actions: it still has **zero**, so you decide in the overlay, close it, then re-find the card to add the film. Give it `+ Add to lineup` and `Mark watched` |
| The filter panel is too tall to live in a rail | ⏳ ready | *(From field notes, 2026-08-03.)* Genres, Country and Language are ~40 chips between them, so the rail is mostly one very long scroll and the year/runtime controls sit below all of it. Collapse the three chip groups, open the ones with a selection. The rail made this visible; it was the same length before, just further down the page |
| The vote panel's list summary stretches the page | ⏳ ready | *(From field notes, 2026-08-03.)* `filter_summary` is one unbroken line — "BAFTA — Best Film + BFI: Films to See by Age 15 + Box-office España + …" for 20 lists — and it pushes the QR panel wider than the viewport, taking the guest URL box with it. Pre-existing, not from the rail work. **The whole page gains a horizontal scrollbar**, not just that panel — the nav, the poster strip and the ballot all shift with it. It needs to wrap or clamp; the whole string is worth keeping somewhere, so clamp with the full text on hover rather than truncating the data |
| "Director night" should be "Director's night" | ⏳ ready | *(From field notes, 2026-08-03.)* To match "Actor's night" beside it. **Not a seed-file edit**: `ensureBuiltinVibes` skips any vibe whose NAME already exists, so changing `BUILTIN_VIBES` alone is a no-op on every database that has booted once — and would leave new databases saying one thing and existing ones another. Needs a migration that renames the row, in the shape of `retagDynamicAsModern` |
| Explore puts its library first | ⏳ ready | ~1,600px of controls before the first poster, on a tab headed "Explore the library". Give it the **same rail** the Draw tab gets — one component paying for itself twice — leaving the main column as title, search, sort, grid. Also erases a live inconsistency: Explore's picker has no collapsed state while Draw's does, so its own "same filters as Draw" subtitle is not true of the chrome |
| The duplicate list rows | 🗣 open | Disney Animated Canon and Studio Ghibli each appear under Family, Animation **and** Collections; the award lists under both Awards and Festivals. So 29 rows sit under a header reading "20 of 20 lists selected" and the group totals do not reconcile — which reads as a bug. **The question is which fix**: show each list once under a primary group with its other tags as faint labels, or keep the repetition and make the counts honest. A list genuinely belongs to several tags; that is the whole point of tags |
| Tap targets, and a real device check | 🗣 open | `.btn-sm` ~27px, `.chip` ~26px, `.vibe-edit` ~18px, `.modal-close` 30x30 — all under 44x44. **But every mobile claim in the evidence is derived from the stylesheet, not measured**: `resize_window` silently failed in two separate agents, so nothing was ever rendered at 390px. Check on a real phone before acting, because the fix list is guesswork until then |

**Not in v7, deliberately.** The colour palette — liked as-is, and the amber does
exactly one job. Another Impeccable pass: the detector produced one actionable
finding across the whole UI and missed a WCAG failure, and `/polish` cannot be
scoped below one file. Both recorded in `BACKLOG.md`.

Deferred, so they are not re-proposed early: **Unscheduled** — cultness,
household memory, nominees as well as winners, box office beyond
France/Spain/US, where the database lives, and a LICENSE. All in `BACKLOG.md`.
Letterboxd is not deferred but **closed** — an explicit published refusal, not a
"not yet".

---

### 1. Traps carried into v7

Read `DECISIONS.md` §3 first. The three data traps below still apply to any
fetcher work, but **v7 is a UI version and its traps are different in kind** —
they are about believing a tool or a reviewer rather than misreading a source.

- **A clean report from a deterministic scanner is not evidence.** The UI
  scanner run in v6 passed this app while it was failing WCAG AA at 3.66:1, and
  said nothing at all about the panel density that prompted the exercise. It did
  catch every defect on a deliberately-bad control page, so it was working. A
  scan is a floor. **Always run a control before believing a clean result.**
- **A reviewer's specific claim can be confidently wrong.** Of the defects
  reported across four passes, one was backwards — the QR was blamed for a fault
  that belonged to the link beside it — and one was overstated until real
  screenshots settled it. Every claim acted on in v6 was verified in source or
  by calculation first, and that is the only reason the fixes were right.
- **A browser tool can report success and do nothing.** `resize_window`
  returned success in two separate agents and never reflowed the window, so
  every mobile finding in the evidence is derived from the stylesheet rather
  than seen. **Nothing about the phone layout has actually been observed.**

Carried forward, unchanged, for any work that touches a source:

- **A source can answer successfully with less than it has.** Locale-gated
  data, pagination that re-serves page 1, an export with the right MIME type
  and no data in it. Check that a 200 carries what it should.
- **A guard sits downstream of the number it checks.** A match-rate floor
  cannot see that the matched films are the wrong ones. Inspect values, not
  just volumes — every real failure in v4 was found by a count that did not add
  up, never by a threshold.
- **A source can also answer with MORE than you asked for, in a shape that
  fits.** v5's US pages carried two annual tables measuring different things,
  and taking whichever parsed produced a list that was calendar-year before
  1982 and release-year after — plausible everywhere, coherent nowhere. When a
  page offers two tables, the question is not which parses but which one
  answers the question the list is asking.
