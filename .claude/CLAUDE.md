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

**Open a session with this, before doing any work.** Five lines, so a
wrong plan can be redirected in one reply rather than after an hour.

```
STATE    <tests / build / what is green>
LAST     <what landed last session>
TODAY    <what I intend to pick up>
NEEDS    <decisions blocking today, by id — or "nothing to start">
```

**Checkpoint after each finished chunk.** Three lines, so progress is
visible without stopping to write an essay, and surprises surface when
found rather than at the end.

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

**Close a session with four sections, always in this order.**

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

Three working rules:

- **WIP limit of three.** More than three live threads is what makes a
  session sprawl. Everything else waits its turn as ⏳ ready in
  `ROADMAP.md` §5.
- **Commit at chunk boundaries, when asked.** See the 📦 line above.
- **Findings are reported, not folded into the diff.** Something noticed
  mid-task goes in the report; it does not quietly join the work the
  user asked for.

Decisions, once made, still get written where they already belong —
inline in `ROADMAP.md`, measurements in `BACKLOG.md`, state in the §5
status table. The report adds no new files and no new bookkeeping.

## Project conventions

- Verify against the real API and the real database rather than
  reasoning about what they probably contain. Several decisions
  here were reversed by measurement.
- Record why, not just what — in comments, and in `ROADMAP.md` /
  `BACKLOG.md` for anything deferred. Reversed decisions get
  written down so they aren't re-proposed.
- Keep the test suite green; new behaviour comes with tests.
- Back up `data/*.db` before a migration.

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

Read these before proposing anything; they exist so a cold session doesn't
re-derive decisions or repeat rejected experiments.

- **`ROADMAP.md` §2** — reversals, recorded so they aren't re-proposed:
  certification filtering is unsafe, streaming is a badge not a filter,
  `with_crew` is unusable for director night.
- **`ROADMAP.md` §4** — v2 is shipped, but the traps noted against each
  item are still true of the code: `seed.mjs` matches lists by NAME,
  `renderSessionPanel` is shared with the History tab, and `rank IS NULL`
  must survive a top-N cut.
- **`ROADMAP.md` §5** — v3, agreed but not started.
- **`BACKLOG.md`** — measurement write-ups (popularity vs acclaim,
  national popularity) that are the evidence behind the v3 items, plus a
  `Dropped` section for things deliberately not done.
