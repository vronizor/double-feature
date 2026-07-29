# Backlog

Improvements worth doing but not scheduled. Unlike `ROADMAP.md`, nothing here
is committed to a version — this is the "we noticed, we decided not to now"
list, kept so the reasoning doesn't have to be rediscovered.

---

## Award years for BAFTA, César and Goya

**The gap.** Award badges show the ceremony year (`🏆 Palme d'Or 2019`) from
`list_movies.award_year`. Coverage is uneven, because it comes from Wikidata's
point-in-time (`P585`) qualifier on the award-received statement:

| Award | Source route | Award-year coverage |
|---|---|---|
| Oscar — Best Picture | Wikidata `P166` | 97/97 (100%) |
| Oscar — Best International | Wikidata `P166` | 71/71 (100%) |
| Golden Lion | Wikidata `P166` | 65/66 (98%) |
| Palme d'Or | Wikidata `P166` | 80/82 (98%) |
| Golden Bear | Wikidata `P166` | 80/86 (93%) |
| **César** | Wikipedia category | **20/51 (39%)** |
| **BAFTA** | Wikipedia category | **29/78 (37%)** |
| **Goya** | Wikipedia category | **11/40 (28%)** |

The three national awards came from Wikipedia categories precisely because
Wikidata's `P166` data for them is thin — and the year lives on that same thin
statement, so the gap is inherited. Films without a year render as plain
`🏆 César`, which is correct but less interesting than `🏆 César 1998`.

Two ways to close it, neither taken yet.

### Option B — derive the year as release year + 1

All three are held in February/March for the *previous* year's films, so
`award_year = movies.year + 1` would be right in the overwhelming majority of
cases, and gets coverage to 100% for nothing.

- **For:** trivial, no new source, no new fetching.
- **Against:** silently mixes real and guessed data in the same field, with no
  way to tell them apart afterwards. It will be wrong sometimes — festival
  timing shifts, films with an early-festival release the year before general
  release, re-releases — and a *confidently wrong* year is worse than an absent
  one at movie night. If this is ever done, store it in a separate column (or
  flag it) rather than overwriting `award_year`, and consider rendering derived
  years differently (`~1998`).

**Note this only works for these three.** Cannes awards a film in its own
release year, so the same derivation applied to the Palme d'Or would be off by
one — *Anora* is released 2024, Palme d'Or **2024**, Oscar **2025**. That
single film is the reason `award_year` is stored rather than computed.

### Option C — scrape the ceremony tables (the complete fix)

Each award's own Wikipedia article carries a full year-by-year winners table:

- `en.wikipedia.org/wiki/BAFTA_Award_for_Best_Film` — 10 wikitables, 546 rows
- `fr.wikipedia.org/wiki/César_du_meilleur_film`
- `es.wikipedia.org/wiki/Premio_Goya_a_la_mejor_película`

Parse year → winning film, match to the entries already fetched from the
category (by Wikidata QID where the table links to an article, which avoids
fuzzy title matching).

- **For:** genuine data, 100% coverage, no guessing.
- **Against:** the most work, and it's exactly the prose-table parsing the
  category route was chosen to avoid. Those tables also mix winners and
  nominees, so the parser has to distinguish them — usually by bold or by a
  separate column, and the convention differs between the three language
  Wikipedias.

**Recommendation if picked up:** C, not B. The whole point of the badge is a
specific true fact; a guessed year undermines the feature it's meant to serve.
C is contained — one parser per award, run once at fetch time, and a bad parse
shows up immediately as a year that doesn't match the film's release year.

---

## Other ideas, unranked

- **Short names as data.** `dom.js` carries a hardcoded map of award list name
  → display name so cards can fit "Oscar Intl." instead of
  "Oscar — Best International Feature". It falls back to stripping the
  qualifier for unknown names, which is fine, but a `lists.short_name` column
  would put it with the rest of the list metadata in the seed files.
- **Award-winner filter.** The data now supports "only films that won
  something" as a pool filter, not just a badge. Cheap given `awards` is
  already computed — but it overlaps heavily with just selecting the awards
  category in the picker, so it may not earn its place.
- **Nominees, not just winners.** Wikidata models nominations (`P1411`) and the
  Wikipedia categories have sibling nominee categories. Would multiply the pool
  considerably and dilute "award winner" as a signal; noted rather than
  proposed.
