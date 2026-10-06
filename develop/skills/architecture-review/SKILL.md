---
name: architecture-review
effort: high
description: >-
  Use when an existing codebase feels hard to change and you want ranked refactor targets from git history, not a redesign. Triggers on: "어디부터 리팩토링할까", "코드가 얽혀서 손대기 힘들어", "where should we refactor this repo".
scenarios:
  - "Our repo is painful to change — find the modules worth deepening first"
  - "Review the architecture of this codebase and rank where refactoring would pay off"
  - "Which files keep changing and are too shallow to test well?"
  - "코드베이스가 너무 얽혀 있어, 어디부터 구조를 손봐야 할지 후보를 뽑아줘"
  - "자주 바뀌는데 테스트하기 어려운 모듈이 뭔지 찾아줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 후보마다 삭제 테스트 결과와 ADR 충돌을 따져보는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER rank by how a file looks. Scan where the history says change happens, and rank by counts. A small
  pass-through file nobody touches looks worst and is cheapest to spot; deepening it pays nothing, and it pushes the
  hot module the team fights every week down the list.
- NEVER propose an interface, signature, or file split, and never edit code, until the user picks a candidate. A design
  for the wrong candidate is the work the user then has to read and discard.
- NEVER re-argue a recorded decision. A candidate that contradicts an ADR appears only with its ADR id and the friction
  that justifies reopening it; a refactor an ADR already forbids is not listed.

Goal: every candidate row carries its three counts, the closing tally recounts to the table, and the run stops at the
user's pick.

# Architecture Review

Finds where deepening a shallow module would make the next change cheaper — in code that already exists — and
stops at a ranked list. "Shallow" = an interface nearly as complex as what it hides, so callers must know the inside.

**Not for** a greenfield or from-scratch design (`develop:architecture-workflow`); layer or dependency-rule review of
a design you hand over (`develop:clean-architecture`); modelling the domain or its boundaries
(`develop:domain-driven-design`).

## Process

1. **Scope.** The user named a module or pain point → scan that and skip step 2. Otherwise step 2. Which repo,
   which window? Missing → default to the repo at hand, 90 days; say so in one line and proceed.
2. **Hot spots.** Run
   `git log --since="90 days ago" --name-only --format= | sort | uniq -c | sort -rn | head -30` and show the command
   with its top rows. Generated files, lockfiles, and vendored paths are dropped, and the drop is named. Churn
   spread flat across many files = no hot spot: widen the window once (180 days) and say it was widened; still flat →
   report that and stop, do not invent a target.
3. **Discover decisions** (alongside step 2). Look for `docs/adr/`, `adr/`, `decisions/`, `CONTEXT.md`, `GLOSSARY.md`. Read the ones that
   touch the hot spots. None found → write "no ADRs or glossary found" and proceed. Name modules in the glossary's
   words when one exists.
4. **Find shallow modules among the hot spots.** For each hot file or directory, read it and its callers. Signals: the
   interface (exports, parameters, config) is about as large as the body; understanding one concept means hopping
   across many small files; logic was extracted for testability while the real bugs sit in how it is called; callers
   reach through it to its internals. Apply the deletion test as defined in `develop:clean-architecture` — it does not
   get restated here. "Complexity reappears across callers" keeps the row; "vanishes" drops it (a pass-through is a
   simpler fix, not a deepening).
5. **Count, then rank.** Per candidate, three counts, each re-runnable (run them for all candidates in one batch):
   - **Commits** touching it in the window (`git log --since=… --oneline -- <path> | wc -l`)
   - **Importers/callers** (grep; name the command)
   - **Deletion test** result: `reappears in <n> callers` or `vanishes`
   Confidence is a function of those counts, not a feeling: **high** = commits ≥ 10 and callers ≥ 5 and the
   complexity reappears; **medium** = two of the three; **low** = one. Sort by commits × callers. A count that cannot
   be obtained is written `unverified`, counts as not met, and the row cannot be high.
6. **ADR check.** Compare each candidate with the ADRs found. Contradiction → keep the row only if the friction is
   concrete (cite the commits or callers); tag it `conflicts ADR-<id>`.
7. **Stop.** Present the table and ask which candidate to take. After the pick, and only then, proceed to
   interface options for that one — this skill ends at the list.


## Output Template

```
## Architecture review — <repo or path>, <window>

Hot spots: `<git log command>` · dropped: <generated/lock paths or none>
Decisions found: <ADR ids / glossary file> | no ADRs or glossary found

| # | Candidate (path) | Commits | Callers | Deletion test | Confidence | ADR |
|---|------------------|---------|---------|---------------|------------|-----|
| 1 | <path>           | 14      | 9       | reappears in 9 callers | high | — |

Why #1: <one line, citing its counts — not an adjective>
Dropped after the deletion test: <path — vanishes> ...

<n> hot spots scanned · <k> candidates (<h> high)

Which one do you want to take? (No interface proposal until you pick.)
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Runs the history scan, counts, and the deletion test per candidate | Name the module or pain point if you already know it |
| Reads ADRs and flags the one id a candidate contradicts | Say whether an ADR is still binding |
| Ranks by counts and stops at the table | Pick the candidate; decide whether to proceed |

## Related Skills

- `develop:clean-architecture` — owns the deletion test and the dependency rule.
- `develop:architecture-workflow` — no code yet; design from the start.
- `develop:domain-driven-design` — the names or boundaries are what is wrong.
- `develop:service-boundary-validator` — the candidate is a whole service.
