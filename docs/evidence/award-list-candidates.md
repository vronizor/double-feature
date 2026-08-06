# Award list candidates — three measured sweeps

*2026-08-06, while planning v9. Read this before proposing an award list, and
before re-proposing one that is refused below.*

Every number here was measured live against `query.wikidata.org` and the
Wikipedia APIs on the date above, using the repo's own pipeline shape. This
file exists because the alternative is a future session re-deriving that SAG's
category is full of actors.

**The overlap column is the decision-relevant one, not the film count.** A
prestigious list of 37 films that adds 8 is a worse buy than an obscure one of
35 that adds 31, and the only way to know which you have is to check.

---

## The baseline

The union of all 20 committed seed files: **5,141 distinct `tmdb_id`s**, plus
**~6,025 normalised title+year keys** for the four seeds that carry no ids
(`tspdt-1000`, `sight-and-sound`, `senscritique-family-films`,
`bfi-films-by-15`). A candidate film counts as held if its id is in that set,
or its normalised title matches with the release year within ±1.

**Every overlap figure is therefore a slight LOWER bound**, and every new-film
count a slight upper one. A spot check of 24 canonical CJK and Indian titles
caught 19. Two title-only matches were inspected and judged collisions
(*Padre Nuestro*, *Samson and Delilah*), which is why some counts below carry
a ±1.

---

## Three findings that outlive any individual candidate

**1. The route is a property of the award, measured, never a convention.** The
2026 Berlinale winner has a Wikidata item and a TMDB id and no `P166` at all,
months on, while the Wikipedia category had carried it since February. That
generalised: across thirteen awards where both routes exist, the category was
fresher and larger every time but one.

| Award | Wikidata `P166` | Wikipedia category |
|---|---|---|
| Japan Academy Prize | 8 films, to 2021 | **40** (ja), to 2025 |
| Golden Horse | 53, to 2022 | **60** (zh), to 2025 |
| Hong Kong Film Award | 37, to 2022 | **44** (zh), to 2024 |
| India National Film Award | 62, to 2018 | **71** (en), to 2024 |
| David di Donatello | 63, to 2020 | **65** (it), to 2022 |
| Karlovy Vary | 36 | **58** (en) |
| Oscar Best Documentary | 78 | **83** (en) |
| Toronto People's Choice | 8 | **47** (en) |
| Cannes Caméra d'Or | 14 | **50** (en) |
| Cannes Un Certain Regard | 4 | **29** (fr) |
| Independent Spirit | 2 | **41** (en) |
| Annecy Cristal | 10 | **35** (en) |
| San Sebastián | **22** | 20 (es) |

But it reverses whenever no category exists: Sitges and both Sundance prizes
are complete and densely qualified on `P166` and have no category at all. So
the instruction is genuinely *measure both*, not *prefer the category*.

**2. TMDB id coverage does not discriminate, and the expectation that it would
was wrong.** 98–100% on every list measured — arthouse, documentary, CJK,
African. The worst was Sundance Documentary at 95%. Coverage is binary in
practice: a source exists or it does not. Do not spend a sweep on it.

**3. `P585` density must be checked, never assumed.** `Q5579757` (Golden
Rooster) returns identical MIN and MAX ceremony years across 46 films, because
the qualifier is present on a single edition. Taken at face value that award
would have shipped with 45 of 46 ceremony years empty and nothing failing.
This is the same shape as the trap in `DECISIONS.md` §3 about counts that add
up while the values do not.

**4. Median IMDb vote count is the watchability proxy, and it has to be
calibrated against lists already held or it means nothing.** Introduced for the
documentary sweep because "would a household watch this" had until then been a
judgement call dressed up as a verdict. Joined via Wikidata `P345` to IMDb's
public ratings dataset, which needs no TMDB credentials.

| Held list | Median IMDb votes | ≥10k | ≥50k |
|---|---|---|---|
| Oscar — Best Picture | 243,820 | 93/97 | 73 |
| Cannes — Palme d'Or | 37,475 | 63/82 | 35 |
| Goya — Mejor Película | 12,192 | 20/40 | 8 |
| Berlin — Goldener Bär | 6,286 | 28/86 | 14 |
| Oscar — Best Documentary Feature | **1,239** | 25/87 | 15 |

