# Field notes

**Yours. Write badly and fast.** This is the inbox — a bug you saw on Friday, an
idea in a queue, a thing that felt wrong. No format, no triage, no thinking about
where it belongs. That is the point: a note you have to classify before writing
is a note you do not write.

Anything at all is fine:

```
- vote page felt slow on Ben's phone, maybe just wifi
- would be nice to see how long since we watched something
- the poster for Solaris is the wrong film
- ??? can we do a "shortest film wins" tiebreak
```

## How it gets emptied

**Read at the start of every session, before anything else.** Each entry is
filed to wherever it actually belongs, and the destination is reported back:

| The note is… | Goes to |
|---|---|
| A bug worth fixing now | Fixed this session, or `ROADMAP.md` if it needs a decision |
| An idea for later | `BACKLOG.md` |
| Something that settles a question | `DECISIONS.md` |
| A trap — something that produced a wrong answer quietly | A comment beside the code, and `DECISIONS.md` §3 |
| Not reproducible, or already handled | Answered in the report, and dropped |

Filed entries move to **Filed** below with one line saying where they went, so
you can see the note was understood rather than silently deleted. That section
is trimmed each session — git keeps the history, and an inbox that grows
forever is just another document to read.

**A note is never actioned silently.** If an entry implies work bigger than a
fix, it becomes a decision to put to you, not a thing that quietly joins the
diff.

---

## Inbox

<!-- write here, one line each, no format needed -->

---

## Filed

<!-- entries move here with their destination, and are trimmed each session -->

_(nothing filed yet)_
