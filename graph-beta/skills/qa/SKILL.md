---
name: qa
description: >-
  Use when the user has said, in their own words, that this is a QA pass - test cases written
  and executed against work that already exists - to run through the graph-beta harness —
  "QA 그래프로 돌려줘", "테스트 케이스 작성하고 실행해줘", "run the qa flow", "write and run test cases
  through the graph". Pins flow: qa. When they have not said which kind of work it is, use
  orchestrate instead. Not for installation, and not for writing the code itself - use develop
  for that.
effort: high
scenarios:
  - "Write test cases for this feature and execute them against the tree, reporting defects"
  - "This is a QA job - cases from a user's and an attacker's perspective, then executed and gated"
  - "이건 QA 작업이야, 케이스 작성→실행→게이트로 돌려줘"
  - "구현 말고 QA 흐름으로 고정해서 테스트 케이스 뽑고 돌려줘"
compatibility:
  required:
    - graph-beta-engineering
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

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "qa",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    delegate present     -> size S, s_driver "inline": one run, graph_open(delegate.args), then the loop
    task_state "s_run"   -> size S, s_driver "process" (the default): poll tm_next until it reports
    neither              -> a task of runs: ../orchestrate/references/manager.md
```

`size` measures the same way it does for `develop` and `document`. The flow is pinned, so `size`
does not choose one - it only measures. `mixed: true` is deliberate: a QA pass that also needs
one supporting fix is one run, and the fix is a `subgoal` inside it. Pass `mixed: false` only when
the user said nothing may change but the case set and its report.

## Then

Run **`../orchestrate/references/loop.md`** yourself only for a delegated (`s_driver: "inline"`)
S run; otherwise poll `tm_next` exactly as `orchestrate` would. The Standing Mandates and Output
template in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a QA pass. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `develop` — same loop, flow pinned to the code the qa pass checks
- `plan` — same loop, flow pinned to the PRD this work traces back to