The last row is the one to keep. **The documentary list already accepted sits
30× below the Palme d'Or**, so a documentary candidate is measured against
~1,250, not against the library. That is a decision the household has already
made, and it should be made knowingly rather than rediscovered each time.

**5. An AUDIENCE award selects for the property this library needs; a jury
award selects against it.** Not a hunch — it fell out of two independent
sweeps. Toronto's People's Choice measured less redundant than the shipped
Palme d'Or, and Sundance's World Cinema *Audience* Award for documentary
measured at a 3,077 median against the *Jury* prize's 1,535 over the same
festival, the same years and the same genre. When a candidate list needs
lifting on watchability, the axis to reach for is the award's mechanism, not
another country.

---

## Chosen for v10

| List | Route | Films | Held | New | `P585` | Cost |
|---|---|---|---|---|---|---|
| `Annecy — Cristal du long métrage` | en category | 35 | 4 (11%) | **31** | 97% | none |
| `Sundance — Grand Jury Prize: U.S. Dramatic` | Wikidata `Q3774974` | 44 | 7 (16%) | **37** ±1 | 100% | none |

Locarno is also v10 and is written up separately below.

**Annecy is the highest-value entry across all three sweeps.** The library's
animation holdings are Studio Ghibli plus the Disney animated canon and nothing
else, so an animation festival barely intersects it: *Coraline*, *Mary and
Max*, *My Life as a Zucchini*, *The Boy and the World*, *Flee*, *Memoir of a
Snail*, *When the Wind Blows*, *James and the Giant Peach*, *Renaissance*,
*Sita Sings the Blues*. `short_name` is `Cristal` — the prize, per §4, one
token like `Palme d'Or`.

**Sundance earns its slot on 85% new, not on fame.** *Whiplash*, *Winter's
Bone*, *Primer*, *Beasts of the Southern Wild*, *Fruitvale Station*, *American
Splendor*, *Welcome to the Dollhouse*, *Minari*, *Precious*. The first sweep
ranked it 11th of 21 with the verdict "strong but anglo" — a fault in how the
sweep was asked, not in the measurement, and worth recording because the same
instruction will be given again.

Its `short_name` is `Grand Jury: Dramatic`, and the reasoning matters because
the obvious objection is wrong. Sundance awards four Grand Jury Prizes, so a
bare `Grand Jury Prize` does not even identify the list — and it would sit one
row from Cannes' `Grand Prix`. But **adjacency is not the failure mode §4
names; ambiguity is.** An unqualified French `Grand Prix` and a qualified
English `Grand Jury: Dramatic` cannot be read as the same award even side by
side, and side by side is where they belong, being the same genus. The
qualifier is forced by Sundance, not chosen.

### Locarno — `Locarno — Pardo d'oro` / `Pardo d'oro`

The only award measured where **neither structured route works**. `P166` on
`Q1700510` has 83 of 93 winners and is missing four of the last nine ceremonies
outright (2017, 2019, 2021, 2023); it also carries *Nightsiren*, which won the
*Cineasti del presente* Leopard (`Q30894009`), a sibling prize sharing almost
every word of the name. The en category has 92 of which seven are shorts,
sibling-prize winners or the wrong *Julius Caesar*. The it category — the
obvious choice for a Swiss-Italian festival — stops at 2019, and de.wikipedia
has no such category at all.

The en.wikipedia article's own per-decade tables carry all 93 at 100% TMDB
coverage and are the only source with 2025. **9 held, 84 new — 10%**, the least
redundant award list this library has been offered; the Golden Bear was 21% and
the Palme d'Or 58%.

Four things make it harder than the existing festival lists, and each fails
silently rather than loudly:

- **Ex-aequo is the norm.** 93 films over 76 ceremonies; 1971 had six joint top
  prizes, 1969 and 1970 four each. Every existing fetcher assumes one winner
  per ceremony, so the one-per-anchor cap would drop 17 rows and report a
  plausible 76.
- Locarno winners are `''[[Film]]''`, never `'''''`, so the shared bold-italic
  matcher returns **zero** before it returns too few.
