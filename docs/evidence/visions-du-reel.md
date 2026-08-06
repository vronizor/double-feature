# Visions du Réel — scoped, not built

*2026-08-06. Held as research on the owner's call: the Wikipedia table will be
written by hand one winter evening rather than parsed.*

**The point of this file is the table at the bottom.** Thirty-two winners with
director-verified TMDB ids, taken off the festival's own palmarès pages and
checked against the live TMDB API. That list is the raw material for both a
Wikipedia contribution and any future seed, and re-deriving it is essentially
the whole cost of the exercise. Everything above it is what a future session
would otherwise have to rediscover.

Verified unless marked inferred.

---

## Is it allowed? Yes, and for a better reason than expected

`robots.txt` is `User-agent: *` with `Crawl-delay: 10` and **no `Disallow`**.
That is exactly the shape where `DECISIONS.md` §3 says the terms decide, so the
terms were read.

There is no `conditions d'utilisation` page. `mentions-legales` carries one
relevant clause — *"L'ensemble de ce site relève de la législation suisse sur
le droit d'auteur et la propriété intellectuelle. Tous les droits de
reproduction sont réservés, y compris pour les documents téléchargeables et les
représentations iconographiques et photographiques"* — and **no prohibition on
scraping, crawling, automated access or systematic copying**. Those words do
not appear. What is reserved is *reproduction* of the mark, the photos, the
downloadable documents and the iconography. Reading pages is unrestricted;
republishing their images or prose is not.

**Switzerland has no sui generis database right**, which is the part worth
remembering. EU Directive 96/9/EC protects a database against extraction of
substantial parts regardless of originality; there is no Swiss equivalent.
Swiss `LDA` art. 4 protects a collection only where the *selection or
arrangement* has individual character, and a palmarès ordered by year and
section does not. The live Swiss risk is `LCD` art. 5 lit. c — taking over a
marketable work product by technical reproduction and exploiting it as such —
which a re-typed, re-arranged fact table is not, and a byte-for-byte mirror
would be.

So for a hand-written Wikipedia table: **the facts are free, the expression is
not.** Take the years, titles, directors, countries and prize names. Do not
take the still images, the synopses, the jury citations or the section
blurbs — those are protected text, and putting them on Wikipedia would breach
CC BY-SA as well as copyright.

One oddity: the site asks for prior agreement before deep-linking to it. Not
enforceable against normal linking, and every festival's site is cited freely
on Wikipedia — but a courtesy note to the festival before publishing would also
open the door to them supplying the data directly, which would be better than
either plan.

## Why it was not built as a fetcher

**Coverage was never the problem. Matching is.**

| | |
|---|---|
| Winners that exist on TMDB at all | 30/32 — **93.8%** |
| Winners `resolveEntry` calls `resolved` | 25/32 — 78.1% |
| …that are actually the **right film** | 23/32 — **71.9%** |

The declared floor is 90%. The corrected rate is eighteen points under it, and
the gap is not near-misses — it is two **confident wrong matches**, which
`DECISIONS.md` §6 records as invisible and permanent once seeded.

There is also a systematic year problem this source has and the other award
lists do not: **TMDB dates a documentary by its release and the festival awards
it at its premiere**, and the gap routinely exceeds the matcher's ±1-year
confidence window. The 2023 winner is dated 2025-09-07; the 2025 winner
2026-06-19. That produced four of the five `needs_review` rows.

Against that, a parser would need: index-link discovery (the URL slugs are
inconsistent — 2024 and 2026 are `/palmares/2024/` while every other year is
`/palmares/palmares-2020/`, so links must be read and never constructed), two
markup regimes (1995–2011 is TYPO3 content pasted into WordPress, 2012–2026 is
the current theme), tolerance for the heading level drifting *within* the
current design (2021 uses `h3`; a first parser returned **zero rows for 2021
and reported success**), a hand-coded exception for 2023 — whose main
competition carries **no prize labels at all**, so its winner is identifiable
only by card order — and an era-aliased prize map, because a prize-name regex
cannot isolate this award: filtering on `grand prix|sesterce d'or` returns
**45 rows for 32 years**, thanks to the sibling Sesterces d'or (George,
Fondation Goblet, Canton de Vaud, SRG SSR, and a career award that is not a
film).

