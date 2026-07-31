# Decisions

**Read this at the start of every session.** It exists so a cold session does
not re-propose something already measured and killed, or re-derive a rule that
cost real time to learn.

Everything here is durable: it was true when written and will stay true, because
none of it describes code. Where a decision needed a long measurement to settle,
the statement is here and the working is in `docs/evidence/` — read that only if
you are reopening the question.

Organised by what re-proposing it would cost you.

---

## 1. Reversals — measured, killed, do not re-propose

**❌ Certification filtering is unsafe for a kids' night.** Asking TMDB discover
for `certification_country=FR&certification.lte=TP` returned **Schindler's List,
The Godfather Part II and Pulp Fiction**. French ratings are far more permissive
than expected, pre-1980 films are mostly `NR` (which means *unrated*, not
*safe*), and the discover-level filter does not even respect the per-film data.
The failure mode is showing Schindler's List on family night. The existing
curated family lists are strictly better.

**❌ `with_crew` is unusable for director night.** It matches any crew role, so
Kurosawa returns **112** films including 1936 comedies where he was an assistant
director. Re-verified against the live API 2026-07-30: his crew list is 183
entries, of which 32 are `job=Director` and the rest include 13 "Assistant
Director" and 11 "Third Assistant Director" credits on other people's films. Use
`/person/{id}/movie_credits` filtered to `job=Director`.

**❌ TMDB has no awards data.** Its `oscar` keyword tags nine films in total.
There is no awards field. Awards must come from outside TMDB. Do not revisit.

**❌ A reach-sorted "popularity" list.** Framed as a third axis — "box office
surfaces *Ch'tis*, reach surfaces *Ace Ventura*" — which does not survive the
numbers: *Ace Ventura* was a $72M US box-office hit, about thirteenth for 1994,
so the film used to justify the axis is reached without it. Vote-count "reach"
measures **anglophone familiarity**, not popularity. Superseded by extending box
office to the US. See [popularity vs acclaim](docs/evidence/popularity-vs-acclaim.md).

**❌ A derived award year (release year + 1).** It would silently mix real and
guessed data in one field, and a confidently wrong year is worse than an absent
one. It is also not a constant offset — Cannes awards a film in its own release
year. See [award years](docs/evidence/award-years.md).

**🔻 Streaming is a link, not cached data, and not a filter.** Two reversals in
sequence. First: measured FR flatrate coverage is ~30% of this library and skews
against the arthouse canon, so a hard filter would cut 2,036 films to ~600 —
absent must mean *unknown*, never *excluded*. Then: TMDB's own watch page is a
public URL derivable from the id already stored, which deletes the join table,
the region setting, the refresh-cadence change and the whole staleness problem.

**⚠️ The Modern Classics query needs a 5,000-vote floor, not 1,000.** At 1,000,
sorting by rating still returns *Gabriel's Inferno* — the exact noise that got
`/movie/top_rated` rejected in v1. At 5,000 it returns Top Gun: Maverick, Across
the Spider-Verse, The Wild Robot.

**✅ Awards come from Wikidata `P166`, constrained by `P31 = Q11424` (film).**
Without the `P31` constraint the query also returns the *producers*, who receive
the award too. 100% TMDB id coverage, cleaner than scraping. The endpoint is
flaky under load, so the fetcher needs retry/backoff — it is a build-time
script, not runtime.

**✅ National cinema needs no new data source.** `movies.countries` is already
cached, so it is a property filter over data the app holds. TMDB's
`with_origin_country` also works if a dynamic list is ever wanted instead — but
that is a different feature: filtering narrows the pool you have, discovering
adds films the library has never seen.

**❌ Wikidata for Spanish box office.** `P2142` + `P3005 = Q29` yields 26 films
total, and it is revenue rather than admissions. es.wikipedia has no per-year
series either. See [national box office](docs/evidence/national-box-office.md).

---

## 2. Not planned — deliberately never built

- **Kids' night by certification** — killed on evidence, above.
- **TMDB Top Rated 100** — 46% overlap with the existing pool, and the
  non-overlapping half was largely noise: `/movie/top_rated` has no vote floor.
