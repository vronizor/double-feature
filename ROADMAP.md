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
| Can a parametric list be ranked? | ⏳ ready | **Investigation only, no build.** Director night materialises a slot list; whether it can carry a rank at all is the question. Build, if it turns out to be possible, is v6 |
| "Custom" reads as a chip you can press | ⏳ ready | It is a status readout — "no vibe; you built this pool by hand" — sitting in a row where everything else is a control. It is not clickable and should not look like it might be |
| A long director's name wrecks the meta line | ⏳ ready | **Two symptoms, one cause**, both from field notes. Mild: it breaks as `1994 ·` / `Krzysztof Kieślowski`, stranding a separator. Severe: with `Estibaliz Urresola Solaguren` the rating is pushed out of the card and clipped, leaving a bare `★` with no number. Caused by the v4 fix that made names unbreakable — the name can no longer split, so the whole name moves and everything after it is pushed off the line. Fixing it means deciding what the separator binds to, and whether the rating may wrap away from its star |
| Award badge years | ⏳ ready | Show the year each award is naturally labelled by. Needs the honoured year **scraped** from the ceremony article, never derived — see `BACKLOG.md` |
| `includeWatched` default | 🗣 open | README says exclude, the UI ships include. Inert until something is actually marked watched |
| LICENSE, and seed-list provenance | 🗣 open | Not code. The repo is public and therefore all-rights-reserved by default; TSPDT's complete 1,000-entry ranking is the strongest provenance flag — see `docs/evidence/publication-audit.md` |

Deferred, so they are not re-proposed early: **v6** — a design pass with
Impeccable, and letting the reconciliation screen reach already-resolved
entries. **Unscheduled** — cultness, Letterboxd, household memory, nominees as
well as winners, and box office beyond France/Spain/US. All in `BACKLOG.md`.

---

### 1. Traps carried into v5

Read `DECISIONS.md` §3 first. The two that bit hardest in v4 and will bite
again:

- **A source can answer successfully with less than it has.** Locale-gated
  data, pagination that re-serves page 1, an export with the right MIME type
  and no data in it. Check that a 200 carries what it should.
- **A guard sits downstream of the number it checks.** A match-rate floor
  cannot see that the matched films are the wrong ones. Inspect values, not
  just volumes — every real failure in v4 was found by a count that did not add
  up, never by a threshold.
