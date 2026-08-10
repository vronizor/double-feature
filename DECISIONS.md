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

**❌ A derived award year FROM THE RELEASE YEAR (`movies.year + 1`).** It would
silently mix real and guessed data in one field, and a confidently wrong year is
worse than an absent one. It is also not a constant offset — Cannes awards a
film in its own release year. See [award years](docs/evidence/award-years.md).

**✅ But the DISPLAYED year may be derived from the CEREMONY year, which is a
different operation.** The ceremony year is scraped and stored; deriving from
it is arithmetic on a fact, not a guess about one. Measured across the whole
library: academies (Oscars, BAFTA, Goya) label by the films' year, so ceremony
− 1; festivals (Cannes, Venice, Berlin) award within the year, so no shift; the
César is named for its ceremony in French usage and was already right. The
constant holds for every award from the mid-1930s on. The known exception is
the 1st BAFTAs, held 1949 for 1947 films, which shows no year rather than a
confident wrong one. The two rules are easy to confuse and the difference is
the whole item: release year drifts from the awards world (TMDB dates Nomadland
2021 against everyone else's 2020, and The Graduate is a 1967 film BAFTA
honoured in 1969 on its UK release), while the ceremony year does not drift
because it was read off the ceremony.

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
  designed around not having. **The line is WHERE the identity is needed, and
  it was drawn deliberately in v9 rather than routed around.** Per-person
  watched needs to know who is asking on every **read** — the pool query itself
  gains an identity — and that is what makes it accounts. A personal watchlist
  needs one only at **write** time, to decide which list a Save goes to; every
  read path is the list selection that already exists, and a device that has
  never claimed a name loses nothing. So the watchlist is not a re-proposal of
  this, and this is still refused. Per-person watched is also simply the wrong
  shape for the moment of use: the host builds **one** lineup for a room, so
  the question a filter should answer is "something none of us has seen", never
  "new to whoever is holding the remote".
- **Worker-pooling the refresh job** — the protection already exists; every
  call is gated on a semaphore of 8.
- **The QR image re-request** — measured 2ms and 1.6KB per poll. Below the bar.
  Revisit only if someone actually sees a flicker.
- **A DDD re-architecture, and the `server/sessions.js` extraction that was its
  last survivor.** Both assessed and dropped 2026-08-01. The DDD case rests on a
  codebase too large to hold at once; this backend is not one, and changes here
  are vertical — schema to query to route to view to test — so layering
  lengthens the path rather than shortening it. Of the traps recorded in §3,
  exactly one has a DDD shape. The narrower extraction failed on its own terms:
  only a quarter of the SQL in that route file sits in the functions that would
  move, the rest is interleaved with request parsing, and `fail(message, status)`
  is the file's error currency — so the extracted module either speaks HTTP or
  grows an error taxonomy, which is the layer being avoided. The deciding fact
  is that nothing goes wrong today: that route file has been touched four times
  in the project's life, almost all of it the initial write, while the list
  fetchers absorb every version's work. **Cut seams where the changes are, and
  they are not here.**

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

**A self-closing `<ref name="x" />` breaks the naive wikitext strip.**
`s/<ref[^>]*>.*?<\/ref>//s` treats the self-closing tag as an opener and eats
everything up to the next real `</ref>`, which can be most of the page. Observed
consuming an entire 250-row table and reporting two rows. This repo parses
wikitext in several fetchers.

**`robots.txt` and a site's terms can disagree, in both directions.** The
Numbers' robots.txt does not restrict you while its terms forbid systematic
copying; Letterboxd's robots.txt permits film pages while its terms forbid all
scraping. Reading robots.txt alone gives the wrong answer for both. Read the
terms.

**The Wikimedia pageviews API resolves nothing for you.** A redirect returns
HTTP 200 with a full but wrong series — two orders of magnitude out — and a
disambiguation page does the same. Key pageviews on a **QID sitelink**, never
on a title. Series are also truncated by article renames, so compare rates,
not totals.

