# UI review — the evidence behind v7

**Dated 2026-08-02.** Four independent passes over the same running app, then a
synthesis. Read this when reopening *what should the Draw tab look like*; the
decisions it produced live in `ROADMAP.md` v7 and `DECISIONS.md`.

The passes were deliberately isolated from one another. That is the only reason
their agreements are worth anything: three of them converged on the same three
problems without seeing each other's output.

| # | Pass | Method | Saw the others? |
|---|---|---|---|
| 1 | Impeccable detector | 47 deterministic JS rules, run over rendered DOM | n/a |
| 2 | Rubric critique | Nielsen 10 + cognitive load + personas | No — deliberately blind to #1 |
| 3 | UX / flow review | Task walkthrough, Todoist/Tailscale as benchmark | No |
| 4 | Layout proposal | Design proposal, not audit | No |

---

## 1. The deterministic detector — and why it is not the headline

Impeccable's detector was run against the live app in three rendered states,
because a static scan of this repo sees nothing: the DOM is built in JavaScript,
so `index.html` is an 862-byte shell. States were captured by driving a headless
browser and inlining the stylesheet.

```
Draw view (baseline, 80 elements)      1 finding
Pool setup expanded (478 elements)     1 finding + 1 advisory
Movie modal open                       2 findings
Control page (deliberately bad)        7 findings across 6 rule types
```

**The control matters more than the results.** A near-empty result could mean
the scanner had silently degraded — a known bug in the skill-install path does
exactly that. Fed 9px text, 1.6:1 contrast, gradient text, nested cards and a
skipped heading, it caught all of them. So the app's clean sheet is real.

**One actionable finding in the whole UI**: `.modal-card` carried a 1px border
*and* a 24px shadow blur. Fixed in v6.10 by dropping the border. Independently,
the tool's own unloaded "craft floor" names this exact pairing "the ghost card".

**One false positive**: `overused-font` reported Roboto. The stack is
`ui-sans-serif, -apple-system, "Segoe UI", Roboto, …` — the standard system
stack, which resolves to San Francisco on a Mac and only reaches Roboto under
headless Chrome for Testing. The rule reads a *fallback entry* as a choice.

> **The detector passed an app that fails WCAG AA.** `--text-faint` measured
> 3.66:1 on `--bg-raised`, against the 4.5:1 body text requires — and the
> `low-contrast` rule never fired, though it caught 1.6:1 on the control. The
> number came from calculating it by hand after a human reviewer raised it.
> **A deterministic scan is a floor, not a verdict**, and a clean report from
> one is not evidence of anything.

It said **nothing at all** about Pool setup's density — no `cramped-padding`,
no `monotonous-spacing`, no `flat-type-hierarchy` — which was the question that
prompted the exercise. It has opinions about borders, palettes and type scales;
it has none about "this panel has too much in it".

**Verdict: not worth another session.** `/polish` is separately ruled out — no
dry-run mode exists, and scoping is whole-file, which here means the entire
stylesheet. It also edits source on taste grounds, which collides with this
project's rule that findings are reported rather than folded into the diff.

---

## 2. Rubric critique — 26/40

Nielsen's ten, scored 0–4. Calibration from the playbook: *"Most real
interfaces score 20-32 out of 40."*

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | No live-vote indicator once you leave the panel |
| 2 | Match real world | 4 | Vibes/lineup/ballot language is exactly right |
| 3 | Control & freedom | 3 | "← New lineup" clears the lineup, no undo |
| 4 | Consistency | 2 | Vote cards expose `aria-pressed`; host chips never do |
| 5 | Error prevention | 3 | Publish has no confirm |
| 6 | Recognition over recall | 2 | Same list appears in 3 groups, all checked |
| 7 | Flexibility & efficiency | 2 | No keyboard shortcuts; Enter-only search |
| 8 | Aesthetic & minimalist | 1 | Pool setup ≈29 rows + 45 chips buries Draw |
| 9 | Error recovery | 3 | Toasts clear; failures rarely actionable |
| 10 | Help & documentation | 3 | Excellent inline microcopy, no help surface |

**Total 26/40 — "acceptable".** Band: significant improvements needed.

**Specificity verdict: genuinely specific.** *"The vocabulary is inseparable
from movie-night hosting; no unrelated product could reuse this unchanged. The
chrome is generic, but the information design is not."* This is the finding to
protect: the thinking is the product.

**Cognitive load: 5 of 8 failures — critical.** Failing chunking, grouping,
visual hierarchy, minimal choices, progressive disclosure. Named violations:
**The Wall of Options**, **The Visual Noise Floor**, **The Inconsistent
Pattern**, **The Memory Bridge**.

