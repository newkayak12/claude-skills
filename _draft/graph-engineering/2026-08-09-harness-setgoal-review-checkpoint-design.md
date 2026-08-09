# Harness SetGoal Review Checkpoint — Design

- **Date:** 2026-08-09
- **Branch:** `feat/harness-setgoal-quality`
- **Status:** Design (awaiting approval → writing-plans)

## Problem

`SetGoal` authors the `acceptance` criteria that every later stage
(Implement → Test → QualityGate → goal-level gate) is judged against. If those
criteria are misaligned with the user's *intent*, the entire downstream budget is
spent pursuing the wrong target — a classic garbage-in failure. The existing
adversarial critic (`think:devils-advocate`) only checks the spec's *internal*
soundness (vague/unfalsifiable criteria, fake deps, bad skill mappings). It cannot
check "does this match what the human actually wanted." Only a human can.

So the highest-leverage place to let a human intervene is **immediately after
SetGoal, before any Implement/Test/Gate budget is spent.**

## Key constraint (why this isn't a simple "add a node")

The Workflow runtime (`pipeline.js`) runs in the **background** and its DSL
(`agent` / `parallel` / `pipeline` / `log` / `phase`) has **no user-input
primitive**. `log()` emits progress but cannot collect a response. A stage that
"pauses and asks the user" cannot exist *inside* `pipeline.js`.

Therefore the checkpoint is implemented as a **resumable split at the
SetGoal→Implement edge**, not an in-run pause.

## Why the SetGoal→Implement edge is the right cut point

In graph terms, a good breakpoint sits on an edge that carries **minimal state**.
Downstream stages read **only `spec`** — never `plan`, never `critique`. The
SetGoal→Implement edge's entire interface is the single `spec` object (the engine
already materializes it as a discrete artifact at `pipeline.js:196`). Cutting here
loses no execution state. Highest intent-alignment leverage, lowest cut cost.

## Design

### Two flags (default OFF — zero change to existing autonomous behavior)

```
review_spec: true    → run Plan + SetGoal (+critic +revision) only,
                       then return { spec, stopped_for_review: true } and stop.
approved_spec: {…}    → skip Plan + SetGoal entirely; run Implement → Report
                       using this spec verbatim.
```

Both unset ⇒ current one-shot autonomous run, byte-for-byte unchanged.

### Orchestration (harness SKILL glues the two calls with a human gate)

1. Call engine with `review_spec: true` → receive `spec` JSON.
2. Present `spec` to the user. The user may **directly edit the JSON** (add/remove
   subgoals, fix acceptance lines) or approve as-is. This is spec surgery at the
   highest-leverage point, not a yes/no prompt.
3. Call engine again with `approved_spec: <edited spec>` → runs the rest.

## Parallel per-subgoal SetGoal (context isolation & clear ownership)

Today SetGoal authors the **entire** spec — `goal`, goal-level `acceptance`, and
*every* subgoal's `acceptance[]`/`test[]` — in a **single agent context**. Implement
and QualityGate already run **per-subgoal in isolated contexts** (`runSubgoal` fans
out via `parallel()` dependency waves, `pipeline.js:287-303`; each impl/gate agent
sees only its own subgoal + its upstream dependency handoffs, never sibling
internals). SetGoal is the one stage that is still monolithic. This makes it
symmetric.

### Two tiers

```
SetGoal-skeleton (opus, single / holistic)
  → goal + goal-level acceptance + subgoal stubs {id, title, persona, skills, deps}
    (deciding WHAT the subgoals are and their deps needs the whole view — not parallelizable)

  ↓  if subgoals.length >= 2  → fan out

SetGoal-detail (opus, one agent per subgoal, in parallel — isolated context)
  → authors ONLY that subgoal's acceptance[] / test[]
    context = goal + goal-level acceptance + its own stub + its dependency stubs
              + sibling TITLES (see isolation rule)

  ↓  assemble stubs + details into one spec

critic (opus, holistic — unchanged) → revision → isDegenerateSpec
```

