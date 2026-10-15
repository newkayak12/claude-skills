# Backlog — where work waits

`_repo/docs/backlog.md` is the one list of work not yet done. Nothing found is left in chat.

## What goes on it, without being asked

Write a card the moment one of these comes up in a session, then keep working on what you were doing:

| Event | Card |
|---|---|
| The user names something to fix or improve ("backlog", "이것도 고쳐야", a complaint about a surface) | their words in **Why**, verbatim |
| A bug is seen (tool, hook, mod, engine), even one worked around | symptom, where, cause if verified (say "unverified" otherwise) |
| A scan or review finds drift from the rules | what, how many, where |
| A Sprint's report leaves work undone (`carryover_candidates`, open questions) | carried back to the top |

Not a card: what is fixed in the same session, one-session chatter, secrets.

## Card shape

```
N. **Title — what changes, not the symptom**
   - Why: what was seen, where, when (absolute date); the user's words if they said it.
   - Acceptance: checkable criteria; a test or command where one exists.
```

Search the list first; add to an existing card instead of a near-duplicate. Group under a `###`
heading by area. Frozen items (teams-mounted skills) go under `## Frozen`, never pulled.

## Sprint loop

One session is one Sprint:

1. Take cards from the top into `tm_open({requests})` — array order is priority; pass `size: "L"`
   (an unpinned small backlog sizes S and runs as one harness pass with no STORY cards) and
   `context_from` the prior Sprint.
2. Write the EPIC key next to the cards it took (`— in E-xxxxxxxx`).
3. At close: delete shipped cards, put `carryover_candidates` back on top, commit the backlog.
