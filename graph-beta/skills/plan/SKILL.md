---
name: plan
description: >-
  Use when the user has said, in their own words, that the deliverable is a PRD or product
  requirement write-up to run through the graph-beta harness — "기획서 그래프로", "PRD 작성해서
  그래프로 돌려줘", "run the planning flow", "write a PRD through the graph". Pins flow: plan.
  When they have not said which kind of work it is, use orchestrate instead. Not for
  installation, and not for a general design note or guide - use document for those.
effort: high
scenarios:
  - "Turn this feature request into a PRD through the harness, drafted then revised by a different reader"
  - "This is a planning job - PO value framing, domain rules, feasibility read, then gated"
  - "이건 기획 작업이야, PRD 초안→퇴고→게이트로 돌려줘"
  - "일반 문서 말고 PRD 흐름으로 고정해서 기획서 써줘"
compatibility:
  required:
    - graph-beta-engineering
related:
  - orchestrate
  - document
  - qa
---

# plan — the graph loop, flow pinned to product requirements

Same engine, same loop, one difference: the user has told you the deliverable is a PRD, so the
run does not ask the decomposition stage to choose a flow. Every subgoal that names no `kind` is
`planning` — `draft → revise → gate` — and the personas setgoal draws from are a PO who owns
value and scope, a domain expert who owns terminology and rules, and an implementation lead
reading for feasibility.

`revise` is a different identity from `draft` - the broker refuses a revise routed to the vendor
+ model that drafted, the same way it refuses a mismatched `document` review. Unlike `document`'s
`review`, `revise` may edit the artifact: it rewrites for the reader and checks every claim
against its evidence, rather than only judging what draft wrote.

The PRD itself is a node-written original, filled from `pm:prd-development`'s `template.md` (not
a rendered copy of it), at `<docs_dir>/E-<first 8 chars of task_id>/10-prd.md` (`docs_dir`
defaults to `.harness-run/team`; `team.json`'s key of the same name overrides it). Name that path
in the planning subgoal's `files[]` when the goal-spec is authored - there is no automatic
placement yet, only the plain `files[]` mechanism every subgoal already has.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "plan",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, ready: [size]
fresh agent at size.briefing_path -> tm_submit({task_id, node_id: "size", payload})
    delegate present     -> size S, s_driver "inline": one run, graph_open(delegate.args), then the loop
    task_state "s_run"   -> size S, s_driver "process" (the default): poll tm_next until it reports
    neither              -> a task of runs: ../orchestrate/references/manager.md
```

`size` measures build units and ownership boundaries the same way it does for `develop` and
`document`. The flow is pinned, so `size` does not choose one - it only measures. `mixed: true`
is deliberate: a PRD that also needs one supporting design note is one run, and the note is a
`document` subgoal inside it. Pass `mixed: false` only when the user said nothing may be
delivered but the PRD itself.

## Then

Run **`../orchestrate/references/loop.md`** yourself only for a delegated (`s_driver: "inline"`)
S run; otherwise poll `tm_next` exactly as `orchestrate` would. The Standing Mandates and Output
template in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a planning job. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `document` — same loop, flow pinned to a general written artifact, not a PRD
- `qa` — same loop, flow pinned to test-case authoring and execution
