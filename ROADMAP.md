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

## v6

| Item | State | Where it stands |
|---|---|---|
| Re-match an already-resolved entry | ⏳ ready | **The only unrecoverable failure in the app.** A confident wrong match is `resolved`, so it never reaches the review queue and nobody looks again. The backend already allows it — the resolve route has no status guard and `raw_title` is kept on every row — so this is UI only. See `BACKLOG.md` |
| Rank a parametric list, by rating | ⏳ ready | Answered in v5: mechanism was never the blocker, and a slot list is wiped and rewritten on every apply so it has none of the stale-rank hazard. **Needs a vote floor decided first**, or it repeats why TMDB Top Rated 100 was dropped |
| A Box-office vibe | ⏳ ready | One chip gathering France, España and US, the way Awards gathers the award lists. Waited for the US list, which now exists |
| Where the database lives | 🗣 open | It sits outside the repo at `~/double-feature-data` because parallel worktrees each got an empty `data/`. Merging per chunk removed that cause, so moving it back is now a file move plus four lines of `.env`. **Decide before the Pi** — and note `DB_PATH` must be unset there, or the container hunts for a macOS path |
| A design pass with Impeccable | 🗣 open | Not settled that it is wanted. `https://impeccable.style/` — a detector of 58 visual tells of machine-written UI, plus `/polish` and `/typeset` commands. See `BACKLOG.md` |

Deferred, so they are not re-proposed early: **Unscheduled** — cultness,
Letterboxd, household memory, nominees as well as winners, box office beyond
France/Spain/US, and a LICENSE. All in `BACKLOG.md`.

---

### 1. Traps carried into v6

Read `DECISIONS.md` §3 first. Three now, because v5 added one:

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
