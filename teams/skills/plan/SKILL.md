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
`planning` — `investigate → draft → revise → gate` — and the personas setgoal draws from are a PO who owns
value and scope, a domain expert who owns terminology and rules, and an implementation lead
reading for feasibility.

`investigate` runs before a word is written and is the only stage in the chain that reads anything
outside its briefing: the project tree, whatever the request names or attaches, prior documents,
and the domain's public sources where a search tool is actually available. It writes a findings
file and returns two lists that stay separate on purpose — `findings`, each with the source that
says so, and `unknowns`, the decisions no source it reached answers, each with an owner. `draft`
writes from the findings and carries every unknown into the document as an open question; it may
recommend, but answering one from nothing is the failure this stage exists to stop. A short,
honest findings list is a success — the unknowns are half the deliverable.

`revise` is a different identity from `draft` - the broker refuses a revise routed to the vendor
+ model that drafted, the same way it refuses a mismatched `document` review. Unlike `document`'s
`review`, `revise` may edit the artifact: it rewrites for the reader and checks every claim
against its evidence, rather than only judging what draft wrote.

The deliverable is a **set** of planning documents, and the run decides what is in it the way
`shape` decides packages. The PRD is the floor, never the ceiling: when the request has a
vocabulary an engineer would get wrong, rules people will argue about later, or a stated load
condition, those become documents of their own rather than sections compressed into the PRD or
lines in its Out of scope. `setgoal` makes that call; each document is one subgoal with its own
`files[]` path — and `files[]` should also name what that document's investigator ought to open,
not only the path it writes. Every one is a node-written original - the method is the engine's own
`PRD_CONTRACT`, not a plugin template. The PRD's conventional home is
`<docs_dir>/E-<first 8 chars of task_id>/10-prd.md` (`docs_dir` defaults to `.teams_output/team`;
`team.json`'s key of the same name overrides it); name it, and every other document's path, in the
planning subgoals' `files[]` when the goal-spec is authored - there is no automatic placement yet,
only the plain `files[]` mechanism every subgoal already has.

This is the standalone route, where the whole run is the PRD. `.claude/team.json`'s
`roles.planning` switch (see `install`) is a second route to the same `investigate → draft → revise → gate`
work: a planning phase-Team the EPIC flow inserts before `shape` on its own, inside an ordinary
`develop`/`document`/`orchestrate` run, writing that same set with `10-prd.md` at its floor. Use
this skill when the deliverable IS the planning work; turn `roles.planning` on instead when a PRD should precede every EPIC
that also does code or writing work, without a separate run to ask for it.

## Entry

```
tm_open({
  request, cwd, isolated, mixed: true, flow: "plan",
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

`size` measures build units and ownership boundaries the same way it does for `develop` and
`document`. The flow is pinned, so `size` does not choose one - it only measures. `mixed: true`
is deliberate: a PRD that also needs one supporting design note is one run, and the note is a
`document` subgoal inside it. Pass `mixed: false` only when the user said nothing may be
delivered but the PRD itself.

## Then

The `tm_wait({task_id, cursor})` loop above is the whole of your job either way — a size-S task or
a task of runs — there is no manager loop left to read by hand: the daemon `tm_open` spawned is
what a relayed session used to run. Every graph run it opens is still driven by its own spawned
headless session, never by you. The Standing Mandates, Output template, and "Running without
install" note in `../orchestrate/SKILL.md` apply unchanged.

## What the current AI does

Opens with the flow pinned, runs the loop, reports from verdicts.

## What you do

Say it is a planning job. That is the whole difference from `orchestrate`.

## Related skills

- `orchestrate` — same loop, the decomposition stage picks the flow
- `document` — same loop, flow pinned to a general written artifact, not a PRD
- `qa` — same loop, flow pinned to test-case authoring and execution
- `install` — turn on `roles.planning` for the non-standalone route to this same work