- **`subgoals.length < 2` ⇒ skip the fan-out** and author detail inline (no benefit).
- **Critic stays holistic** — a missing subgoal or a fake dependency is only visible
  against the whole spec, so this reduce step is not parallelized.
- Graph shape: **reduce (skeleton) → map (per-subgoal detail) → reduce (critic)**.

### Isolation rule (matches Implement, with one intentional divergence)

Each detail-author sees: `goal`, goal-level `acceptance`, **its own** stub, and its
**dependency** stubs — identical to how the impl agent is scoped. **Divergence:** it
*also* sees **sibling subgoal titles** (titles only, never their `acceptance`
internals), so criteria don't overlap or leave gaps between sibling units. Implement
does not need sibling titles because deps carry the coordination; authoring criteria
does, to keep the set collectively exhaustive.

### Cost / benefit

For N subgoals, SetGoal becomes `1 skeleton + N detail` opus calls instead of `1`.
The N details run in parallel, so wall-clock ≈ skeleton + slowest-detail, not the
sum. The payoff is the session's original goal: **sharper acceptance criteria for
the QualityGate**, authored by a focused agent that holds one subgoal at a time
instead of diluting attention across all of them.

### Three-path consistency

This applies to all three engine paths (`pipeline.js`, `templates/meta-skeleton.js`,
`engine/fallback.md`) — same as the 1.12.0 convergence work. In the fallback path
the detail agents are dispatched as separate Agent calls writing
`RUN/02-subgoal-<id>-detail.json`, assembled into `RUN/02-goal-spec.json`.

## Graph-engineering mapping

| Current harness | Graph-engineering concept | State |
|---|---|---|
| Six stages | graph **nodes** | exists |
| `spec` / `handoff` | **edge state** | exists |
| SetGoal→Implement review edge | **interrupt / breakpoint edge** | **exists** (automated handlers only) |
| — `critic` + `isDegenerateSpec` + revision loop | edge's **automated interrupt handler** | exists (`pipeline.js:151-194`) |
| — human review of `spec` | edge's **human interrupt handler** | **new** |
| `max_retries` loop | bounded **cyclic subgraph** | exists |
| `rejectionSig` early-stop (1.12.0) | cycle **convergence guard** | exists |
| fallback `RUN/` dir | filesystem **checkpointer** (durable) | exists |
| Workflow re-invocation | ephemeral **fake-resume** | **new** |

This is the canonical **static-breakpoint HITL + state-injection** pattern
(LangGraph `interrupt_before` → human edits state → `Command(resume=…)`).

**Important:** the breakpoint *edge itself already exists.* SetGoal→Implement
already runs an automated review — the `think:devils-advocate` critic, one
revision pass, the `isDegenerateSpec` structural guard, and a degenerate-retry
(`pipeline.js:151-194`). What is genuinely new is (a) attaching a **human**
interrupt handler to this same edge and (b) the **resumable split** the human
handler forces (the Workflow runtime cannot pause for user input in-run). We are
not carving a new edge; we are adding a handler to an existing review edge — and
the `isDegenerateSpec` guard reused for rigor requirement #1 is already sitting on
this edge, so the resume path adds no new validation machinery.

## Three rigor requirements (must be in the implementation)

### 1. Trust the human's judgment; guard only against mechanical breakage

The human-edited `approved_spec` is untrusted graph state, but re-running an LLM
critic on it would (a) cost tokens and (b) distrust the human — defeating the
purpose of HITL. So split validation:

| Concern | Judged by | Re-checked on resume? | Cost |
|---|---|---|---|
| **Content** (are these the right criteria/subgoals) | **human** | no | 0 |
| **Structure** (JSON parses, ≥1 subgoal, no empty acceptance) | **code** | yes — `JSON.parse` + `isDegenerateSpec` | ~0 (no LLM) |

The resume path runs the existing `isDegenerateSpec` guard (pure code, no agent)
so a typo can't burn the downstream budget — this is accident prevention, not
distrust. **No LLM re-critique of human edits.**

### 2. Preserve lineage across the split

The two calls are two Workflow runs (two runIds, two journals). Downstream only
needs `spec`, so execution is unaffected — but the final Report loses the "why
these subgoals" context (Plan / critique). Pass a **plan summary and/or a
correlation id** into the resume call's `context` so the Report and any audit can
reconstruct the full lineage.

