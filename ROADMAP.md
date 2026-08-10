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

**The feature is built.** A film saves from the card, the overlay and Explore;
the watchlist has a home in the Lists tab with a one-film search, an export and
an owner badge; and it has its own group in the picker. What is left below is
the tail, not the feature.

| Item | State | Where it stands |
|---|---|---|
| **One look on a real phone** | 🔨 doing | The only thing in v9 that landed **unverified**, and it is the part v7 proved cannot be checked any other way. Two things specifically: the poster-corner Save toggle at 44px, and the taller `.chip` and `.tab`, which change layout **app-wide** rather than just adding a control. Reverting either is cheap; shipping a card that wraps is not |
| Re-fetch the three award lists whose years are now parseable | ⏳ ready | The César and Goya parses are fixed but the **committed seeds still carry the old output** — four films across the two with a null `award_year`. Only a re-fetch writes them properly, and it needs credentials. Cheap: these are the category-and-Wikidata lists, not the box-office crawl |
| Whatever the next night turns up | ⏳ ready | The v7 loop found more in an evening of real use than four review passes found in a day, and it held through v8. Keep `NOTES.md` as the inbox and fix from it |

**`HISTORY.md` is owed nine chunks.** v8 closed having written up three of six,
and that was called out in its own closing section as the process finding of
the version — so leaving v9 in the same state would be the same mistake with
the note already written. It is not urgent and it is not free; do it before
v9 closes, not after.

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
