# Popularity vs acclaim — the metric problem

> **Evidence, not a plan.** Read on demand — when reopening the
> decision this settled, or when a new source is proposed for the same
> job. It is deliberately NOT part of the startup reading list: the
> decision it supports is one line in `DECISIONS.md`, and that line is
> what a session needs. Settled: they are different axes, and rating-sorted can never reach the 6.6-7.0 band.

---

## Popularity vs acclaim — the metric problem

**The finding that matters: sorting by rating selects for critical acclaim, not
for crowd-pleasing.** This is not a tuning issue; it is structural, and it
applies in every language.

Measured on TMDB:

```
Ace Ventura            ★6.6      Parasite                ★8.5
The Mask               ★7.0      Your Name.              ★8.5
Dumb and Dumber        ★6.7      Into the Spider-Verse   ★8.4
Austin Powers          ★6.6      Avengers: Infinity War  ★8.2
Wayne's World          ★6.7      Green Book              ★8.2
```

The films people put on for a good evening cluster at 6.6–7.0. The current
"Crowd-Pleasers" list sorts by rating, so its *lowest* entry is 8.2 — it cannot
reach them. **That list is misnamed**: it is "recent, widely-seen, highly-rated",
i.e. recent acclaim. It even contains Parasite, which is already on the canon
lists it was meant to counterbalance.

Two distinct axes, needing two distinct lists:

| Axis | Sort | Gives you |
|---|---|---|
| **Acclaim** | rating, with a vote floor | Parasite, Spider-Verse, Portrait de la jeune fille en feu |
| **Popularity** | reach / admissions, with a rating *gate* | Ace Ventura, Taxi, Les Visiteurs |

Renaming the existing list (to something like "Modern Classics") and adding a
separate reach-sorted one was the conclusion at the time. **Half of that was
right.** The rename shipped in v2. The reach-sorted list was dropped in v4
planning — see "Dropped" below — because box office answers the same question
with better data. The *axis* still stands: acclaim and popularity are genuinely
different, and rating-sorted can never reach the 6.6–7.0 band.
