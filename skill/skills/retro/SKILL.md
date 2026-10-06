---
name: retro
effort: high
description: >-
  Use when a session's repeated mistakes or corrections should stop recurring. Triggers on: "이번 세션 회고해서 다음에 같은 실수 안 하게 해줘", "또 같은 실수네", "session retro", "stop repeating this mistake".
scenarios:
  - "Run a retro on this session so you don't make the same mistakes again"
  - "You keep making the same mistake. What should we change so it stops?"
  - "이번 세션 회고해서 다음에 같은 실수 안 하게 해줘"
  - "같은 지적을 세 번 했어. 재발 안 하게 뭘 바꿔야 해?"
  - "세션 돌아보고 CLAUDE.md나 훅에 뭘 넣을지 제안해줘"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 반복된 실수가 검사로 잡히는 종류인지 판단의 문제인지 가르는 분류를 더 꼼꼼히 할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER answer a mechanical repeat with a prose rule — no memory note, no CLAUDE.md line. A rule asks the same agent that just failed to remember; a check fails the build whoever forgets. Probe: a twice-corrected `@/` import and three skipped lint runs ended in two memory notes; the lint rule was only offered, `package.json` never opened.
- ALWAYS read the repo's own check command before proposing anything: `package.json` scripts, `Makefile`, CI config, git hooks. A check that exists but is unwired or skipped is the finding, not a new one.
- NEVER write or edit any file, and never save a memory, before the user approves in so many words. The run ends with the proposal. A retro that rewrites `CLAUDE.md` unasked edits a file the whole team loads.
- NEVER invent a repeat. Every item carries a quote from the session and a count; one occurrence is an `incident`, not a pattern.
- Goal: every repeat has a class, a count, and one proposed fix. The Count line recounts to the table. One pass, then wait.

# Retro

Reads one session's corrections, finds what repeated, and proposes the smallest change to the environment that makes it stop.

**Not for** inventorying which skills or plugins exist (`skill:audit`) or repairing a single skill that misfires (`write:writing-skills`).

## Process

1. **Scope.** The session the user named; none named → the current one. Source is the transcript or log the user pasted. Done when the source is identified; cannot reach it → ask once in one line.
2. **Collect.** Each correction, re-ask, or "again" the user made. Quote the user's words, count occurrences, name the file or step. Fold items with the same cause into one row. Done when no two rows share a cause and each has a quote and a count.
3. **Read the checks.** Open `package.json` scripts, `Makefile`, CI workflow, and `.git/hooks` or hook config; name the lint / typecheck / test command that exists and whether anything runs it automatically. No guardrail at all is itself a finding.
4. **Classify** each row:
   - **Mechanical** — a fixed pattern a tool can see (a banned import shape, an unrun command, a file-location rule, an unused symbol). Default.
   - **Judgement** — cross-file consistency, naming taste, "match the surrounding style"; no check could substitute.
   A row you hesitate on is mechanical until you have tried to write the check in one sentence and failed.
5. **Propose.** Mechanical → the check itself, named by file and form: a custom or built-in lint rule (`no-restricted-imports`), a pre-commit or Claude Code hook, a CI step, a test. Show the exact config diff. Judgement → one `CLAUDE.md` line or a skill edit, carrying its scar (the quote and count that earned it). Max one fix per row, no menus.
6. **Stop.** Present the proposal and wait. Approval for some rows is approval for those rows only.

## Output Template

```
Verdict: <n> repeats, <m> mechanical · <j> judgement. Biggest: <the one that cost most> — <fix form>.

Repo checks: <command → where it runs (hook / CI / nowhere)>

| # | Repeat (user's words) | Count | Class | Fix | Scar |
|---|-----------------------|-------|-------|-----|------|
| 1 | "<quote>" | <n>× | mechanical | <file: lint rule / hook / test> | — |
| 2 | "<quote>" | <n>× | judgement | <CLAUDE.md line / skill edit> | <quote, count> |

Proposed diffs:
<one block per row>

Incidents (once only, no fix): <quote — or none>
Count: <m> mechanical + <j> judgement = <n> repeats
Approve rows: <numbers> — nothing is written until you say so.
```

Do NOT pad with generic advice (every line must trace to a table row), and do NOT close with a second option for the same row.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Quotes and counts the repeats, reads the repo's check command, classifies each | Say which session, and correct a misclassified row |
| Writes the check or the rule as an exact diff, with its scar | Approve rows by number |
| Applies only the approved rows afterwards | Decide what the team's `CLAUDE.md` should carry |

## Related Skills

- `skill:audit` — what skills, plugins, and hooks the workspace already has.
- `write:writing-skills` — a skill that misfires; edit that skill rather than add a retro rule.
- `update-config` — applying an approved hook or permission to `settings.json`.
