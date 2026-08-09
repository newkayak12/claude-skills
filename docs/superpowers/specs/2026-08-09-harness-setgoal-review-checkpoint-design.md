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

## Graph-engineering mapping

| Current harness | Graph-engineering concept | State |
|---|---|---|
| Six stages | graph **nodes** | exists |
| `spec` / `handoff` | **edge state** | exists |
| SetGoal→Implement | **interrupt / breakpoint edge** | **new** |
| `max_retries` loop | bounded **cyclic subgraph** | exists |
| `rejectionSig` early-stop (1.12.0) | cycle **convergence guard** | exists |
| fallback `RUN/` dir | filesystem **checkpointer** (durable) | exists |
| Workflow re-invocation | ephemeral **fake-resume** | **new** |

This is the canonical **static-breakpoint HITL + state-injection** pattern
(LangGraph `interrupt_before` → human edits state → `Command(resume=…)`).

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
