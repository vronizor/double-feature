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
| The picker's groups all default open | ⏳ ready | *(Found while collapsing the filter chips, 7.8.)* A picker group with a selection defaults to open, and the default state is all twenty lists selected — so a first load expands all eight groups and the rail is ~4,300px of mostly checked boxes. The rule is right where it came from (a group holding your selection should not hide it) and wrong at twenty-of-twenty, where it carries no information. **The question is what "has a selection" should mean when everything is selected**: possibly nothing, possibly a partial selection only |
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