### 3. Deterministic re-entry (skip upstream, uniform downstream)

When `approved_spec` is present the engine **must** skip Plan + SetGoal (re-running
them wastes budget and would overwrite the human's edits). All downstream logic
(subgoal dep-waves, `RETRIES`, `rejectionSig` early-stop) must behave **identically
regardless of whether `spec` came from SetGoal or from the human**. The entry
branch must be a clean either/or.

## Per-path behavior — same contract, different durability (documented, not hidden)

| Path | Checkpoint mechanism | Durability |
|---|---|---|
| **fallback** (`fallback.md`) | orchestrator is the main session; it already writes `RUN/02-goal-spec.json` and can naturally pause there to ask the user | **true checkpointer** (filesystem-persisted) — reference implementation |
| **Workflow** (`pipeline.js`) | `review_spec` early-return + `approved_spec` re-invocation | ephemeral fake-resume |
| **Mode M** (`meta-skeleton.js`) | same as Workflow | ephemeral fake-resume |

We do **not** force these to be mechanically identical (unlike the 1.12.0
convergence fix). The *contract* (six stages + optional SetGoal checkpoint) is the
same; the *durability guarantee* legitimately differs and is stated as such.

## YAGNI / out of scope

- Only **one** breakpoint (SetGoal→Implement) is wired. Keep the flag interface
  shaped as "pause at this edge" so a future breakpoint (e.g. before the
  goal-gate repair loop) can reuse it — but do **not** build additional
  breakpoints now.
- No new durable checkpointer for the Workflow path (would be a large change for
  little gain given `spec` is the whole edge interface).
- No changes to the convergence/early-stop logic from 1.12.0.

## Secondary finding (surfaced during investigation, decide separately)

The Plan prompt's namespace hint (`pipeline.js:122`:
`develop:*, think:*, write:*, pm:*, cognition:*, agents:*, skill:*`) omits
`planning:*` and `superpowers:*`, yet `harness/skills/harness/SKILL.md:76`
recommends `planning:executing-plans` as an optional executor. The engine never
surfaces the `planning:` namespace to SetGoal, so that documented mapping is
effectively invisible. The seven "dual-mode" skills are documented in SKILL.md but
**not wired** into any engine execution path — their use depends entirely on the
free-form SetGoal author. Not part of this checkpoint work; noted for a follow-up
decision on whether to align the hint list or drop the doc claims.

## Open questions

- Resume correlation: pass the full `plan` text forward, or just a short summary +
  id? (Leaning: short summary + id, to keep the resume prompt small.)
- Where the user edits the spec: inline in chat, or written to a file the user
  edits then points back at? (Leaning: return JSON in chat; user edits inline.)


## Required Design Clarifications

### 1. Explicit flag exclusivity

The two flags are mutually exclusive.

`review_spec: true` and `approved_spec` must not be provided in the same invocation. If both are present, the engine must fail fast rather than implicitly choosing one path.

### 2. `approved_spec` is authoritative

The human-edited `approved_spec` is authoritative.

The resume path must not regenerate, normalize, rewrite, or otherwise semantically transform the spec through an LLM.

Mechanical validation is limited to:

- `JSON.parse`
- the existing `isDegenerateSpec` guard

Once validated, the resulting spec is passed directly into the existing downstream execution path.

### 3. Preserve lineage across the split

Preserve lineage using a dedicated `correlation_id` together with the `source_run_id` of the review run.

- `correlation_id` identifies the logical execution across both Workflow runs.
- `source_run_id` identifies the Workflow run that produced the reviewed spec.
- The resume run receives both values through `context`.

A short Plan summary may also be passed for reporting/audit purposes. The full Plan text is not required.

### 4. Review response contract

The `review_spec` response should contain sufficient metadata for the orchestrator to resume the same logical execution without inferring or reconstructing lineage.

```json
{
  "spec": {},
  "stopped_for_review": true,
  "review": {
    "correlation_id": "...",
    "source_run_id": "..."
  }
}
