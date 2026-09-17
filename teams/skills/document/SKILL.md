---
name: document
description: >-
  Use when the user says the deliverable is a written artifact for the teams harness —
  "문서 작성 그래프로", "설계 문서 돌려줘", "write the design doc through the graph",
  "run the document flow". Pins flow: document; else use orchestrate. Not for installation.
effort: high
scenarios:
  - "Write the architecture note through the harness: drafted, reviewed by someone else, gated"
  - "This is a writing job — every section drafted and read back against its rubric"
  - "이건 문서 작업이야, 초안→리뷰→게이트로 돌려줘"
  - "코드 말고 문서 흐름으로 고정해서 설계서 써줘"
compatibility:
  required:
    - teams-engineering
related:
  - orchestrate
  - develop
---

# document — the graph loop, flow pinned to writing

Same engine, same loop, one difference: the user has told you the deliverable is text, so
the run does not ask `plan` to decide. Every subgoal that names no `kind` is `document` —
`draft → review → gate` — and the personas setgoal draws from are a technical writer new
to the codebase, the reader the document is for, and an editor checking claims against source.

A `review` reads what `draft` wrote and is never the same agent: the broker refuses a review
routed to the vendor + model that drafted and leaves the node pending for rerouting. Under
`balanced` allocation this never happens — draft goes to the peer, review stays on the host.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "document",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    task_state "s_run"  -> size S: tm_open already opened the single run and is driving it
                           with its own headless session; poll tm_next until it reports
    absent              -> a task of runs: ../orchestrate/references/manager.md
```

`size` measures build units and ownership boundaries, so a monorepo with one test script
sizes S on its own. When the user said the work must be split — "패키지별로 나눠서", "one
worktree per package" — pass `size: "L"` to `tm_open` and the size node is recorded as pinned.

The flow is pinned, so `size` does not choose one — it only measures. `mixed: true` is
deliberate: "write the guide and fix the one example that no longer compiles" is one run, and the fix is a `subgoal` inside it.
Pass `mixed: false` only when the user said no code may change — then a spec
with the other kind fails at setgoal instead of quietly running. `mixed` and `isolated` reach
whichever size-S run `tm_open` ends up opening.

## Then

Poll `tm_next` for the size-S run `tm_open` already opened and is driving (`task_state: "s_run"`),
or continue with `../orchestrate/references/manager.md` for a task of runs — exactly as
`orchestrate` would. Neither case ever has you call `team_next`/`team_run`/`team_submit`
yourself: every run is driven by its own spawned headless session, never by you. The Standing
Mandates and Output template in `../orchestrate/SKILL.md` apply unchanged. One reading note: a
draft that claims no files is
`changed_files_verified: null`, attribution `document-unchanged` — the review judges it, not
git. Report it as unattributed, not as verified.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a writing job. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, `plan` picks the flow
- `develop` — same loop, flow pinned to code
