# Gajae-style Goal Decomposition + Team + Verification Loop — Design

Status: approved (2026-06-17)
Scope: extends `harness/` (existing cycle/plan/work/review skills remain; this adds a goal-decomposition + persona-team + independent-verification layer on top)

## 1. Problem

`harness/` already defines a thorough Product/Tech track methodology (00–13 docs), but produces *documents only* — there is no structural self-verification. A cycle can finish with a plan and a write-up while the actual work product silently diverges from both the stated acceptance criteria and the plan itself. [Yeachan-Heo/gajae-code](https://github.com/Yeachan-Heo/gajae-code) solves an analogous problem with four workflow skills (`deep-interview → ralplan → ultragoal → team`) plus four role agents (`planner/architect/executor/critic`) and a durable ledger. We want the same *workflow shape* — goal decomposition, persona-driven execution, independent verification, durable rationale — without its delivery mechanism (bun-installed CLI, tmux workers, `.gjc/` ledger format).

## 2. Decisions (from interview)

1. **Relationship to existing harness**: Option B — additive layer. Existing `harness/skills/{install,cycle,plan,work,review}` and the cycle/phase-guard machinery are untouched. This design adds goal decomposition + team execution + verification on top, reusing `cycles/active/` artifacts as input where relevant. The new goal-decomposition entry point is named `harness:goals` (not `harness:plan`, which already owns active-cycle spec/design/plan authoring).
2. **"Team" execution model**: Claude Code `Agent` tool, **not** tmux/worktree. Each persona runs as an independently-context-isolated subagent (no shared conversation state) — isolation means *context*, not filesystem (worktree was explicitly rejected).
3. **Goal decomposition semantics**: a final goal is always broken into small sub-goals; each sub-goal gets its own cycle (plan → execute → verify), never executed monolithically.
4. **Verification — 3 layers, all required**:
   - (a) acceptance-criteria satisfaction (defined before the cycle starts)
   - (b) plan-adherence (diff between stated plan and actual change)
   - (c) work-product inspection (the artifact itself, read independently)
5. **Failure handling**: on verification fail, loop Executor → Verifier. **Hard cap at 3 attempts.** On the 3rd consecutive failure, stop automatically and report failure + blocking evidence to the user — do not keep retrying silently (mirrors gajae's `checkpoint --status failed --evidence`). Critic's plan-revise loop uses the same 3-attempt cap for consistency.
6. **Personas** — 4 roles, domain-neutral (covers both software development and technical writing, unlike gajae's code-centric `architect`):
   - **Planner** — decomposes goal, sequences steps, writes acceptance criteria + `skill_hints`
   - **Critic** — reviews the plan pre-execution (devils-advocate stance); can send Planner back to revise
   - **Executor** — does the work; is steered toward the right skill(s) from this repo's existing plugins via `skill_hints`
   - **Verifier** — independent context, runs the 3-layer check above, owns the retry/fail-out decision
7. **Skill steering for Executor**: Planner attaches `skill_hints: [...]` (skill IDs from this repo, e.g. `develop:clean-code`, `write:doc-coauthoring`) to each sub-goal based on goal type; Executor invokes those skills rather than working ad hoc. See mapping table in §4.
8. **State persistence**: file-based under `.claude/harness/`, not tied to a specific cycle-numbering scheme; coexists with `cycles/active/` from the existing harness.
9. **Orchestration mechanism**: `Workflow` tool (pipeline), not plain skills and not a `while` loop hand-rolled inside a single skill — the retry cap and phase fan-out are enforced as code, not left to model discretion.
10. **RFC/Design Doc/ADR self-validation gap (found via real usage, 2026-06-18)**: existing `harness:cycle` Design phase enforces `draft → review → finalize`, but "review" there means *user* confirmation (`--confirm-user`) only — there is no independent-agent check before that gate, and RFC has no validation step at all (pure discussion loop). This is the same "documents only, no self-verification" problem from §1, just inside the existing cycle flow instead of the new goal-execution flow. Fix: reuse the same Critic persona (no new role) as one extra step *inside* `harness:cycle`'s Design phase, inserted *before* the existing `--confirm-user` gate — Critic produces a devils-advocate review attached to the RFC/Design Doc/ADR draft; the human gate still has final say, but now reviews a draft that already carries an independent critique instead of a raw, unchecked one. This is the only point where the new layer touches `harness:cycle` directly; everything else about cycle/plan/work/review stays untouched.

## 3. Architecture

```
harness:interview  (skill, entry point)
  └─ Planner agent → Socratic clarification → .claude/harness/specs/<slug>.md

harness:goals  (skill, entry point — distinct from existing harness:plan, which
                operates on active cycle spec/design/plan, not goal decomposition)
  └─ Planner agent  → decompose into sub-goals + acceptance_criteria + skill_hints
  └─ Critic agent   → reviews decomposition, can bounce back to Planner
  └─ writes .claude/harness/goals.json

harness:run  (skill, entry point → launches Workflow)
  └─ Workflow: pipeline over pending goals, per goal:
       Planner  (phase: Plan)      → cycle-level execution plan
       Critic   (phase: Critique)  → approve/revise (max 3 revisions, unified with Verifier cap)
       loop (max 3 attempts):
         Executor (phase: Execute) → guided by skill_hints
         Verifier (phase: Verify)  → 3-layer independent check
         pass → record rationale, advance to next goal
         fail, attempt==3 → mark goal `failed`, STOP pipeline for that goal,
                              surface blocker evidence to user
```

Integration point into existing `harness:cycle` (Decision #10):
```
harness:cycle Design phase (existing)
  draft RFC / Design Doc / ADR
    └─ Critic agent (new, optional step) → devils-advocate review, attached to draft
  --confirm-user gate (existing, unchanged) → user reviews draft + Critic's review together
  finalize → advance phase (existing, unchanged)
```

## 4. Persona × Skill Mapping (Executor steering)

| Goal type | Steered skills |
|---|---|
| Feature development | `develop:clean-code`, `develop:test-driven-development`, `develop:pragmatic-programmer` |
| Architecture | `develop:architecture-designer`, `develop:domain-driven-design` |
| Technical writing | `write:writing-skills`, `write:doc-coauthoring`, `technique-write:adr-writer` |
| DB / infra | `develop:database-optimizer`, `develop:dockerfile-optimizer` |
| Testing | `develop:test-master`, `develop:flaky-test-analyzer` |
| PM / strategy | `pm:prd-development`, `pm:feature-prioritization` |

Critic uses `think:devils-advocate`, `cognition:assumption-extractor`, `cognition:tradeoff-articulator`.
Verifier uses `completion:verification-before-completion`, `write:writer-verification`, `think:devils-advocate`.

## 5. State Layout

```
.claude/harness/
  specs/<slug>.md            interview output
  goals.json                 decomposed goals + status (pending|running|passed|failed)
  cycles/
    <goal-id>/
      plan.md                Planner output for this goal
      critic-review.md       Critic verdict + revision history
      work-evidence.md       Executor output + evidence, one entry per attempt
      verification.md        Verifier verdict per attempt (3-layer breakdown)
      rationale.md           why each decision was made, append-only
      status.json            {status, attempts, blocker?}
```

`goals.json` schema:
```json
{
  "final_goal": "string",
  "spec": ".claude/harness/specs/<slug>.md",
  "goals": [
    {
      "id": "G001",
      "title": "string",
      "acceptance_criteria": ["string"],
      "skill_hints": ["plugin:skill"],
      "status": "pending|running|passed|failed",
      "attempts": 0
    }
  ]
}
```

## 6. Failure Reporting

When a goal hits 3 failed verification attempts, the Workflow stops retrying that goal, sets `status: failed` with `blocker` text drawn from the last Verifier verdict, and the `harness:run` skill must surface this to the user directly (not silently continue to the next goal) before any further action.

## 7. Non-goals

- No tmux/CLI runtime, no `gjc`-equivalent binary, no bun dependency.
- No git-worktree-based isolation (explicitly rejected — isolation is context-level via `Agent`/`agent()`, not filesystem-level).
- Does not replace or restructure existing `harness/skills/{install,cycle,plan,work,review}` — additive only.
