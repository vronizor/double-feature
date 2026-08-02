# Field notes

**Yours. Write badly and fast.** Bugs seen, ideas, things that felt wrong. No
format — a note you have to classify before writing is a note you do not write.
Tag one `-> v5` if you already know where it goes; otherwise leave it bare and
it gets triaged.

Read and emptied at the start of every session. Each entry is filed to wherever
it belongs and the destination is reported back — nothing is deleted silently,
and nothing bigger than a fix is actioned without asking first.

---

## Inbox



---

## Filed

Trimmed each session; git keeps the history.

_One note filed 2026-08-02 and cleared: the second rating not always appearing
on hover. Measured against the real database, and it was two things wearing one
symptom. About 13% of the library sits below the 1,000-vote floor and shows
nothing **by design** — absent means "not enough votes", never "badly rated",
and that decision stands. But 36% had no IMDb rating cached at all, while 2,150
of those already carried an `imdb_id` — so the ids were in place and the ratings
had simply not been fetched since the library grew through v5. Running
`imdb-ratings` matched 5,920 films and took the shown-score count from 3,041 to
4,202. No code changed. The durable half went to a comment in the script, since
it is a fact about that script rather than a decision._

_Six notes filed 2026-07-31 and cleared: one fixed in v4 (director names
splitting across lines), one answered as a decision rather than a bug (award
badge years — the data was right, the label is disputed), and four scheduled to
v5. Nothing outstanding._

_One note filed 2026-08-01 and cleared: a second card-preview defect, folded
into the existing `ROADMAP.md` v5 row rather than opening a duplicate. It is
the same cause as the dangling separator — an unbreakable director's name —
but a worse symptom, since `Estibaliz Urresola Solaguren` pushes the rating out
of the card entirely and leaves a bare star. The row now carries both._

_Four notes filed 2026-08-01 and cleared. Three to `ROADMAP.md` v5: whether a
parametric list can be ranked (investigation only — the build is v6), "Custom"
looking like a chip you can press, and the dangling `·` left behind when a
director's name wraps. One to `BACKLOG.md` v6: a Box-office vibe, held until
the US list exists so the chip is built once over the finished set rather than
edited twice. Nothing outstanding._