**At equal CSS specificity, source order decides — and `.modal-card` sits near
the bottom of `styles.css`.** It silently beat three separate modifiers in v7:
`max-height: 90vh` capped the pool sheet at 631px of a 701px viewport, and its
`190px 1fr` poster grid was inherited by both the sheet and the shortcuts card,
rendering a sticky header a third of the card wide and squeezing a table into
the second column. A modifier on a long-established class must be written
`.base.modifier`.

**A hidden browser tab does not run `requestAnimationFrame`, cannot take focus,
and does not animate a smooth scroll.** Three behaviours in v7 appeared broken
only because the automation tab was in the background — a focus call that never
fired, a scroll that never moved, an animation that never ran. **"It did not
happen in my check" is not evidence in this repo.** Establish whether the tab is
at fault before changing code; `document.visibilityState` and `document.hasFocus()`
answer it in one line.

**Restoring a scroll position clamps it against the container's height at that
moment.** Set the height first, then the scroll. Reversed, the rail crept upward
on every repaint, far enough to hide the group just clicked.

**A ceremony can have TWO winners, and the articles mark a tie by changing the
register rather than by repeating it.** Where a sole winner is bold-italic, the
tied pair is written in single italic; where a sole winner is single-italic,
the pair is bold. So a parser keyed on one marker finds *nothing* at a tie and
the year produces no pair at all — no error, and the film count still adds up,
because the films come from a category and only the year is lost. Live in the
Goya list until v9: the 39th went to El 47 and La infiltrada, both seeded
undated. The fallback's own trap is that **nominees are single-italic too**,
sitting in a bulleted cell in the same block, so a tie fallback must drop the
list items first — the same winner/nominee distinction the César anchor
relies on, inverted.

**An equality test against a CONTINUOUS score is never true, so a guard built
on one is not a guard.** The matcher sent a title to human review only when the
runner-up was confident *and* scored exactly the same — but the score ends with
a popularity term, so two candidates matching the same title in the same year
separate by a fraction and never tie. The condition could not fire. It read as
protection, its own comment said "rather than guessing on popularity", and
guessing on popularity is precisely what it did. Found in v9 on a real pair:
four confident candidates for one title-and-year, zero ties, and the wrong film
stored as `resolved` — which is the permanent, invisible kind. **Compare
outcomes, not scores**: the two candidates were already both flagged
`confident`, which was the whole answer.

**`clear(node).append(...)` is not `h(...)`.** `h` drops null children; `append`
is the raw DOM method and stringifies them, so a conditional child renders the
word "null" on the page. Shipped once, under the search box. Use `fill`.

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

**A built-in vibe's identity is `builtin_key`, never its name.** The name was
the identity until v7.9, and that was a bug rather than a shortcut:
`ensureBuiltinVibes` asked "is there a vibe called Cinephile?", so renaming one
made it invisible to the seeder, which created it again alongside. Measured
against the real route — rename, restart, eight built-ins where there were
seven. It also made every rename of a built-in its own migration, because
editing the seed array alone is a no-op on any database that has already
booted. With a key, a rename is a one-word edit to `BUILTIN_VIBES` and
`name_custom` stops the seed overwriting a name the host chose themselves.
**`lists` had the same disease and was cured the same way in v8**, by
`lists.seed_key` — the seed filename, which is also the slug the fetcher writes
the file under — plus `lists.name_custom`. The nine award lists were renamed in
one commit immediately afterwards, which is the thing that used to cost a
hand-written migration each.

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

**TMDB's search index covers every title a film has, but its RESPONSE does
not.** The index matches the English title, the original title, and every
per-country release title — verified: *Shichinin no samurai*,
*La Cité des enfants perdus* and *La ciudad de los niños perdidos* all return
the right film. But the payload carries only `title` and `original_title`, so a
match made against an alternative title comes back looking like a mismatch and
any exact-title check rejects it. **Ask in the language you are matching in**
(`language=es-ES`) and `title` becomes that release title. This was worth
11.9 points on the ICAA match rate — from 80.0% to 91.9% — after the failure
had already been written down as an unfixable limit.

**The ICAA catalogue serves box-office data only in the Spanish locale.** The
English pages render the same film without *Recaudación* or *Espectadores* and
without any tab where they would be. Nothing fails; the data is simply absent,
which reads as the catalogue not having it. Set `es-es` before fetching.

