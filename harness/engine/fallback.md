# fallback — the six-stage engine when the Workflow tool is absent

The engine (`pipeline.js`) needs the **Workflow runtime** (`agent()`, `parallel()`,
`pipeline()`). Some environments (plain Agent SDK, certain harnesses, CI) don't expose it.
This file is the **Workflow-less fallback**: the same six stages, the same contract, driven
by the **Agent tool** instead — executed by you (the orchestrator), one strictly-ordered
subgoal at a time.

**Selection rule (hard):** use this ONLY when the Workflow tool is unavailable. If Workflow
exists, run `pipeline.js` — behavior is then byte-for-byte the current engine. Never run both.

## 0. Engage the fallback (required first line)

Emit this sentinel verbatim in your first response of the run:

```
[HARNESS-FALLBACK-ORCHESTRATOR]
```

It marks THIS session as the orchestrator. The gate (`goal-gate.mjs`) then **denies gated
edits made directly by you** — you must delegate every gated edit to an Implement subagent.
This is what forces the engine to actually run instead of being invoked and bypassed. The
sentinel appears only here, only in fallback mode; Workflow runs never emit it, so their
behavior is untouched.

## 1. Plan (opus)

Dispatch one Agent (model: opus). Prompt it to invoke `agents:agent-task-decomposer`, act as
a systems analyst, and decompose the request into independently-verifiable, dependency-mapped
units — **without doing the work**. It reads `.claude/conventions/**` if present and lists the
rules that constrain the work, plus per-unit deterministic checks (commands, files).

## 2. SetGoal (opus) — author spec, adversarial critic, one revision

Dispatch one Agent (opus) to turn the plan into a **goal-spec** (schema: `goal-spec.md`):
`goal`, goal-level `acceptance[]`, and `subgoals[]` (`id`, `title`, `persona?`, `skills[]`,
`acceptance[]`, `test[]`, `deps[]`). Then dispatch a **separate** Agent (opus) invoking
`think:devils-advocate` to refute it; if unsound, dispatch one revision pass. Reject a
degenerate spec (empty subgoals / empty top-level acceptance / placeholder titles) and
re-author once.

## 3. Order the subgoals — STRICT LINEAR SEQUENCE (the guarantee)

Topologically sort `subgoals` by `deps` into a **single linear order**; break ties by spec
order (the order SetGoal wrote them). This fallback does **not** run dependency waves in
parallel — subgoals execute one after another, deterministically. If `deps` are unsatisfiable
(cycle), append the remainder in spec order and note it.

Create a task list (TaskCreate) with one item per subgoal **in that exact order**. Exactly one
item is `in_progress` at a time; mark it `completed` only after its QualityGate passes (or its
retries are exhausted), then start the next. This is the ordered checklist the user sees.

## 4. Per subgoal — Implement → Test → QualityGate, looped (bounded by max_retries)

For the current subgoal, loop up to `max_retries` (default 2):

1. **Implement (sonnet).** Dispatch an Agent as the subgoal's `persona`, told to invoke its
   `skills[]` and follow `.claude/conventions/**`. It produces the work and edits files —
   **gated edits are allowed here** because it is a subagent, not the orchestrator. It ends
   with a `HANDOFF:` section (≤1500 chars: paths, names, interfaces) for later subgoals. Pass
   the handoffs of completed dependencies as context.
2. **Test (sonnet).** Dispatch a **separate** Agent invoking
   `completion:verification-before-completion`. It does NOT trust the executor's narrative —
   it runs the `test[]` checks with Bash and Reads the claimed artifacts, reporting
   `verified` + evidence.
3. **QualityGate (opus).** Dispatch a **separate** Agent invoking `think:devils-advocate` to
   judge the subgoal against its `acceptance[]`, weighing the independent test evidence over
   the account. `pass` only if every criterion is genuinely met AND evidence supports it.

If it passes, mark the task `completed` and move on. If not, feed the verdict's reason/gaps
back as `Previous attempt was rejected. Fix:` and retry until pass or retries exhausted (then
record it failed and continue).

## 5. Goal-level QualityGate (opus) — match_pct ≥ 90, repair-and-regate

After all subgoals, dispatch one Agent (opus, `think:devils-advocate`) to judge the
**assembled whole** against goal-level `acceptance[]` and score `match_pct` (0–100, holistic
— not an average of subgoal pass/fail). If `< 90`, dispatch a repair Implement (sonnet)
addressing the gaps, then re-gate — up to `max_retries` times.

## 6. Report (sonnet)

Dispatch one Agent (sonnet) as an honest engineering status reporter: outcome first (did the
goal pass, `match_pct`), then per-subgoal PASS/FAIL with reasons, then failures and what
remains. No invented claims. Relay this report to the user, surfacing `failed[]` and a failing
goal gate honestly.

## Contract (identical to `pipeline.js` — never relax)

- **judge ≠ actor** — Test and QualityGate agents are always separate from the Implement agent.
- **model pins** — Plan/SetGoal/QualityGate = opus; Implement/Test/Report = sonnet.
- **bounded loops** — per-subgoal and goal-level loops both capped by `max_retries`.
- **deterministic Test** — evidence from Bash/Read, never the executor's narrative.
- **goal-level gate** — `match_pct >= 90` before Report.

## What's necessarily weaker than the Workflow path (say it honestly)

- Control flow is orchestrated by you, not a deterministic script — ordering is guaranteed
  (§3) but concurrency isn't; subgoals run sequentially, so it is slower.
- Enforcement is a nudge, not a wall: the orchestrator-sentinel closes the lazy bypass
  (invoke-then-edit-directly), but an active bypass (dispatch a trivial subagent that skips
  Test/QualityGate, or edit via Bash) is not closable in the same trust domain. Fail-open.
