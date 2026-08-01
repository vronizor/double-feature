# Pre-publication audit (2026-07-30)

> **Evidence, not a plan.** Read on demand — when reopening the
> decision this settled, or when a new source is proposed for the same
> job. It is deliberately NOT part of the startup reading list: the
> decision it supports is one line in `DECISIONS.md`, and that line is
> what a session needs. No action was taken; four open questions were consciously accepted.

---

## Pre-publication audit (2026-07-30) — reference only, no action taken

A full read-only audit of the working tree **and all 26 commits of history**,
run before pushing. **Result: no secrets, ever, on any ref.** Recorded so it
isn't re-run from scratch, and so the open questions are written down rather
than remembered.

**Verified clean, and how** — worth keeping because the method matters more
than the verdict:

| Checked | Result | Method |
|---|---|---|
| TMDB key / v4 token | never committed | every blob grepped for the actual shapes: 32-hex and JWT. Zero hits anywhere |
| Any database | never committed | first 15 bytes of **every blob** read for `SQLite format 3` — catches a DB committed under a disguised name, which a filename check misses |
| `.env` | never staged or committed | full-history path walk |
| Personal data | none | no emails, MACs, `/Users/…` paths or machine names. The one IP is `192.168.1.50`, an RFC1918 test fixture. Voter names in fixtures are `Ana`/`Ben`/`Cy`/`Dee` |
| `.claude/settings.local.json` | correctly ignored, never tracked | |

> **The `.gitignore` is what made this clean, specifically the `data/*.db.*`
> rule.** A plain `*.db` pattern does not match `double-feature.db.pre-v2` or
> `.pre-boxoffice`, and those hold **real ballots and voter names**. If that
> rule is ever "tidied up", they get published. It is the single
> highest-consequence line in the file.

**Four open questions, reviewed and consciously accepted as-is.** The owner's
position: not worried, no action for now. Written down so a later reader knows
these were considered rather than missed.

1. **Seed-list provenance.** Every `seeds/*.json` documents its source, and
   entries are bare facts (title, year, rank, tmdb_id) with no synopses or
   artwork — the low-risk shape. The residual question is *selection and
   arrangement*, which is where sui generis database right sits in the UK/EU.
   Three files are near-complete copies of someone's editorial work:
   `tspdt-1000.json` (1,000 ranked entries — the ranking **is** that site's
   product; the strongest flag), `sight-and-sound.json` (264, the BFI's full
   poll), and `senscritique-family-films.json` (251, one named user's personal
   curation, from a site that 403s scripted requests). The Wikidata-sourced
   files are CC0 and the Wikipedia-category ones are facts from CC BY-SA pages,
   so those are not in question. No commercial dataset is redistributed —
   there is no IMDb or Letterboxd data, ruled out in the original spec. If this
   ever needs reducing, the move is shipping the fetcher without the largest
   derived lists rather than removing attribution.
2. **No LICENSE file.** `package.json` is `"private": true` with no license
   field, so a public repo is all-rights-reserved by default. Interacts with 1.
3. **Commit identity is public** — `Vincent Thorne <vinceroni@pm.me>` across
   all commits. Appears deliberate and pseudonymous.
4. **`.claude/CLAUDE.md` is tracked on purpose** and publishes the working-style
   and reporting conventions. Not sensitive; a deliberate choice.

> **A distinction worth not losing:** the *app* is private (LAN-only, no auth,
> never internet-exposed) but the *repo* is public. The four items above matter
> only because of the second. None of them is a leak; item 1 is the only one
> whose meaning actually changes with repo visibility.
