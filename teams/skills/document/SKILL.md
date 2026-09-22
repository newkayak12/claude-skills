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
})                                               -> task_id, state, docs_dir, view_url
```

That one call opens the task and spawns the daemon that drives it — size, shape, critique, every
package's dispatch and fold, integrate, the goal gate, the report, or the one run a size-S
request opens — end to end. You never see `size`'s own briefing or submit its payload; the daemon
judges it itself. Prefer `tm_run` when you do not want even the `state` field back: same open,
same daemon, `{task_id, run_id, docs_dir, view_url}` - open `view_url` in a browser to watch the run.

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
deliberate: "write the guide and fix the one example that no longer compiles" is one run, and the fix is a `subgoal` inside it.
Pass `mixed: false` only when the user said no code may change — then a spec
with the other kind fails at setgoal instead of quietly running. `mixed` and `isolated` reach
whichever size-S run the daemon ends up opening.

## Then

The `tm_wait({task_id, cursor})` loop above is the whole of your job either way — a size-S task or
a task of runs — there is no manager loop left to read by hand: the daemon `tm_open` spawned is
what a relayed session used to run. Every graph run it opens is still driven by its own spawned
headless session, never by you. The Standing Mandates, Output template, and "Running without
install" note in `../orchestrate/SKILL.md` apply unchanged. One reading note: a draft that claims no files is
`changed_files_verified: null`, attribution `document-unchanged` — the review judges it, not
git. Report it as unattributed, not as verified.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a writing job. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, `plan` picks the flow
- `develop` — same loop, flow pinned to code
