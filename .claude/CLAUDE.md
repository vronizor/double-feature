# Double Feature

## Working style

- Give me your actual assessment, not the one you think I want.
  If I'm wrong, say so plainly and say why.
- Raise objections before implementing, not after. If you think
  an approach will break, stop and tell me rather than building
  it and adding a caveat at the end.
- Agreement is fine when you agree. Don't manufacture objections
  to seem rigorous — if the plan is sound, say so and move on.
- Calibrate confidence. Say "I'm not sure" when you're not sure,
  and don't hedge when you are.
- No praise openers or recaps of what you just did.
- Ask when the request is genuinely ambiguous; infer when the
  answer is in the codebase.

## How to report

Sessions here run long and produce a lot, and the context is gone by the
next one. So the report is not a courtesy — it is the handoff. Three
formats, two rules. Nothing else: no sprints, points, velocity or
burndown, and no daily cadence. The unit is a session, not a day.

Three units, and they are not the same thing. A **turn** is one prompt and
one reply. A **chunk** is one finished, verified piece of work — usually a
commit — and may take several turns. A **session** is the whole
conversation, until the context is gone.

**Open a session with this, before doing any work.** Four lines, so a
wrong plan can be redirected in one reply rather than after an hour.

```
STATE    <tests / build / what is green>
LAST     <what landed last session>
TODAY    <what I intend to pick up>
NEEDS    <decisions blocking today, by id — or "nothing to start">
```

**Mid-chunk, checkpoint lightly.** A turn that makes progress without
finishing anything says so in a few lines and moves on. No ceremony.

```
✅ <what landed> — <how it was verified>
⏭  next: <the next chunk>
⚠️  found: <anything unexpected, and what I did with it>
📦 <uncommitted files, and whether a commit boundary is here>
```

The 📦 line is a standing prompt to commit, not a request for permission —
still only commit when asked. It exists because a finished chunk *is* the
natural boundary, and once a working tree passes ~10 files the split can no
longer be made cleanly: changes from different themes land in the same file
and cannot be separated without hunk-level staging. One session reached 35
files across six unrelated themes, and `browse.js` alone carried four of them.

**Close every CHUNK with four sections, always in this order** — and bump
the MINOR version in the same commit. A chunk is the unit that gets a real
report, because it is the unit that actually delivers something. A session
needs no closing ritual beyond the last chunk's report.

- **LANDED** — what is done *and how it was verified*. One line each.
  A line with no verification is a claim, not a result. Write
  `⚠️ landed, not verified against the real DB` rather than a clean
  tick — a report that looks authoritative and is wrong is worse than
  loose prose.
- **NEEDS YOUR CALL** — numbered `D1, D2…`, each with exactly four
  things: the question, one line of context, the options with a
  recommendation, and what it blocks. Numbered so the reply can be
  `D1 yes, D2 a, D3 defer` without hunting through paragraphs.
- **BLOCKED** — genuinely stuck on something external. Distinct from a
  decision: a decision means the work *can* proceed and the choice is
  the user's; blocked means it cannot. Usually empty.
- **NEXT** — what happens if the user says nothing, so silence is a
  valid answer.

**NEEDS YOUR CALL is never omitted.** If nothing is owed it says "none".
An empty section is information; a missing one is a question the user has
to think to ask, and they should not have to.

Three working rules:

- **WIP limit of three.** More than three live threads is what makes a
  session sprawl. Everything else waits its turn as ⏳ ready in
  `ROADMAP.md`'s status table.
- **Commit at chunk boundaries, when asked.** See the 📦 line above.
- **Findings are reported, not folded into the diff.** Something noticed
  mid-task goes in the report; it does not quietly join the work the
  user asked for.

Decisions, once made, get written where they belong — see the routing
rule below. The report itself adds no new files and no new bookkeeping.

## Project conventions

- Verify against the real API and the real database rather than
  reasoning about what they probably contain. Several decisions
  here were reversed by measurement.
- Record why, not just what. Where it goes is decided by the routing
  rule below, not by habit.
- Keep the test suite green; new behaviour comes with tests. It is
  hermetic — no credentials, no network — and must stay that way.
- The database is snapshotted automatically before migrations run. Do
  not rely on remembering; do not remove that guard.

## Traps that have already bitten

Both of these cost real time more than once. They are not obvious and
neither is caught by the usual checks.

**A backtick inside a SQL comment terminates the `SCHEMA` string.**
`server/db.js` holds the whole schema in one template literal, so writing
`` `category` `` in a comment ends the string and the file fails to parse
with a confusing error pointing at the SQL. Use plain words in those
comments — no backticks anywhere between the opening and closing `` ` ``.

**`node --check` passes on a missing import.** It is a syntax check, so a
symbol that is used but never imported sails through and only fails in the
browser. After touching frontend modules, load them all under a stubbed
DOM to confirm every import resolves:

```js
globalThis.document = { createElement: () => ({ style:{}, setAttribute(){}, append(){}, addEventListener(){}, classList:{ add(){} } }), getElementById: () => null, addEventListener(){} };
globalThis.window = { addEventListener(){}, location:{ hash:'', pathname:'/' } };
globalThis.localStorage = { getItem: () => null, setItem(){} };
globalThis.location = { hash:'', pathname:'/' };
for (const m of ['pool-state.js','browse.js','vibes.js','app.js','views/draw.js', /* … */]) await import('./public/' + m);
```

## Where the context lives

### Read these four, every session, before proposing anything

Nothing else. They total roughly 600 lines by design, and that budget is
the point — a session that reads 2,000 lines of prose before touching
code has already spent its attention.

- **`NOTES.md`** — the field-notes inbox. **Read it first and file it**
  before starting anything: bugs seen and ideas jotted since last time.
  Each entry goes to its destination and gets reported back; nothing is
  actioned silently, and nothing is deleted without saying where it went.
- **`ROADMAP.md`** — the live view. What is being worked on and what is
  decided but unbuilt. Three states only.
- **`DECISIONS.md`** — what has been settled and must not be
  re-proposed: reversals, things deliberately not built, traps that
  produce wrong answers without failing, settled vocabulary.
- **This file** — how to work and how to report.

### Read these only when you need them, and say that you did

- **`docs/evidence/*.md`** — the long measurement write-ups behind the
  decisions. Open one only when reopening that question.
- **`HISTORY.md`** — shipped work and its reasoning. Open it to answer
  "why is it like this", never to plan.
- **`BACKLOG.md`** — v5, v6, unscheduled, and things deliberately dropped.
- **`ARCHITECTURE.md`** — a plain-language tour for someone who directs
  this without writing it. **A dated snapshot, deliberately not
  maintained, and never part of startup reading.** Parts of it are known
  to be stale. The code wins; `DECISIONS.md` wins for decisions.

### The routing rule — where a new piece of writing goes

Ask one question: **"When will this stop being true?"**

| Answer | Goes |
|---|---|
| Never | `DECISIONS.md` — the statement. Long working goes to `docs/evidence/` |
| When the code changes | **A comment beside that code. Never a document.** |
| When the work is done | `ROADMAP.md` |
| It already has | `HISTORY.md`, or delete it |

**No `file:line` references, no counts, and no descriptions of current
code behaviour in any startup document.** A full inventory of these docs
found 24 stale claims, and **19 were counts or file pointers** — while
not one recorded decision had gone stale. That asymmetry is the whole
reason for the split. If a fact about the code is worth writing down, it
belongs where whoever changes that code will see it.