- **Ballot-stuffing prevention** — out of scope by design. Trusted-friend model.
- **Silent Era PSFL as a seed list** — an exhaustive reference database of
  24,500+ films, not a curated "best of". Random draws would be a worse feature.
- **Per-person watched tracking** — needs accounts, which the whole app is
  designed around not having.
- **Worker-pooling the refresh job** — the protection already exists; every
  call is gated on a semaphore of 8.
- **The QR image re-request** — measured 2ms and 1.6KB per poll. Below the bar.
  Revisit only if someone actually sees a flicker.

---

## 3. Traps — they produce wrong answers without failing

These do not crash, throw, or drop a visible row. Every one was found by looking
at values and asking whether they could be true.

**`|+` is a table caption, not a cell.** On the 2013+ box-office pages the header
row follows the caption with no `|-` between them, so counting it as a cell
shifts every column index by one. It produced *plausible* numbers: Avatar at 2.7M
against a real 14.0M.

**Parse by column position, read from the table's own header row.** Never by
"first link" (which is the director in some layouts) or "first number" (which is
often not the admissions column).

**A citation URL can look like a number.** A bare-digit fallback matched the id
inside `boxofficestory.com/paris-1972-c23262779/2`, giving three unrelated films
23,262,779 admissions each. Three films sharing one impossible figure is what
gave it away.

**The ceremony year is NOT the year printed in the article.** Only the César
prints the ceremony year; the BAFTA and Goya articles tabulate by year-of-films,
and the offset is not constant — the 1st BAFTAs were held in 1949 and honoured
1947 releases. The article gives the winner; Wikidata's ceremony item gives the
date.

**`grep` treats `scripts/seed.mjs` as binary**, because its progress bar uses
box-drawing characters — so `grep -rn` finds *nothing* there and silently drops
the matches in a pipeline. **Use `grep -a` when sweeping this repo.** This nearly
cost a missed call site in a rename, and no test would have caught it.

**`node --check` passes on a missing import.** It is a syntax check, so a symbol
used but never imported only fails in the browser. Load every frontend module
under a stubbed DOM after touching them.

**A backtick inside a SQL comment terminates the `SCHEMA` string.** `server/db.js`
holds the whole schema in one template literal. Use plain words in those comments.

**Pre-1970s box-office pages use `[[Image:Flag of France.svg]]`**, not
`Fichier:` or `File:`. Missing that left a third of all rows with no country.

**Each box-office page carries a second table**, "Box-office parisien par
semaine", whose header normalises to `film 1` — which `startsWith` column
matching accepted as the title column. Match column names exactly. But note
that tightening to exact matching then silently emptied 1976–1982, because those
years write `Entrées<ref>…</ref>` and stripping the tags glues the footnote to
the column name.

**`seed.mjs` matches lists by NAME.** Renaming a list in its seed file alone
creates a *second* list beside the old one rather than renaming it. A rename
needs a migration.

**`renderSessionPanel` is shared between the host screen and the History tab.**
Anything that clears state on close must be gated to the host's own live
session, or opening an old session in History wipes the lineup being built. Pass
a callback rather than clearing from inside the panel.

**The fetchers need a declared minimum per source.** A Wikidata hiccup that
yields 3 César films instead of 51 will otherwise write a 3-film seed file and
report success; seeding it then shrinks the list.

**TMDB ids are overloaded and `tmdbUrl()` already handles it.** Ids are negated
for TV-sourced entries and synthetic below −1,000,000,000 for manual ones. Reuse
that helper, and render no link at all for a manual entry — it has no TMDB page.

**`pgrep -f` matches the watcher's own command line.**

**The `.gitignore` rule `data/*.db.*` is load-bearing.** A plain `*.db` pattern
does not match `double-feature.db.pre-v2` or the pre-migration snapshots, and
those hold real ballots and voter names. It is the single highest-consequence
line in that file.

**Never type a TMDB id from memory.** A check of the box-office language rule
used hand-guessed ids and gave the opposite answer, because *Le Dîner de cons*
resolved to the US remake *Dinner for Schmucks*.

**A note written to prevent a bug can cause it.** A recorded "invariant" about
ceremony years was wrong for two of three editions.

---