Strengths it singled out, all worth protecting: microcopy that carries
reasoning rather than labels; the deliberate refusal to over-collapse; and the
guest vote screen's accessibility, which is real work — `role=button`,
`aria-pressed`, `aria-label` with rank, focus preserved across 3.5s polls.

---

## 3. UX / flow review — Todoist and Tailscale as the benchmark

Three defects it found were verified in source and fixed in v6.11:

- Explore printed its count twice — `1750 1750 films match` on every load.
- The guest's submit button was live at zero picks, reading `Submit 0 picks`,
  with validation firing as a toast *after* the tap.
- The guest link and the QR disagreed. The QR is server-drawn from the detected
  LAN address; the link came from `location.origin`, so a host on `localhost`
  got a working QR beside a dead Copy link.

> One claim it got **wrong**: it reported the QR itself as encoding localhost.
> The QR was always correct. The real defect was narrower and more interesting —
> two sources of truth for one fact, disagreeing exactly when it mattered.

Its structural findings, none of which the detector saw:

- **One control shape carries four meanings.** Vibe presets, list-group jump
  chips, genre/country/language filters and display toggles are all pills, all
  "active = solid yellow", separated by 0.06rem of font size. Four of seven vibe
  names recur verbatim in the row below; "Family" exists as three chips meaning
  three different things.
- **Two contradictory selected states.** With `Cinephile` active, the group row
  still paints `All` in the same active yellow.
- **`.chip` has no `:hover` rule at all.** The most-clicked control in the app
  is inert until clicked.
- **Duplicate list rows.** Disney Animated Canon and Studio Ghibli each appear
  under Family, Animation *and* Collections; the award lists appear under both
  Awards and Festivals. 29 visible rows under a header reading "20 of 20 lists
  selected", and group totals that do not reconcile. Confirmed visually.
- **Explore shows zero films above the fold** on a tab titled "Explore the
  library" — the full viewport is list picker.

---

## 4. The layout proposal

**Thesis:** *the Draw tab is organised by machinery, not by task.* Two input
mechanisms of wildly unequal frequency share a `1fr 1fr` grid; the
configuration for one of them is an accordion inside the flow; and the lineup —
the thing the nav tab is named after — is last and smallest. Measured: with Pool
setup open, the Draw button sits ~2,900px down a ~3,600px page, four viewport
heights below the vibe chips that changed the pool.

**The answer: disclosure by destination, not expansion in place.** Pool
configuration leaves the flow entirely for a sticky rail (desktop) and a sheet
(phone), where it can never displace the Draw button, and reports pool state as
scannable removable pills rather than a run-on summary string.

> What the reference products actually do: Todoist attaches every option *to*
> the quick-add input rather than laying them out beside it, and its filters are
> state you read rather than a form that pushes the list down. Tailscale keeps
> the machines table as the main column always, writes status as plain
> sentences, and makes the genuinely complicated surfaces a **separate
> destination** so the default page stays short. Neither solves density with an
> accordion that triples the page.

The full proposed layouts — desktop empty state, desktop post-draw, phone —
are reproduced in the v7 roadmap items rather than here, because they are work
to be done rather than evidence.

**Its own "do not change" list**, which matters as much as the proposals: the
palette; the vibe model end to end; Edit mode for deleting a vibe; the
parametric picker's evidence panel; Top-N living in the Filters card; not
auto-expanding Pool setup on vibe selection; the honest "Counting…" round trip;
and `is_active` as a persisted default distinct from tonight's view state.

---

## 5. What all of them agreed on

Three independent passes, no shared context:

1. **Pool setup buries the primary action** and is the single largest problem.
2. **One control shape means too many things**, and the chip rows collide.
3. **Explore puts its controls above its content.**

Two more found by two of the three: the modal has no actions, and the duplicate
list rows make the counts lie.

## 6. What only one pass found, and was real

- The WCAG failure (rubric critique) — the detector missed it entirely.
- The modal receiving no focus, ever, behind `aria-modal="true"` (rubric).
- Tap targets under 44×44 throughout (rubric).
- The three shipped defects fixed in v6.11 (flow review).
- **No guard against publishing a second vote while one is open** (proposal),
  verified in `server/routes/sessions.js` — the publish route checks the lineup
  and the films and never asks whether a session is already live.

## 7. Stated gaps

None of the passes could test a real narrow viewport: `resize_window` reported
success and the window never reflowed, in two separate agents. Every mobile
claim in all four passes is derived from reading the stylesheet, not from a
rendered 390×844 page. **A real device check is outstanding and is the one
piece of evidence this file does not contain.**

No screen reader was run. The accessibility findings are markup inspection plus
one keyboard tab test, and the contrast figures are calculated from the CSS
custom properties rather than sampled from pixels.
