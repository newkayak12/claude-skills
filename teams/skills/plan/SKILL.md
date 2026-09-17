---
name: plan
description: >-
  Use when the user has said the deliverable is a PRD to run through the teams harness —
  "기획서 그래프로", "PRD 작성해서 그래프로 돌려줘", "run the planning flow", "write a PRD through
  the graph". Pins flow: plan.
effort: high
scenarios:
  - "Turn this feature request into a PRD through the harness, drafted then revised by a different reader"
  - "This is a planning job - PO value framing, domain rules, feasibility read, then gated"
  - "이건 기획 작업이야, PRD 초안→퇴고→게이트로 돌려줘"
  - "일반 문서 말고 PRD 흐름으로 고정해서 기획서 써줘"
compatibility:
  required:
    - teams-engineering
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
defaults to `.teams_output/team`; `team.json`'s key of the same name overrides it). Name that path
in the planning subgoal's `files[]` when the goal-spec is authored - there is no automatic
placement yet, only the plain `files[]` mechanism every subgoal already has.

This is the standalone route, where the whole run is the PRD. `.claude/team.json`'s
`roles.planning` switch (see `install`) is a second route to the same `draft → revise → gate`
work: a planning phase-Team the EPIC flow inserts before `shape` on its own, inside an ordinary
`develop`/`document`/`orchestrate` run, writing to that same `10-prd.md` path. Use this skill when
the deliverable IS the PRD; turn `roles.planning` on instead when a PRD should precede every EPIC
that also does code or writing work, without a separate run to ask for it.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "plan",
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
with no `ready[]` — that is the design, not a stall.

```
tm_next({task_id, wait_ms: 60000})        # blocks until the task stops running, or 60s
    state "running"  -> call it again, immediately, with wait_ms again. Nothing else.
    state "complete" -> relay the node table and the report
    state "blocked"  -> a result: report what failed and stop there
```

**Never sleep, never schedule a background check, never end your turn while it is running.** You
are a headless session: it ends the moment you stop calling tools, and the leader and its drivers
go on building into a workspace nobody is waiting for. The blocking `tm_next` call is the only
thing holding you open — a real run died at one minute saying "I'll check again in about four
minutes", and everything it was waiting for finished long after it was gone.

For a size-S task that `state` is **the single run's own**, not the task's three settled manager
nodes: a size-S task's manager graph finishes the moment `size` resolves, and reading it instead
of the run is what once had a watcher call a live run `blocked` and stop two minutes in.

`size` measures build units and ownership boundaries the same way it does for `develop` and
`document`. The flow is pinned, so `size` does not choose one - it only measures. `mixed: true`
is deliberate: a PRD that also needs one supporting design note is one run, and the note is a
`document` subgoal inside it. Pass `mixed: false` only when the user said nothing may be
delivered but the PRD itself.

## Then

The blocking `tm_next({task_id, wait_ms})` loop above is the whole of your job for a size-S
task; for a task of runs it is the leader that reads `../orchestrate/references/manager.md`, not
you — you watch the same way either way. Neither case ever has you call `team_next`/`team_run`/`team_submit`
yourself: every run is driven by its own spawned headless session, never by you. The Standing
Mandates and Output template in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a planning job. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `document` — same loop, flow pinned to a general written artifact, not a PRD
- `qa` — same loop, flow pinned to test-case authoring and execution
- `install` — turn on `roles.planning` for the non-standalone route to this same work
