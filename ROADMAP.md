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

## v8 — the bug-fix version, and the Pi

v7 changed only how things are shown, and it was the first version tested by
someone *using* it rather than by an agent driving a browser. That produced two
dozen fixes and a working loop: report from a phone, fix, refresh. **v8 keeps
that loop and adds nothing structural** — bugs found in use, plus getting it
onto the Pi.

| Item | State | Where it stands |
|---|---|---|
| **`DB_PATH` must be unset on the Pi** | ⏳ ready | **Read this before deploying, not after.** `docker-compose` bind-mounts `./data:/app/data` and passes `.env` into the container, and the working `.env` here carries `DB_PATH=/Users/…/double-feature-data/…` — an absolute macOS path the container has no way to reach. Recorded since v6 as the one thing to re-read before the Pi. The database itself is **never committed**: it holds guests' names against their ballots, and the IMDb-derived numbers are licensed for use and not redistribution |
| Tap targets | ⏳ ready | **Measured on a real phone at last, and the stylesheet guesses were pessimistic**: `.chip` is 35px and `.tab` 36px, not the ~26px the evidence claimed. Still under 44 though, and `.vibe-edit` ("Edit") is **16px** — the worst by far, and it is the control that deletes a saved vibe. Raise the small ones toward 44 with padding rather than font size, starting there |
| Lineup at three per line on desktop | ⏳ ready | Asked for directly. `.movie-grid.is-lineup` is `auto-fit, minmax(190px, 260px)`, which at the current body width fits **five** tracks before the cap squeezes them to ~200px each — so a five-film lineup reads as a scanning grid rather than the payoff. Pin three at the desktop breakpoint and leave the phone block at `max-width: 560px` alone. The 260px cap is load-bearing and must not simply be dropped: the poster is `aspect-ratio: 2/3`, so uncapped tracks stand a ~790px poster on the page. Note that the comment above that rule claims the cap already yields three at full width — it does not, so trust the measurement over the comment and correct it |
| A wider body | ⏳ ready | Asked for directly. `.app` is `min(1100px, 100%)`; take it to roughly 1240px. **Do this with the row above, not separately** — they interact, and the interaction is the whole decision: pinned to three columns in a wider body, either the cap holds and the lineup gains a gutter it did not have, or the cap rises and each card grows half again as tall as it is wide. Recommend raising the cap with the width so three cards fill the row, and looking at the Draw screen before keeping it |
| Whatever the next night turns up | ⏳ ready | The v7 loop found more in an evening of real use than four review passes found in a day. Keep `NOTES.md` as the inbox and fix from it |

Deferred, so they are not re-proposed early: **Unscheduled** — cultness,
household memory, nominees as well as winners, box office beyond
France/Spain/US, where the database lives, and a LICENSE. All in `BACKLOG.md`.
Letterboxd is not deferred but **closed** — an explicit published refusal, not a
"not yet".

---

### 1. Traps carried into v8

Read `DECISIONS.md` §3 first. The three v7 traps below were all paid for twice,
which is why they are here rather than in a comment.

- **At equal specificity, source order decides — and `.modal-card` is near the
  bottom of `styles.css`.** It silently won three times in one version: capping
  the pool sheet at `90vh` (631px of a 701px viewport), keeping its own
  `190px 1fr` poster grid so the sheet's sticky header rendered a third of the
  card wide, and doing the same to the shortcuts table. A modifier on a
  long-established class needs `.base.modifier`, not `.modifier`.
- **A hidden browser tab does not run `requestAnimationFrame`, cannot take
  focus, and does not animate a smooth scroll.** Three separate behaviours in
  v7 "failed" only because the automation tab was in the background. **"It did
  not happen in my check" is not evidence here** — confirm the tab is the thing
  at fault before changing code.
- **Restoring a scroll position clamps it against the container's height AT
  THAT MOMENT.** Set the height first, then the scroll. Reversed, the rail crept
  upward on every repaint.

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
