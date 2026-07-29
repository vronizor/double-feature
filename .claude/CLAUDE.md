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
for (const m of ['pool-state.js','browse.js','occasions.js','app.js','views/draw.js', /* … */]) await import('./public/' + m);
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
