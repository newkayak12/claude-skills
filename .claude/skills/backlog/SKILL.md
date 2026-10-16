---
name: backlog
description: Use when working in this repo and something goes on its backlog — the user names a fix or improvement ("backlog", "이것도 고쳐야", "백로그에 넣어"), a bug is seen, a scan finds drift, a Sprint leaves work undone, or a card is closed or changed. Writes the card in `_repo/docs/backlog.md`, commits and pushes it. Repo-only skill, not shipped.
---

# backlog — write the card, commit, push

Rule it serves: `.claude/rules/backlog.md` (what goes on, card shape, Sprint loop).

## Process

1. **Search first.** Read `_repo/docs/backlog.md`. A card on the same thing exists → add to it
   (Why/Acceptance/Principle lines), never a near-duplicate.
2. **Write the card** with Edit, under the `###` heading of its area (new heading only when none
   fits). Number = highest number in the file + 1. Shape:
   ```
   N. **Title — what changes, not the symptom**
      - Why: what was seen, where, absolute date; the user's words verbatim when they said it.
      - Acceptance: checkable criteria; a test or command where one exists.
   ```
   Closing a card: delete it; a shipped Sprint gets its row in `## Sprints`.
3. **Nothing private, no secrets.** The backlog is public.
4. **Commit only the backlog:** `git add _repo/docs/backlog.md`, message `backlog: <card N, what>`.
5. **Push:** `git pull --rebase` then `git push` to main's upstream (`git rev-parse --abbrev-ref
   main@{upstream}` — the remote may not be `origin`). Refused because a teams task is open →
   leave it committed, say so, push when the task closes.
6. Go back to what you were doing.

## Output Template

```
backlog: card <N> <added | updated | closed> — <title>
commit <sha>; pushed | held (teams task <key> open)
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Writes the card the moment it comes up, in your words, commits and pushes | Say what to fix; say "닫아" to close one |
| Holds the push while a teams task is open and says so | — |

## Related Skills

- `teams:orchestrate` — a Sprint takes cards from the top