- **The self-closing `<ref />` trap is live on that page**, one tag sitting
  immediately after the 1986 row, and the naive strip swallows the 1987 winner.
  92 rows instead of 93, no error. The repo's existing ref-safe regex handles
  it.
- The 0–3-year sanity band would reject five correct winners: *Killer's Kiss*
  is a 1955 film that won in 1959, *The Emperor's Nightingale* is +7.

Four gap years are legitimate and an "every year" assertion would fail on real
data: 1951 (no festival), 1956 and 1982 (not awarded), 2020 (the pandemic
edition gave no Golden Leopard). And the prize only took this name in 1968 —
the first 22 editions awarded a *Gran premio*, a *Vela d'oro* or a jury prize,
so a pre-1968 entry means "top prize of its year".

---

## Measured, not chosen — the shortlist that stays in research

Ordered by new films. Nothing here is refused; it simply lost a slot.

| List | Route | Films | Held | New | Note |
|---|---|---|---|---|---|
| `Cannes — Caméra d'Or` | en category | 50 | 6 (12%) | **44** ±1 | **Zero** overlap with either Cannes list held. Highest absolute count measured. Single-italic film links, so a new marker, plus a Special Mentions table that would silently pull non-winners |
| India National Film Award | en category | 71 | 3 (4%) | **68** | Regional arthouse — *Court*, *Ship of Theseus*, *12th Fail*, but also much with no distribution |
| Filmfare — Best Film | Wikidata `Q1414525` | 64 | **0 (0%)** | **64** | Literally nothing held. *Mughal-e-Azam*, *Sholay*, *Lagaan*, *3 Idiots*, *Dangal*. Long films |
| Karlovy Vary — Křišťálový glóbus | en category | 58 | 2 (3%) | **56** | Half is 1948–89 Eastern-Bloc prestige cinema |
| Golden Horse | zh category | 60 | 6 (10%) | **54** | Reaches Taiwan, Hong Kong *and* the mainland in one list without the state-cinema problem. Was recommended, then not chosen |
| Baeksang | ko category | 57 | 2 (4%) | 55 | ~50% duplicate of Blue Dragon; pick one Korean list |
| Grand Bell | ko category | 55 | 2 (4%) | 53 | Same, plus a post-2015 credibility problem |
| Blue Dragon | ko category | 49 | 3 (6%) | **46** | The pool holds essentially no Korean cinema outside *Parasite*, *Oldboy*, *Memories of Murder*. Was recommended, then not chosen |
| Ophir (Israel) | Wikidata `Q25490075` | 47 | **0 (0%)** | 46 | All new; Hebrew is a romanisation question now settled |
| David di Donatello | it category | 65 | 20 (31%) | **45** | Closes the Italy hole — Venice is covered twice and Italy has no national award. Most immediately watchable additions of anything measured |
| AACTA | Wikidata `Q3600406` | 46 | 5 (11%) | 41 | Anglophone, decent numbers |
| Sundance — GJP: U.S. Documentary | Wikidata `Q2366088` | 44 | 5 (11%) | **39** | Shares exactly ONE film with Oscar Best Documentary — additive, not redundant. Fails on watchability: ~8 of 39 are household picks, the rest 1980s–90s American social-issue docs with no distribution. Also the only list measured below 100% TMDB |
| Hong Kong Film Award | zh category | 44 | 7 (16%) | 36 | ~40% duplicates Golden Horse's HK winners; measure the residual after Golden Horse, not before |
| Sitges — Millor Pel·lícula | Wikidata `Q6359242` | 45 | 10 (22%) | **35** ±1 | The **only genre list** the library would hold — a horror night has nothing to draw from. Free to build. *Re-Animator*, *Cube*, *Ring*, *Moon*, *Hard Candy*, *Borgman*, *Climax*, *Lamb* |
| Japan Academy Prize | ja category | 40 | 6 (15%) | 34 | See the ja trap below |
| Cannes — Prix Un Certain Regard | fr category | 29 | 1 (3%) | **28** | **97% new, the highest ratio measured anywhere.** Zero Cannes overlap. Only 29 films, 1998 on, `P585` at 10% so it needs its own article parse |
| Toronto — People's Choice | en category | 47 | 23 (49%) | **24** | Less redundant than the shipped Palme d'Or (58%), and the **only audience award** the library would hold — a different mechanism, not another jury. *Room*, *Silver Linings Playbook*, *Jojo Rabbit*, *Shine*, *Hotel Rwanda*, *Zatōichi*. Needs one anchor regex; the winner is the only bold-italic film link per rowspan block, so `BOLD_ITALIC_FILM` fits unchanged |
| FESPACO — Étalon de Yennenga | fr category | 25 | 2 (8%) | 23 | **The only Africa entry that exists, and it works.** Smallest build in any sweep |
| EFA — Best Documentary | Wikidata `Q1377752` | 30 | 7 (23%) | 23 | The pan-European documentary incumbent |
| Ariel (Mexico) | es category | 22 | 5 (23%) | 17 | Mexico's only machine-readable option |
| San Sebastián — Concha de Oro | Wikidata `Q775086` | 22 | 3 (14%) | 19 | Small; the one award where Wikidata beat the category |

