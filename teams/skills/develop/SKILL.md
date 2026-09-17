---
name: develop
description: >-
  Use when the user says this is code work for the teams harness — "구현해줘 그래프로",
  "이 기능 코드로 돌려", "run the dev flow on this", "implement this through the graph".
  Pins flow: develop; else use orchestrate. Not for installation.
effort: high
scenarios:
  - "Run this feature through the harness as code work, every subgoal implemented and tested"
  - "I know this is a coding job — skip the sizing question and drive the graph"
  - "이건 코드 작업이야, 그래프로 구현→테스트→게이트 돌려줘"
  - "문서 말고 코드 흐름으로 고정해서 돌려"
compatibility:
  required:
    - teams-engineering
related:
  - orchestrate
  - document
---

# develop — the graph loop, flow pinned to code

Same engine, same loop, one difference: the user has told you this is code work, so the run
does not ask `plan` to decide. Every subgoal that names no `kind` is `subgoal` —
`implement → test → gate` — and the personas setgoal draws from are an implementer, a
distrustful test engineer, and next year's maintainer.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "develop",
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

`size` measures build units and ownership boundaries, so a monorepo with one test script
sizes S on its own. When the user said the work must be split — "패키지별로 나눠서", "one
worktree per package" — pass `size: "L"` to `tm_open` and the size node is recorded as pinned.

The flow is pinned, so `size` does not choose one — it only measures. `mixed: true` is
deliberate: "implement the feature and update the design note" is one run, and the note is a `document` subgoal inside it.
Pass `mixed: false` only when the user said nothing may be written that is not code — then a spec
with the other kind fails at setgoal instead of quietly running. `mixed` and `isolated` reach
whichever size-S run `tm_open` ends up opening.

## Then

Poll `tm_next` for the size-S run `tm_open` already opened and is driving (`task_state: "s_run"`),
or continue with `../orchestrate/references/manager.md` for a task of runs — exactly as
`orchestrate` would. Neither case ever has you call `team_next`/`team_run`/`team_submit`
yourself: every run is driven by its own spawned headless session, never by you. The Standing
Mandates and Output template in `../orchestrate/SKILL.md` apply unchanged — read them once; this
skill adds nothing to them and removes nothing from them.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts. If `plan` returns
`size: L`, say so in the report; the run still proceeds as one graph.

## What you do

Say it is code work. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, `plan` picks the flow
- `document` — same loop, flow pinned to written artifacts
