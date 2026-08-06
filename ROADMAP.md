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

## v9 — the watchlist

One feature, plus the small fetcher repairs that came out of scoping it. **A
watchlist is a list with an owner** — `lists.owner IS NOT NULL`, the same shape
of discriminator that already makes a list dynamic (`query_json IS NOT NULL`).
Not a new table: a custom list already carries films, joins the pool, survives
Top-N, can be pinned by a vibe and browsed on Explore, and all of that is
downstream code a watchlist needs and does not have to re-earn.

| Item | State | Where it stands |
|---|---|---|
| **`lists.owner`, one-entry add, export** | ⏳ ready | The column, `POST` of a single resolved entry (delete already exists), and a JSON export **in the seed-file shape** — `resolveEntry` honours a supplied `tmdb_id` and the Lists tab's file picker already takes `.json`, so import is the existing path taking its fast branch, not new parsing. Owner is a column rather than a naming convention for the reason `builtin_key` and `seed_key` both exist: the name is not the identity, and a rename must not detach a device from its own list |
| Device identity and the client store | ⏳ ready | Owner name in localStorage beside `prefs.js`; a module singleton mirroring `lineup.js` so the Save button renders its own state without a round trip per card. First Save on an unclaimed device asks once, creates the list, adds the film. Never asks again |
| The Save affordance | ⏳ ready | The overlay is free (`actions` is already a parameter) and Explore is free (shared card). The card itself is the open design: a third small button will wrap, and those buttons are already under the 44px the row below wants. **Measure on a real phone before choosing** between a poster-corner toggle and a third button — both poster corners are taken, by the award flag and the watched flag |
| Tap targets, twice deferred | ⏳ ready | **Measured on a real phone, and the stylesheet guesses were pessimistic**: `.chip` is 35px and `.tab` 36px, not the ~26px the evidence claimed. Still under 44 though, and `.vibe-edit` ("Edit") is **16px** — the worst by far, and it is the control that deletes a saved vibe. Raise the small ones toward 44 with padding rather than font size, starting there. It led v8 and before that v7, so it goes **with the Save affordance above**, while that card is on a phone being measured anyway — not as a row of its own that a third version can defer |
| The watchlist as a destination | ⏳ ready | See it, remove from it, add manually via the TMDB search the lineup already uses, with `addManualMovie` for anything not on TMDB. Its picker group is **derived from `owner IS NOT NULL`**, not a tag: tags are host-editable, so a tag could be removed or applied to a list that structurally is not a watchlist. A tag becomes right only if a "draw from everyone's watchlists" vibe is wanted, since `vibe_tags` is the only tag-shaped hook |
| The watched filter says what it does | ⏳ ready | It excludes a household fact, so a film one person watched alone is dropped for everyone — silently, which is the failure mode this repo cares about. The wording changes to name that ("only films nobody here has seen"); the data does not. The fuller fix is in `BACKLOG.md`, unscheduled, and needs a measurement of the real watched set first |
| Two fetcher one-liners | ⏳ ready | The César ceremony anchor stopped matching when two article lines lost the space after the bullet, so the newest winners are seeded with no ceremony year; Goya has the same symptom from a different cause. And `backfill-list-fields.mjs` looks lists up by name while the seeder keys on `seed_key`, so **any list the host renamed is silently skipped** — a casualty of the v8 key migration |
| The box-office fetchers skip the live year | ⏳ ready | A part-year top-20 enters the seed and can never be corrected, because the seeder is insert-only and ranks are written on insert. Excluding the live year is the small change; the alternative teaches the seeder to delete, which is a much larger one with a worse failure mode |
| Whatever the next night turns up | ⏳ ready | The v7 loop found more in an evening of real use than four review passes found in a day, and it held through v8. Keep `NOTES.md` as the inbox and fix from it |

Deferred so they are not re-proposed early: **v10** — Locarno, and the staleness
surface with a source-count probe. **Unscheduled** — the Pi deploy, per-person
watched, cultness, household memory, nominees as well as winners, box office
beyond France/Spain/US, where the database lives, and a LICENSE. All in
`BACKLOG.md`. Letterboxd is not deferred but **closed** — an explicit published
refusal.

---

---

### 1. Traps carried into v9

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
