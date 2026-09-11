---
name: develop
description: >-
  Use when the user has said, in their own words, that this is code work to run through the
  graph-beta harness — "구현해줘 그래프로", "이 기능 코드로 돌려", "run the dev flow on this",
  "implement this through the graph". Pins flow: develop. When they have not said which kind of
  work it is, use orchestrate instead. Not for installation.
effort: high
scenarios:
  - "Run this feature through the harness as code work, every subgoal implemented and tested"
  - "I know this is a coding job — skip the sizing question and drive the graph"
  - "이건 코드 작업이야, 그래프로 구현→테스트→게이트 돌려줘"
  - "문서 말고 코드 흐름으로 고정해서 돌려"
compatibility:
  required:
    - graph-beta-engineering
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
  request, cwd, flow: "develop",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    delegate present  -> one run: graph_open({...delegate.args, isolated, mixed: true}), then the loop
    no delegate       -> a task of runs: ../orchestrate/references/manager.md
```

`size` measures build units and ownership boundaries, so a monorepo with one test script
sizes S on its own. When the user said the work must be split — "패키지별로 나눠서", "one
worktree per package" — pass `size: "L"` to `tm_open` and the size node is recorded as pinned.

The flow is pinned, so `size` does not choose one — it only measures. `mixed: true` is
deliberate: "implement the feature and update the design note" is one run, and the note is a `document` subgoal inside it.
Pass `mixed: false` only when the user said nothing may be written that is not code — then a spec
with the other kind fails at setgoal instead of quietly running.

## Then

Run **`../orchestrate/references/loop.md`** exactly as `orchestrate` would. The Standing
Mandates and Output template in `../orchestrate/SKILL.md` apply unchanged — read them once;
this skill adds nothing to them and removes nothing from them.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts. If `plan` returns
`size: L`, say so in the report; the run still proceeds as one graph.

## What you do

Say it is code work. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, `plan` picks the flow
- `document` — same loop, flow pinned to written artifacts