**Cross-candidate overlap is near zero.** Eight of the candidates measured
together contributed 254 new films of which 249 were distinct; the highest
pairwise overlap was two. These are additive, not substitutes — which means
the ranking is about slots and effort, not about picking a winner.

**Both Cannes sidebars overlap the two Cannes lists already held by exactly
zero films.** Structurally guaranteed, since the sidebar sections are disjoint
from Competition, but confirmed rather than assumed.

---

## Refused, with the measurement that refused it

Do not re-propose these without new evidence. The number is the argument.

### On marginal value

| | Films | Held | New |
|---|---|---|---|
| European Film Award — Best Film | 37 | 29 (**78%**) | 8 |
| Golden Globe — Best Motion Picture Drama | 27 | 21 (**78%**) | 6 |
| Prix Louis-Delluc | 82 | 44 (54%) | 38 |
| Independent Spirit — Best Film | 41 | 24 (59%) | 17 |

For scale, `fetch-seed-lists.mjs` already flags the Palme d'Or as its most
redundant list at 58%. The first two are worse than that. All four honour the
American-and-European prestige tier this library already holds three ways over;
Independent Spirit's additions are *Juno*, *Little Miss Sunshine*, *Black
Swan*, *Past Lives* — the register the pool is thickest in.

**NBR Top Ten Films** is refused on shape rather than overlap: 880 films, nine
times the largest existing award list, 39% overlap, and it is a US critics'
annual ten-best rather than an award. It would swamp the `awards` tag.

**The PRC state awards** — Hundred Flowers (84), Golden Rooster (46), Huabiao
(254) — are machine-readable and startlingly novel at 1–5% overlap, and the
content is *The Founding of a Republic*, *Decisive Engagement: The Huai-Hai
Campaign*, *Mao Zedong in 1925*. Golden Horse reaches mainland cinema without
this.

**Moscow Golden George** measures 0% overlap, which is misleading: the list is
*Marvin's Room*, *The Icicle Thief*, *The Believer*. Novelty without coherence.

### Because no source exists

Each measured, not assumed.

| | What is actually there |
|---|---|
| SAG Outstanding Cast | `P166` returns 4 films; the category has 295 members and they are **actors** |
| DGA Outstanding Directing | `P166` returns 4; the category has 298 members, all **directors** |
| Critics' Choice / BFCA | `P166` on `Q922299` returns **one** film. No category in any language |
| Rotterdam Tiger | `P166` returns 4. "Tiger Award" **redirects to the festival article**; no winners list exists. A real list is ~80 films, none reachable |
| SXSW | A list article exists but uses four markup shapes across eras, and of ~25 narrative winners only 9 are wikilinked as films — the 2010–2018 block links only the directors |
| Tribeca | No category, no list article, no Wikidata award item held by ≥3 films |
| **Telluride** | **Not a candidate at all.** Verified from the article: its only award is the Silver Medallion, three career tributes to *people* per year. The festival is non-competitive by design |
| Cannes FIPRESCI | 10 films over 1970–2025, 70% held, 3 new — and FIPRESCI at Cannes is awarded across Competition, Un Certain Regard *and* the parallel sections, so even a complete list would not be one prize |
| Cairo — Golden Pyramid | ar category has 9 members, **0 resolve to film items** |
| Havana — Gran Coral | es category has 4 members, 0 film items |
| Fénix | No category, only an `Anexos:` container |
| Asia Pacific Screen Awards | `P166` returns 2, no category |
| Asian Film Awards | `P166` returns 1, no category |
| Deutscher Filmpreis (Lola) | `P166` returns 15, no category found. Germany is under-served, but Berlin covers it |
| Tokyo IFF / Kinema Junpo / Mainichi | 0, 0 and 1 film respectively, no categories |

