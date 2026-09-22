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

`size` measures the same way it does for `develop` and `document`. The flow is pinned, so `size`
does not choose one - it only measures. `mixed: true` is deliberate: a QA pass that also needs
one supporting fix is one run, and the fix is a `subgoal` inside it. Pass `mixed: false` only when
the user said nothing may change but the case set and its report.

## Then

The `tm_wait({task_id, cursor})` loop above is the whole of your job either way — a size-S task or
a task of runs — there is no manager loop left to read by hand: the daemon `tm_open` spawned is
what a relayed session used to run. Every graph run it opens is still driven by its own spawned
headless session, never by you. The Standing Mandates, Output template, and "Running without
install" note in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a QA pass. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `develop` — same loop, flow pinned to the code the qa pass checks
- `plan` — same loop, flow pinned to the PRD this work traces back to
- `install` — turn on `roles.qa` for the non-standalone route to this same work