**Never type a TMDB id from memory.** A check of the box-office language rule
used hand-guessed ids and gave the opposite answer, because *Le Dîner de cons*
resolved to the US remake *Dinner for Schmucks*.

**A note written to prevent a bug can cause it.** A recorded "invariant" about
ceremony years was wrong for two of three editions.

**A back-fill must never INVENT the ordering it back-fills.** The migration that
split box-office ranks into per-year and overall filled `overall_rank` for every
list matching its name pattern — including one that had been shipped with no
global ordering on purpose, because its source has no cross-year figure. For a
list already stored per-year it wrote row position as the global rank, which is
year order wearing the name of a ranking. Every count checks out: the column is
100% populated and densely numbered. Only the values give it away, and only if
you read them — the top of that list is the earliest year, not the biggest film.
A nullable column left NULL is a fact; a nullable column filled with an artifact
is a lie that survives every guard.

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
- **An award list is named "Ceremony — Prize", both halves in the ceremony's own
  language.** `Oscar — Best Picture`, `César — Meilleur Film`,
  `Cannes — Palme d’Or`, `Venezia — Leone d’Oro`, `Berlin — Goldener Bär`. Left
  is the ceremony it comes from, right is which prize. Two grammars used to
  share the column — academies as "Body — Category" and festivals as
  "Prize (City)" — which is what put *Golden Lion (Venice) 1987* directly above
  *César — Meilleur Film 1988* in one overlay. Adding an award list means
  picking a side of the dash, not inventing a shape.
- **A `short_name` names the AWARD ITSELF, in the same language as the full
  name.** That is the LEFT of the dash for an academy — the statuette or the
  body: `Oscar`, `César`, `Goya`, `BAFTA` — and the RIGHT for a festival — the
  prize: `Palme d’Or`, `Leone d’Oro`, `Goldener Bär`. Never the ceremony:
  "Venezia" and "Cannes" are places, and a card reading *Venezia 1987* would
  name where a film went rather than what it won. **Recognisability lost to
  consistency here, deliberately and on a second look**: the first pass kept
  English "Golden Lion" against a native `Venezia — Leone d’Oro` on the grounds
  that it is the token an English reader knows fastest, and the card then
  disagreed with the overlay it opens. One award, one name. Two consequences
  worth knowing: no regex can derive this (which is why it is stored, not
  parsed), and an award list shipped without an explicit `short_name` falls
  back to stripping the qualifier and so reads as a **city**.
- **A personal list is a WATCHLIST, and personal means attributed, not
  hidden.** "Watchlist" over "queue" (which promises an order the feature does
  not have) and over "pile" (warmer, and closer to this app's other words, but
  it needs explaining the first time) — recognisability wins here because the
  point of the feature is that a family member uses it without a tour. The
  collision with `watched` is real and is resolved in the button rather than
  the noun: the control reads **Save / Saved**, the thing is Alice's watchlist.
  And everyone can see everyone's: on a household Pi on a home LAN privacy is
  not the goal, not stepping on each other's is — and hiding would break the
  feature's own purpose, since the draw happens on the host's device.
- **A name in a non-Latin script is ROMANISED, not translated and not left
  native.** `Jinma Jiang — Zuijia Juqingpian`, not `金馬獎 — 最佳劇情片` and not
  `Golden Horse — Best Narrative Feature`. The rule above says a list is named
  in the ceremony's own language, and every example that settled it happened to
  be Latin script, so it never had to say which of the two properties it meant.
  It means the LANGUAGE. Its actual reasoning was that a card and the overlay
  it opens must not disagree about what a film won, and romanisation preserves
  that exactly while staying legible on a household's devices and sortable
  beside everything else. Translating to English would break it, because then
  the award has two names again. Settled before the first such list was built
  rather than after, so Hebrew and Arabic do not each get decided by whoever
  ships them.