## 4. Naming and vocabulary — settled

- **An occasion is a vibe.** "Vibe" owns the schema, the API path and 100% of
  user-visible strings.
- **A published session is a vote**, not a "draw" — since a lineup can be built
  entirely by search or paste, a "past draw" can contain zero drawn films.
  "Vote" in UI strings, `session` in code.
- **`lists.kind` is `lists.origin`.** "Kind" was doing two jobs. There is no
  missing second axis: self-updating is `query_json IS NOT NULL`, subject matter
  is tags, and a metadata filter was never a list at all.
- **Every tag names a family, never a mechanism.** This is why `dynamic` became
  `modern`. A tag that means "this updates itself" gets silently inherited by
  every future query-backed list, sweeping them into a vibe they do not belong
  to.
- **Provenance, not `source`** — `source` meant both where a list came from and
  how a lineup film got there.
- **`is_active` means "in play by default when the app opens"**, written only
  from the Lists tab. Tonight's selection is view state.

---

## 5. Product shape

- **A vibe is a starting point, never a mode.** Hand-editing any list or filter
  demotes the chip to "Custom" rather than letting the UI claim a vibe it no
  longer matches.
- **Draw must work with no vibe selected.** Vibes are shortcuts that may be
  ignored, never a gate.
- **A vibe resolves to the union of its tags and its pinned lists.** Pinning is
  therefore *additive* — it cannot be used to exclude a tag match.
- **`rank IS NULL` must survive a top-N cut.** NULL means the list simply is not
  ranked; excluding those films would delete every unranked list from the pool
  rather than narrowing the ranked ones.
- **Take every row a box-office page lists.** No admissions threshold of our
  own; the pages already apply one.
- **Francophone by TMDB `original_language`, not by the country column.** The
  country column matches co-production paperwork: a country rule admits Dune and
  Kung Fu Panda 2 on Canadian credits, and drops the 183 rows with no country
  marker at all, which skew French.
- **Rank within the year at fetch time; do not store admissions.** The Top-N
  control already understands `rank`.
- **A weird year warns, it does not fail.** One odd page must not cost the whole
  fetch — but a layout change must get noticed.
- **Fuzzy title matching is accepted for the Spanish ICAA list, and only there.**
  Every other list resolves by TMDB id or Wikidata QID specifically to avoid it.
  Anything not confidently matched goes to `needs_review`; below a 90% match
  rate the list is not seeded.
- **National cinema night is one parametric vibe, not a list per country** —
  director night needs the same `▾` chip regardless, so it is built once and
  serves both, plus actor's night in v5.
- **Two chip rows with similar labels are left alone until real use.** The
  tag-filter row and the vibe row sit close together and share names: a chip
  "Awards" *selects* the awards lists while "Awards 5" merely *narrows what the
  picker shows*. Changing it on the strength of a code read would be guessing at
  a problem nobody has hit. The question to answer later is whether they were
  ever actually confused, not whether they look confusable on paper.

---

## 6. Process

- **Version numbering.** MAJOR is the roadmap version; MINOR is a decision
  round, bumped once per session in which decisions were actually settled. A
  session that settles nothing does not bump it.
- **A status of "ready" must not end in a question.** Three items were once
  marked ready while their own sections each ended with an open question. A
  state that overstates readiness is worse than no state, because the gap is
  only discovered after the work starts.
- **Findings are reported, not folded into the diff.** With one caveat learned
  the hard way: reporting a one-line production fix and then leaving it for
  three commits is a *second* decision, and it needs saying out loud.
- **Verify against the real API and the real database.** Several decisions here
  were reversed by measurement.
- **No `file:line` references, no counts, and no descriptions of current code
  behaviour in any startup document.** A full inventory of these docs found 24
  stale claims and **19 of them were counts or file pointers** — while not one
  decision had gone stale. If it describes code, it belongs in a comment beside
  that code, where whoever changes it will see it.
- **The database is snapshotted before migrations run.** It is the only
  unrecoverable asset: seeds can be re-fetched, but the watched set, saved vibes
  and every ballot exist nowhere else.
- **The test suite is hermetic.** No credentials, no network. A run must not
  depend on whose machine it is on.