Estimated 250–320 lines, against `fetch-icaa.mjs`'s 565 — cheaper per line and
worse per row, because the difficulty moves from retrieval into disambiguation.

**And the shrink guard degenerates at this size.** `guardFloor` takes the
larger of `minCount` and half the existing count, so at 32 rows the
proportional arm only trips below 16. The realistic failures are losing one
year page (1 row) or losing the combined 1995–2001 page (7 rows, 22%), and both
sail through. Only a hand-set minimum pinned within a row or two of the truth
catches anything, and it would need bumping by hand every April — at which
point the guard is a manually maintained constant guarding against the wrong
failure, since the measured failure here is a wrong match rather than a shrink.

**Wikidata cannot help.** Three award items exist (`Q77421742`, `Q77422882`,
`Q77421967`) and hold **zero films** between them; the single `P166` usage
across all three is on a person, Francis Reusser.

## If it is ever seeded, it is a hand-written seed

Every entry below carries a TMDB id, so a static seed resolves **by id** —
which is the rule in `DECISIONS.md` §5, not the ICAA exception to it. A
hand-written file is therefore both more accurate than the scraper and less of
a departure. It costs one line each April.

The open question, if that ever happens, is `short_name`: `Grand Prix`
**collides with `Cannes — Grand Prix`**, already seeded. `Grand Prix VdR`
follows the `Oscar Intl.` precedent and uses the festival's own abbreviation
rather than a city, so §4's prohibition is not engaged. `Sesterce d'Or` is more
recognisable and names a prize discontinued in 2020.

`name` would be `Visions du Réel — Grand Prix`.

## The prize was renamed six times, and the sponsor is inside the name

This is the column a reader cannot reconstruct, and the reason a table beats a
list.

| Editions | As printed |
|---|---|
| 1995–1996 | Grand Prix |
| 1997–2003 | Grand Prix UBS |
| 2004–2007 | Grand Prix Visions du Réel |
| 2008–2013 | Grand Prix La Poste Suisse |
| 2014–2015 | **Sesterce d'Or** La Poste Suisse |
| 2016–2020 | **Sesterce d'Or** la Mobilière |
| 2021–2026 | Grand Prix *(remis par la Mobilière)* |

Note the shape: "Sesterce d'Or" is a seven-year interruption in the middle, not
the current name. **en.wikipedia still presents it as the festival's main
award** — stale by six years, and worth fixing in the same sitting.

## For the winter evening

The French article is **2,389 characters with zero wikitables** and carries an
unsourced banner; its infobox already names the prize correctly. The English
one is 7,627 characters, also with no tables, and its `==Awards==` section
lists prize names with no winners. **French first.**

The site's palmarès begins at **1995**, the year the festival took this name.
The 1969–1994 Nyon era is not on the site at all — the infobox's 1969 refers to
the festival, not to available data.

Scope: 489 film-attached award rows across 32 editions and roughly 18 real
sections once synonyms merge, of which **115 are `Mention spéciale`**. The main
competition table below is 32 rows and is the right first contribution; the
other competitive sections would add ~250 more. Leave the special mentions out.

A festival's own palmarès is a primary source used for a plain descriptive
statement of fact about itself, which `WP:PRIMARY` permits and which every
festival article on Wikipedia already relies on. Cite the per-year page, and
archive it — the site has migrated CMS once already, which is visible in the
1995–2011 markup.

---

## The winners

Titles, directors and prize names are the site's own. Countries are given only
for 1995–2011 (2024 and 2026 from their film pages). **TMDB ids were confirmed
against the live API by director credit**, not by title match.

| Year | Film | Director | Country | Prize as printed | TMDB |
|---|---|---|---|---|---|
| 1995 | Chastie | Sergey Dvortsevoy | Russie | Grand Prix | 308689 |
| 1996 | Broken Silence | Elin Flipse | Pays-Bas | Grand Prix | **not on TMDB** |
| 1997 | Nobody's Business | Alan Berliner | USA | Grand Prix UBS | 126999 |
| 1998 | State of Dogs | Brosens & Turmunkh | Belgique, Mongolie | Grand Prix UBS | 102223 |
| 1999 | Herr Zwilling und Frau Zuckermann | Volker Koepp | Allemagne | Grand Prix UBS | 355312 |
| 2000 | Vacances prolongées | Johan van der Keuken | Pays-Bas | Grand Prix UBS | 128599 |
| 2001 | The House of Cain | Christos Karakepelis | Grèce | Grand Prix UBS | 46794 |
| 2002 | Gambling, Gods and LSD | Peter Mettler | Suisse, Canada | Grand Prix UBS | 91693 |
| 2003 | The Last Term | Vladimir Eisner | Russie | Grand Prix UBS | **not on TMDB** |
| 2004 | Justiça | Maria Ramos | Pays-Bas | Grand Prix Visions du Réel | 228398 |
| 2005 | The Pipeline Next Door | Nino Kirtadzé | France | Grand Prix Visions du Réel | 175676 |
| 2006 | Der Kick | Andres Veiel | Allemagne | Grand Prix Visions du Réel | 64457 |
| 2007 | Söhne | Volker Koepp | Allemagne | Grand Prix Visions du Réel | 461019 |
| 2008 | The Lie of the Land | Molly Dineen | Angleterre | Grand Prix La Poste Suisse | 297765 |
| 2009 | L'encerclement | Richard Brouillette | Canada | Grand Prix La Poste Suisse | 104841 |
| 2010 | Into Eternity | Michael Madsen | Danemark, Finlande | Grand Prix La Poste Suisse | 54527 |
| 2011 | El lugar más pequeño | Tatiana Huezo | Mexique | Grand Prix La Poste Suisse | 81663 |
| 2012 | Matthew's Laws | Marc Schmidt | — | Grand Prix La Poste Suisse | 138955 |
| 2013 | Karma Shadub | Ramon Giger & Jan Gassmann | — | Grand Prix La Poste Suisse | 237645 |
| 2014 | Coffee (Chants of Smoke) | Hatuey Viveros Lavielle | — | Sesterce d'Or La Poste Suisse | 254264 |
| 2015 | Homeland (Iraq Year Zero) | Abbas Fahdel | — | Sesterce d'Or La Poste Suisse | 345139 |
| 2016 | Another Year | Shengze Zhu | — | Sesterce d'Or la Mobilière | 412359 |
| 2017 | Taste of Cement | Ziad Kalthoum | — | Sesterce d'Or la Mobilière | 449508 |
| 2018 | The Trial (*O Processo*) | Maria Augusta Ramos | — | Sesterce d'Or la Mobilière | **500833** ⚠ |
| 2019 | Heimat Is a Space in Time | Thomas Heise | — | Sesterce d'Or la Mobilière | 576308 |
| 2020 | Punta Sacra | Francesca Mazzoleni | — | Sesterce d'Or la Mobilière | 697146 |
| 2021 | Faya Dayi | Jessica Beshir | — | Grand Prix la Mobilière | 776551 |
| 2022 | L'îlot | Tizian Büchi | — | Grand Prix la Mobilière | 923385 |
| 2023 | While the Green Grass Grows | Peter Mettler | — | *(no label on the page)* | 1526227 ⚠ |
| 2024 | The Landscape and the Fury | Nicole Vögele | Suisse | Grand Prix la Mobilière | 1264570 |
| 2025 | The Prince of Nanawa | Clarisa Navas | — | Grand Prix la Mobilière | 808224 |
| 2026 | From Dawn to Dawn | Xisi Sofia Ye Chen | Espagne, France | Grand Prix la Mobilière | 1464311 |

⚠ **2018 is the row that breaks automated matching.** The site says "The
Trial", 2018. TMDB serves Maria Augusta Ramos's *O Processo* in English as *The
Trial*, dated 2018 — and Sergei Loznitsa's *The Trial* is also 2018. Searching
the festival's title resolves **confidently to the wrong film** (538621).
Searching the original title `O Processo` resolves correctly. Do not take an
automated answer for this row.

⚠ **2023 is duplicated on TMDB's side** — 1108340 and 1526227 are both Mettler's
film, both dated 2025.

**Original titles help but do not dominate.** `O Processo` fixes 2018 and
`Café: cantos de humo` fixes 2014's unmatched row, but `Landschaft und Wahn`
fails for 2024 where the festival's English title succeeds. Neither key wins;
both must be tried, and the answer still needs a director check.