- **Watched films are INCLUDED in draws by default.** The README said the
  opposite for two versions while the UI shipped this, and the UI was right: a
  household rewatches, and a film you loved is a good thing to draw again.
  `watched` is a record of what you have seen, not an exclusion list, and the
  Pool setup filter is there for the nights you want something new.
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
- **Top-N means "the top N of each ranked GROUP", and the group is whatever the
  list ranks within.** TSPDT ranks within itself, so its group is the list and
  N=10 gives ten films. A box-office list ranks within a year, so its group is a
  year and N=10 gives ten per year. That is one rule, not two, and it is the
  rule that produces era balance — the reason per-year sources were chosen over
  the all-time pages at all. What it does NOT do is predict the pool size, and
  that is the part the interface owes the reader: the summary says which group
  the cut applied to. **A second control for the other kind of cut was
  considered and rejected** — on most of a selection one of the two would always
  be a no-op, which is the lookalike-controls trap recorded above.
- **A parametric list ranks by RATING, above a 1,000-vote floor.** Chronological
  rank would make "top 10" mean "his first ten films", which is why the code
  refused to rank these at all. Rating is a meaning that works. The floor is the
  existing `IMDB_VOTE_FLOOR`, not Modern Classics' 5,000: a filmography is 20–40
  films, and 5,000 votes would strip most pre-1960 work out of a Kurosawa or Ozu
  list — the opposite failure to the one the floor exists to stop.
- **Take every row a box-office page lists.** No admissions threshold of our
  own; the pages already apply one.
- **But not the year that is still running.** A year only enters once it has
  closed. Measured: the just-closed year is rewritten heavily through March and
  settles in April, so a fetch in August seeds a part-year ranking that is
  simply wrong by January — and it cannot be repaired, because the seeder is
  insert-only and a rank is written on insert, so a re-fetch that demotes a
  film cannot demote it in the database. The alternative, teaching the seeder
  to delete and re-rank, buys a small correctness win by turning a safe
  insert-only path into one that can remove films from a list someone is
  drawing from. Skipping the live year is one condition and no new failure
  mode.
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
- **A co-production counts as national cinema for every country that made it.**
  Not a tolerance — the main case. Measured: Italy is **53** films as a sole
  producer and **498** counting co-productions, and the excluded 445 include
  *8½*, *La Dolce Vita*, *Cinema Paradiso* and *Le Trou*. A sole-producer rule
  would have deleted most of the Italian canon from Italian night. The clause
  therefore matches whole entries in `movies.countries` and a film belongs to
  each of its countries.
- **National cinema night is one parametric vibe, not a list per country** —
  director night needs the same `▾` chip regardless, so it is built once and
  serves both, plus actor's night in v5.
- **The chip rows WERE confusable, and the answer came from use.** This entry
  used to say they were left alone until real use, because changing them on the
  strength of a code read would be guessing at a problem nobody had hit. That
  was the right call and the question is now answered: **yes**, and by more than
  was suspected. There are four pill rows within ~600px, not two — vibe presets,
  list-group chips, metadata filters and display toggles — all sharing one shape
  and one active colour. Four of seven vibe names recur verbatim in the row
  below, and with `Cinephile` selected the group row still paints `All` in the
  same active yellow, so two contradictory "this is selected" states stack in
  one column. **Deleted in v7.13**: the tag-filter row was a second narrowing
  mechanism over group headers that already narrow, and it carried the
  contradictory `All`. What remains is two kinds of control that look like two
  kinds of control — a **pill** is a preset you apply, a **token** is a value
  you include or exclude. Tokens are square-cornered and carry an explicit `+`
  or `−`, so the tri-state no longer rests on colour alone. See
  [the UI review](docs/evidence/ui-review.md).
- **Disclosure by destination, not expansion in place.** A panel that triples
  the page when opened has not deferred its complexity, it has relocated it into
  the middle of the primary flow — measured, it pushed the Draw button ~2,900px
  down a ~3,600px page. Configuration belongs somewhere the primary action
  cannot be displaced from: a rail beside the flow, or a sheet over it. The
  reference products this app is measured against do the same — neither solves
  density with an accordion.

---

## 6. Process