### Documentary, specifically

Of the seven documentary sources considered, **five cannot be built at all**:
IDFA (1–4 films depending on the QID, no category in en/nl/fr), Hot Docs (1),
Visions du Réel (0), Cinéma du Réel (no Wikidata prize item and no article),
IDA (0). Grierson has 9 and died in 2004. Cannes' L'Œil d'or has 2.

`Oscar — Best Documentary Feature` is the only one that measured as buildable
at scale — en category, 83 films, 100% TMDB, 10 held, **73 new**. It has a
shape problem the count hides: the list is almost perfectly flat at ~10 winners
per decade, so **16 of 83 are 1942–59 war-effort and travelogue features**
(*Desert Victory*, *Design for Death*, *The Vanishing Prairie*). The post-1985
half is excellent — *Hôtel Terminus*, *The Fog of War*, *Man on Wire*,
*Searching for Sugar Man*, *Citizenfour*, *O.J.: Made in America*, *Free Solo*,
*Summer of Soul*, *20 Days in Mariupol*, *No Other Land*.

### The European documentary sweep

Run separately, because the owner wanted one loosely-European documentary list.
`NEW` counts films absent from the library *and* from both Oscar Best
Documentary and Sundance's US documentary prize, since near-duplication was the
main risk.

| Candidate | Route | Films | `P585` | New | Median votes | ≥10k |
|---|---|---|---|---|---|---|
| **European Film Award — Best Documentary** | Wikidata `Q1377752` | 30 | **100%, 30 distinct years** | **23** | 1,260 | 8 |
| BAFTA — Best Documentary | en article | 39 | 13% direct, 43/43 via ceremony items | 22 | 2,393 | 16 |
| César — Meilleur Film Documentaire | fr category | 20 | 25% | 16 | 1,311 | 3 |
| Sundance — WC Audience Award: Doc | Wikidata `Q1574973` | 20 | 100% | 17 | **3,077** | 6 |
| Sundance — WC GJP: Documentary | Wikidata `Q2366099` | 20 | 100% | 19 | 1,535 | 2 |
| Goya — Mejor Película Documental | es article | 17 | 47% | 17 | **431** | 0 |
| Berlinale Dokumentarfilmpreis | Wikidata `Q28799939` | 7 | 29%, 2019–21 only | 6 | 548 | 1 |

**The EFA wins, and on the axis that could have killed it.** `P585` is present
on 30 of 30 films across 30 genuinely distinct ceremony years — no clustering,
none of the single-edition pathology that would have shipped a mostly-empty
award-year column. Route settled by absence rather than preference: no EFA
documentary category exists on en, fr or de, and the award item has no `P910`.
The one-year lag to 2024 is upstream — en.wikipedia's own article ends at the
37th ceremony too.

It is also the only candidate that is European by *content* and not merely by
letterhead: **97% of its films carry a European co-production country**,
against BAFTA's 64% and Oscar Best Documentary's 36%. And despite a 1,260
median it has **8 of 30 above 10k votes, a better hit rate than the Oscar
documentary list's 25 of 87** — *Amy*, *No Other Land*, *The Act of Killing*,
*Buena Vista Social Club*, *Pina*, *Collective*, *For Sama*, *The Gleaners and
I*. Cheapest build in the repo: one `fetchWikidataAward` entry, no article, no
anchor, no new parsing.

**BAFTA has the best raw numbers and they are a mirage.** It is two awards
wearing one name: 1948–85 it honoured British and Canadian documentary shorts
and industrials (*Royal Journey*, 37 votes; *Prologue*, 29; *Cree Hunters of
Mistassini*, 30), and from 2010 it honours feature documentaries that all clear
11,000. Of its 22 new films, six are modern and watchable and sixteen are
pre-1982 with eleven under 500 votes. It also duplicates Oscar Best Documentary
on 12 of 39, including nine of the fifteen post-2010 winners, and is only 64%
European with an Anglo-American recent slate. Wrong shape twice over — and its
Wikipedia category is **empty**, 0 members, so it would need an article-only
fetch variant on top.

