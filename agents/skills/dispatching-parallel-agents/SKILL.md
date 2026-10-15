---
name: dispatching-parallel-agents
effort: high
description: >-
  Use when facing 2+ independent jobs that can run concurrently — fan out in
  parallel, each on its best-fit persona. Triggers: "병렬로 처리해줘", "동시에 여러 작업",
  "parallel agents", "독립적인 작업들 한번에", "각자 전문가한테 맡겨줘", "multiple independent
  failures".
scenarios:
  - "세 개 테스트 파일이 각각 다른 이유로 실패해 — 병렬로 고쳐줘"
  - "두 서브시스템 각각 독립적으로 리팩토링해줘"
  - "Run code reviews on these three separate modules in parallel"
  - "느린 쿼리랑 프론트 버그랑 flaky 테스트 — 각자 맞는 전문가한테 동시에"
  - "Generate these two reports simultaneously"
  - "각 팀의 독립적인 작업 동시에 진행해줘"
compatibility:
  recommended:
    - sequential-thinking  # pre-dispatch independence check — confirms no shared files or causal links
  optional:
    - think-tool           # reason about persona fit and true independence before dispatching
  remote_mcp_note: >-
    think-tool이 있으면 병렬 실행 전 에이전트 간 파일 충돌·인과 관계가 없는지, 각 job에 어떤 persona가
    맞는지 확인할 수 있습니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS confirm independence (no shared files, no causal link) before fanning out.
- ALWAYS match each job to its best-fit persona by what the job is; no clean fit means general-purpose.
- ALWAYS give each agent a focused, self-contained brief with no shared context.
- NEVER let two agents touch the same files or contend for the same resource.

# Dispatching Parallel Agents

Independent jobs, fanned out in parallel, each on the persona it calls for, then
gathered and verified as a whole. Parallelism is the engine; persona-matching is
the multiplier.

**Core principle:** one isolated agent per independent job, running concurrently —
and each agent wears the persona that job actually calls for.

**Allocator, not pipeline.** The harness (`harness:harness`) runs *fixed vertical
stages* over a single goal (Plan→Implement→Test→…). This skill is the opposite
axis: *horizontal fan-out* of unrelated jobs, no stages, no ordering.

## When to Use

```
Multiple jobs or failures?
  No  → Single agent handles it
  Yes → Are they independent? (no shared files, no causal relationship)
          No  → Single agent investigates all (related — fixing one may fix others)
          Yes → Can they run concurrently? (no shared state)
                  No  → Sequential agents
                  Yes → Parallel dispatch, one persona-matched agent per job
```

**Use when:**
- 3+ test files failing with different root causes
- A batch of unrelated jobs each needing a *different* specialty (SQL vs frontend vs infra)
- Parallel code reviews across separate modules
- Multiple independent reports or audits to produce at once
- Each job can be understood without context from the others, no shared state

**Don't use when:**
- Jobs are related (fixing one might fix others) — investigate together first
- You need full system state to understand any of them
- Agents would edit the same files or contend for the same resource

## Process

0. **INDEPENDENCE** — confirm the jobs are truly independent BEFORE fanning out
   (use sequential-thinking / think-tool for this check).
   - No two agents will touch the same files.
   - No causal link (fixing one won't fix/break another).
   - Each job is fully understandable without the others' context.

   A wrong parallelism call costs more than sequential would have.
1. **ALLOCATE** — match each job to its best-fit persona by what the job IS, not by
   a fixed registry: extract the dominant signal, route to the closest specialist.
   No clear fit → general-purpose. Persona table and method:
   [references/allocation-and-briefs.md](references/allocation-and-briefs.md).
2. **DISPATCH** — one isolated subagent per job, in parallel. Mount the persona, give
   a focused self-contained brief, no shared context between agents. This is the
   parallel-agent core — it always stays. Each brief has five parts:
   1. **Persona** — who the agent is ("You are a database-optimizer…")
   2. **Focused scope** — one job, one boundary ("only src/agents/agent-tool-abort.test.ts")
   3. **Self-contained context** — the errors, test names, constraints it needs
   4. **Constraints** — what it must NOT touch ("do not change production code")
   5. **Expected output** — the summary/verdict shape you want back

   Dispatch call and a full example brief:
   [references/allocation-and-briefs.md](references/allocation-and-briefs.md).

   **Worktree isolation.** For every agent that writes files, prefer
   `isolation: "worktree"` — each gets its own git worktree, so edits can't collide.
   If the runtime doesn't support it, fall back to the step-0 check: no two agents
   touch the same files. Read-only agents need neither.

   Each agent runs in its **own context** — it never sees your reasoning or the other
   agents' work. That isolation is deliberate: it keeps jobs from cross-contaminating
   and keeps each verdict independent (same isolation principle as
   `completion:verification-before-completion`).
3. **GATHER** — integrate and settle "done". When agents return:
   1. **Read each summary** — understand what each persona changed.
   2. **Check for conflicts** — did any two agents touch the same code despite step 0?
      Worktree results must be merged back into the main tree; resolve and re-check
      conflicts after each merge.
   3. **Run the whole thing** — the full suite / build, not just the touched parts.
   4. **Settle the claim** — route "it passes now" through
      `completion:verification-before-completion` (isolated fresh evidence), not the
      agents' own success messages.

## Output Template

```
## Gather report
Job 1: <job> — persona: <persona> | scope: <files/boundary> | worktree: <path | none (no-shared-files)>
  result: <summary of what changed>
  conflicts: <found / resolved, or none>
Job 2: …
Full suite: <command> → exit <code>
Verification (completion:verification-before-completion): <verdict>
```

## Common Mistakes

| ❌ | ✅ |
|----|----|
| "Fix all the tests" — agent gets lost | "Fix agent-tool-abort.test.ts" — focused scope |
| One generalist for every job | Persona per job — right defaults, less rework |
| Skipping the independence check | Confirm no shared files / causal link first |
| File-writing agents sharing one checkout | `isolation: "worktree"` per agent, or verify no shared files |
| Pasting your own reasoning into each brief | Clean self-contained brief — keep contexts isolated |
| Trusting an agent's "done" message | Gather + verify the whole through fresh evidence |
| Fixed persona registry that rots | Match on the job's signal dynamically |

## Red flags — stop

- About to fan out without confirming the jobs are independent.
- Handing a SQL job and a frontend job to the same generalist "to save agents".
- Leaking one job's context into another agent's brief.
- Declaring the batch done off the agents' summaries instead of a full re-run.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Verifies the jobs are independent | Confirm independence if it's ambiguous |
| Allocates each job to its best-fit persona | Name specialist personas Claude should prefer |
| Dispatches isolated agents in parallel | Review the gathered result |
| Gathers and verifies the whole | Accept or send back |

## Related Skills

- `agents:agent-task-decomposer` — split one big job into the independent pieces this
  skill then fans out.
- `completion:verification-before-completion` — the gather-step gate: settle "done"
  with isolated fresh evidence, not agent self-reports.
- `harness:harness` — the other axis: fixed vertical stages over one goal, where
  this skill is horizontal fan-out of many jobs.
