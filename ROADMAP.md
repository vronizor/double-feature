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
| Pool setup leaves the flow | ⏳ ready | **The keystone; do this first.** A sticky rail at =1000px, a full-screen sheet below it. It reports pool state as removable pills and can never displace the Draw button, which today sits ~2,900px down a ~3,600px page with the panel open. Reuses `renderListPicker` and `renderFilterPanel` **unchanged** inside it — that reuse is what makes it a day rather than a week. **The risk is the sheet, not the rail**: there is no reusable overlay helper, so one gets extracted from `openMovieModal` first (focus trap, scroll lock, Esc). Ship the desktop rail alone if it needs halving |
| Sticky publish bar, and Add-a-film demoted | ⏳ ready | Second-biggest win and much the cheaper — a few hours, almost all inside `draw.js`. Publish and the Anonymous checkbox move into a `.lineup-sticky` copied from the existing `.vote-sticky`; today Publish sits below every card, and four screens down on a phone. "Add a specific film" becomes one permanent secondary button that **expands in place to full width**, resolving discoverable-but-rare: the card today is too big when unused and too small when used, crushing results into 480px. Merge its two inputs into one using the existing `parseTmdbInput` |
| One control shape stops meaning four things | ⏳ ready | Answers a question `DECISIONS.md` left open for two versions, and the answer is yes. Four pill rows sit within ~600px; four of seven vibe names recur verbatim below; with `Cinephile` active the group row still paints `All` in the same active yellow, so two contradictory "selected" states stack in one column. **Delete the tag-filter chip row outright** — it is a second narrowing mechanism over group headers that already narrow. Keep pills for vibes only; filters become checkbox-tokens |
| The meta line stops orphaning its separators | ⏳ ready | Third attempt, and the first two each moved the orphan rather than removing it: v4 left `1994 ·` trailing, v5's fix left `· ★ 6.0` leading. **CSS cannot express the rule** — there is no selector for "starts a line". Two parts: split the two logical rows so a dot never falls between `127 min` and `· Adventure, …`, then measure `offsetTop` after render and suppress `::before` on any item that begins a line. **Batch the reads**: all offsets in one pass, then all class writes, or a 100-card grid thrashes layout. Re-run on a debounced `ResizeObserver` |
| The modal earns its interruption | ⏳ ready | It has **zero actions** — you decide in the overlay, close it, then re-find the card to add the film. Give it `+ Add to lineup` and `Mark watched`. **And it never receives focus**: Tab after opening walks the page behind an `aria-modal="true"` dialog, focus never enters and never returns. Focus the close button on open, trap Tab, restore to the invoking title button on close |
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