- **A guard sits downstream of the number it checks.** A match-rate floor
  cannot see that the films it matched are the wrong ones; a per-year row-count
  alarm cannot see that every row is the same 24 films. Every real failure in
  v4 was found by a count that did not add up — 81 rank-1 rows against 82
  years, 1,450 films where 1,570 were expected — and none by a threshold.
  **Inspect values, not just volumes.**
- **An unmatched entry is recoverable; a wrongly matched one is not.** The
  reconciliation screen shows only rows that failed to match, so a confident
  wrong match is `resolved`, invisible and permanent. The match rate therefore
  guards the recoverable failure while nothing guards the other. Measure the
  false-positive rate separately, by inspecting pairs.
- **Establish whether the current MAJOR is CLOSED before proposing any work,
  in the same breath as reading `ROADMAP.md`.** It is one line —
  `git tag -l` against `package.json` — and skipping it in v9 cost a round
  trip: the session read two unfinished v8 rows, concluded v8 was open, and
  recommended holding the version for them. Both halves were wrong. The rows
  were real but a MAJOR closes with rows outstanding as a matter of course —
  v7 closed handing the tap targets to v8, in a paragraph in `HISTORY.md`
  headed "One thing did not get done" — so open rows are not evidence about
  the version at all. **A row's state and a version's state are different
  facts**, tracked in different files, and the roadmap's own three states
  exist precisely so unfinished work can cross a boundary without anyone
  having to decide what that means. Read the tags, not the tables.
- **Version numbering.** MAJOR is the roadmap version; **MINOR is the number of
  chunks landed in it** — a chunk being one finished, verified piece of work,
  usually one commit. So v4.12 means twelve pieces of work have landed in v4,
  which is countable from the log rather than a judgement call. It replaces
  "decision rounds", which nobody could count the same way twice.
- **Every MAJOR close is a tagged GitHub release — not every chunk.** Started
  2026-08-04, on the owner's request, after noticing the practice was missing.
  Chunk-level tagging was tried first and dropped the same day: this app has
  one audience, its own household, and `HISTORY.md` already gives every chunk
  a prose write-up — a release at that grain would mostly restate it. A MAJOR
  close already gets a real closing section (`HISTORY.md` §8.14, §9.8, §10.25)
  that reads as release notes without editing, and at the pace this project
  moves — 23 chunks in v7 alone — chunk-level releases would have buried the
  moments actually worth finding again under the ones that were not.

  Backfilled for v5.0.0, v6.0.0 and v8.0.0 — the only commits in this repo's
  history where `package.json` ever actually read a clean MAJOR.0.0. v1–v3
  never carried a real version (`package.json` stayed `1.0.0` throughout), and
  v6's close forgot to bump MAJOR, so `7.0.0` was never written anywhere — it
  is not a gap in the backfill, it is a gap in the history. Each tag points at
  the true historical commit; only the release's own "created" timestamp says
  today, which is the one part of this that genuinely cannot be backdated.
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
- **IMDb's dataset is never committed, only its derived numbers.** It is
  licensed for personal, non-commercial use, which this app is — but that
  licence covers using it, not redistributing it. `npm run imdb-ratings`
  streams the 8 MB file, keeps the rating and vote count for films already in
  the library, and discards the rest. Same distinction `.gitignore` enforces
  for the database.
- **A second rating needs a vote floor, or it is not a second opinion.** Shown
  only above 1,000 IMDb votes. Absent means "not enough votes", never "badly
  rated" — the same rule as the streaming link. Worth showing at all because
  the two scores differ by 0.37 on average across this library and disagree
  hardest on blockbusters, where TMDB runs generous.
- **The test suite is hermetic.** No credentials, no network. A run must not
  depend on whose machine it is on.
- **Body text clears 4.5:1, and the number is calculated rather than judged.**
  `--text-faint` sat at 3.66:1 on `--bg-raised` for several versions while
  carrying real content — chip counts, list summaries, input hints. It looked
  fine. A deterministic UI scanner ran over the app and did not flag it, while
  catching 1.6:1 on a control page, so **passing a scan is not evidence of
  passing AA**. Compute the ratio when introducing or dimming a text colour.
