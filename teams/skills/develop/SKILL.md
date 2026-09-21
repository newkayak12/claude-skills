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
})                                               -> task_id, state, docs_dir
```

That one call opens the task and spawns the daemon that drives it — size, shape, critique, every
package's dispatch and fold, integrate, the goal gate, the report, or the one run a size-S
request opens — end to end. You never see `size`'s own briefing or submit its payload; the daemon
judges it itself. Prefer `tm_run` when you do not want even the `state` field back: same open,
same daemon, `{task_id, run_id, docs_dir}`.

After this you watch; you never drive.

```
tm_wait({task_id, cursor, max_ms: 60000})   # bounded long-poll: node transitions since cursor, or a timeout
    state "running"  -> call it again, immediately, with the returned cursor. Nothing else.
    state "complete" -> relay the node table (tm_status) and the report
    state "blocked"  -> a result: report what failed and stop there
```

**Never sleep, never schedule a background check, never end your turn while it is running.** You
are a headless session: it ends the moment you stop calling tools, and the daemon and its drivers
go on building into a workspace nobody is waiting for. The blocking `tm_wait` call is the only
thing holding you open — a real run died at one minute saying "I'll check again in about four
minutes", and everything it was waiting for finished long after it was gone.

`size` measures build units and ownership boundaries, so a monorepo with one test script
sizes S on its own. When the user said the work must be split — "패키지별로 나눠서", "one
worktree per package" — pass `size: "L"` to `tm_open` and the size node is recorded as pinned.

The flow is pinned, so `size` does not choose one — it only measures. `mixed: true` is
deliberate: "implement the feature and update the design note" is one run, and the note is a `document` subgoal inside it.
Pass `mixed: false` only when the user said nothing may be written that is not code — then a spec
with the other kind fails at setgoal instead of quietly running. `mixed` and `isolated` reach
whichever size-S run the daemon ends up opening.

## Then

The `tm_wait({task_id, cursor})` loop above is the whole of your job either way — a size-S task or
a task of runs — there is no manager loop left to read by hand: the daemon `tm_open` spawned is
what a relayed session used to run. Every graph run it opens is still driven by its own spawned
headless session, never by you. The Standing Mandates and Output template in
`../orchestrate/SKILL.md` apply unchanged — read them once; this skill adds nothing to them and
removes nothing from them.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts. If `plan` returns
`size: L`, say so in the report; the run still proceeds as one graph.

## What you do

Say it is code work. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, `plan` picks the flow
- `document` — same loop, flow pinned to written artifacts
