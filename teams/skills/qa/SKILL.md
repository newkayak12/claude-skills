---
name: qa
description: >-
  Use when the user has said this is a QA pass — cases written and executed against existing
  work — to run through the teams harness — "QA 그래프로 돌려줘", "테스트 케이스 작성하고
  실행해줘", "run the qa flow". Pins flow: qa.
effort: high
scenarios:
  - "Write test cases for this feature and execute them against the tree, reporting defects"
  - "This is a QA job - cases from a user's and an attacker's perspective, then executed and gated"
  - "이건 QA 작업이야, 케이스 작성→실행→게이트로 돌려줘"
  - "구현 말고 QA 흐름으로 고정해서 테스트 케이스 뽑고 돌려줘"
compatibility:
  required:
    - teams-engineering
related:
  - orchestrate
  - develop
  - plan
---

# qa — the graph loop, flow pinned to test-case authoring and execution

Same engine, same loop, one difference: the user has told you this is a QA pass, so the run does
not ask the decomposition stage to choose a flow. Every subgoal that names no `kind` is `qa` —
`cases → execute → gate` — and the personas setgoal draws from are a QA who represents the user,
a release manager weighing risk, and someone deliberately trying malicious or malformed input.

There is no `test` node in this chain - `execute` is the test: it runs the case set `cases` wrote
against the tree exactly as written and reports failures as defects, not as a narrative. `execute`
may write under `test/` or its own report path; it must not touch `src/` - that boundary is what
the engine's changed-file check is for. A qa subgoal's `deps[]` should name the develop work it is
checking, so it never runs before there is anything to check.

This is the standalone route, where the whole run is the QA pass. `.claude/team.json`'s
`roles.qa` switch (see `install`) is a second route to the same `cases → execute → gate` work: a
QA phase-Team the EPIC flow inserts between `integrate` and `gate:goal` on its own, reusing the
repair worktree, inside an ordinary `develop`/`document`/`orchestrate` run. Use this skill when
the deliverable IS the QA pass; turn `roles.qa` on instead when every EPIC should get one
automatically, gating its own `gate:goal`.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "qa",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    queued: true        -> the ordinary reply. tm_open spawned the TaskLeader, and a mutating
                           call from any process but the leader is queued for it - your sizing
                           is applied on the leader's next tm_next, not lost. You do NOT get
                           task_state or a verdict back, and there is nothing to wait for here
    task_state "s_run"  -> only when no leader is running: size S, and this reply already
                           carries tm_next's own fields for the single run
    absent              -> a task of runs: ../orchestrate/references/manager.md
```

After this you watch; you never drive. `tm_next` from this session answers `driven_by: "leader"`
with no `ready[]` — that is the design, not a stall. Poll `tm_next` or `tm_status` until `state`
is `complete` or `blocked`, then relay the report. For a size-S task that `state` is **the single
run's own**, not the task's three settled manager nodes: a size-S task's manager graph finishes
the moment `size` resolves, and reading it instead of the run is what once had a watcher call a
live run `blocked` and stop two minutes in.

`size` measures the same way it does for `develop` and `document`. The flow is pinned, so `size`
does not choose one - it only measures. `mixed: true` is deliberate: a QA pass that also needs
one supporting fix is one run, and the fix is a `subgoal` inside it. Pass `mixed: false` only when
the user said nothing may change but the case set and its report.

## Then

Poll `tm_next` for the size-S run `tm_open` already opened and is driving (`task_state: "s_run"`),
or continue with `../orchestrate/references/manager.md` for a task of runs — exactly as
`orchestrate` would. Neither case ever has you call `team_next`/`team_run`/`team_submit`
yourself: every run is driven by its own spawned headless session, never by you. The Standing
Mandates and Output template in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a QA pass. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `develop` — same loop, flow pinned to the code the qa pass checks
- `plan` — same loop, flow pinned to the PRD this work traces back to
- `install` — turn on `roles.qa` for the non-standalone route to this same work
