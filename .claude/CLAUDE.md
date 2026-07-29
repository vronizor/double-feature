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