**The free one is the worthless one.** `CEREMONY_ANCHORS.goya` parses the Goya
documentary article untouched and returns 20 dated ceremony pairs — zero new
code — for 17 films with a median of 431 votes and not one above 10,000.

**César is the runner-up if a second list is ever wanted**, at 20 films, 16
new, zero overlap with either reference, and 100% French production. Two
reasons it is not first: 12 of 20 sit under 2,000 votes, and its award years
cap at 25% because the documentary article writes `'''[[…]] : ''[[Film]]''`
where the main article writes `'''''[[Film]]'''''`. **Take the 25% rather than
widening `BOLD_ITALIC_FILM`** — that regex is shared by the César, BAFTA and
Goya best-film fetchers, so the fix risks three shipped seeds to improve one
column on one list.

**Every European documentary festival fails, confirmed rather than assumed.**
CPH:DOX holds 0 films on Wikidata and has no category; its article has a clean
table but only 12 rows resolve. Millennium Docs Against Gravity is the same
shape at 16. DOK Leipzig's articles carry **zero wikitables** in either
language — prose only. Thessaloniki's Golden Alexander holds one film, Krakow
has no tables at all, and Sheffield's 16 tables mix eight award categories per
year. **Visions du Réel is confirmed dead**: 0 films, and a 2,389-character
article with no tables. Berlinale's documentary award exists but spans
2019–2021.

**A naming collision to settle before any of these ship.** A documentary
César, Goya or BAFTA would print the same card token as the best-film list
already seeded. The repo solved this once already with `Oscar` versus
`Oscar Intl.`, so the precedent is `César Doc.`, `Goya Doc.`, `BAFTA Doc.` and
not a new convention. The EFA has no collision — its `short_name` is `EFA`,
the body rather than a statuette, because the trophy has no popular name.

---

## Traps found while measuring

**A Wikipedia category can lose films to the article being about the source
novel.** Seven of 49 `ja` category members for the Japan Academy Prize point at
the *literary work's* Wikidata item, because the ja article is about the novel
or manga rather than the film — *The Great Passage*, *The Eternal Zero*, *The
Eighth Day*. Those items have no TMDB id, so the fetcher drops them correctly
and reports nothing. That list would ship at 40 of ~48 editions with no sign
anything was missing. The `ko` and `zh` categories have zero such loss.

**The best language edition for an award is not always the award's own.**
`Category:Crystal Globe winners` is en.wikipedia's and beats both `P166` and
any Czech equivalent, 58 films against 36. Locarno is the sharper case: the
Italian category for a Swiss-Italian festival is six years stale.

**A sibling prize sharing the award's name will contaminate every route except
an article parse.** *Pardo d'oro Cineasti del presente* (`Q30894009`) differs
from the Pardo d'oro (`Q1700510`) by two words and leaks into the Wikidata
query, the en category, the it category and the fr category. Any future
"query by label" shortcut walks straight into it.

**A name in one language can collide with a list already shipped.** Sitges'
prize in Spanish is `Mejor Película`, which would put `Sitges — Mejor Película`
directly beside the shipped `Goya — Mejor Película`. Catalan `Millor
Pel·lícula` is both the festival's own language and the form that avoids it —
so §4's "the ceremony's own language" turns out to also be the rule that
prevents the collision, which is worth knowing the next time it is tempting to
reach for the more familiar language.

## Loose ends noticed while measuring, not acted on

- ***La La Land* is in none of the 20 seed files** — verified by id and by
  normalised title. It is also the single missing edition in the TIFF category:
  47 films for 48 ceremonies, and 2016 is the gap. So adding Toronto would not
  fix it, and that category is one film short in a way no count-based guard
  could catch.
- `seeds/box-office-spain.json` is at 93.5% TMDB coverage (1,465 of 1,567) and
  `seeds/criterion-collection.json` at 97.7%. Both pre-existing.
