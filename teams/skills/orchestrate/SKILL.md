---
name: orchestrate
description: >-
  Use when running a whole request through the teams-engineering MCP and driving
  its harness nodes without holding the payload yourself. Triggers on: "그래프 돌려줘",
  "노드 단위로 돌려줘", "run it through the MCP", "orchestrate this run". Not for installation.
effort: high
scenarios:
  - "Run this request through the harness flow but keep my context free for the loop"
  - "Dispatch every stage to whichever vendor can actually do it"
  - "요청 전체를 MCP에 던지고 노드 단위로 할당받아서 돌리고 싶어"
  - "결과가 메인에 쌓이지 않게 그래프를 끝까지 돌려줘"
compatibility:
  required:
    - teams-engineering
related:
  - harness
  - install
---

# orchestrate — drive the graph-owned harness flow

Throw the request at the graph engine, then run the loop it hands back. The engine owns the
graph, the spec, the prompts, and the verdicts. You own only the loop. You do not decide
whether this is code work or writing work: `plan` does, from the request, and the graph
expands accordingly. A user who wants to decide that themselves has `teams:develop` and
`teams:document`; this skill is for everyone who does not.

## Running without install

`install` is optional. This skill, `develop`, `document`, `plan`, and `qa` all run through
`tm_open`/`tm_run` against the `teams-engineering`/`task-manager` MCP servers alone; none of
them needs `.claude/team.json` to exist first. The one prerequisite that is not optional: those
two MCP servers must be connected. If any `tm_*`/`team_*` tool is missing, that is a stop —
install or update the `teams@newkayak12-claude-skills` plugin and reload Claude Code. This is a
session-connection problem, not a missing `team.json`, and running `install` will not fix it.

With no `team.json`, a run falls back to `TEAM_DEFAULTS` (`teams/mcp/teamconfig.mjs`; precedence
is built-in defaults < `team.json` < an explicit `tm_open` argument — a missing file is the
normal no-config case, not an error). What matters on a first run:

| Key | Default with no `team.json` | Source |
|---|---|---|
| `roles` | `{planning: true, qa: true}` — both on | `teamconfig.mjs:32` |
| `qa_rounds` | `2` | `teamconfig.mjs:31` |
| `max_parallel_teams` | `2` | `teamconfig.mjs:22` |
| `docs_dir` | `.teams_output/team` | `teamconfig.mjs:53` |

What you don't get without it: no dispatch gate, so an inline write to a path like `src/**` is
never redirected into `tm_open` (`install`'s Dispatch gate section — no file means no gate); no
project-pinned defaults, so every run uses the table above instead of a project's own choices;
no `.claude/conventions/` for plan/setgoal/implement/draft to read against. Run `install` any
time afterward to add these — it never has to precede a run.

## Standing Mandates

- NEVER call `team_status({full: true})` on a run. One node at a time: `detail_path`, or `team_status({full: true, node_id})`.
- ALWAYS read `state`. A judging node can return `stage_ok: true` and still be `failed` — that is the gate working, not an error to route around.
- A blocked run is a result — report what failed and stop there. NEVER do a node's work yourself to force completion, NEVER reopen a run to get past a gate that rejected the work, and NEVER end the report by offering the user a way around it: no raised retry budget, no relaxed acceptance criteria, no override outside the harness. `reset_capacity` is for spent quota, not a retry-budget reset.
- `isolated: true` only when you created or were handed a private worktree holding this run alone. A user asking to keep work off main is a request, not evidence — with no worktree, pass `isolated: false` and say in the report that attribution comes back `null` because of it.
- A `self` node's payload is the fresh agent's returned JSON, relayed verbatim. NEVER author or soften it.
- NEVER pull the goal-spec, handoffs, gap text or evidence into this context — every tool already returns the one-line verdict you report from. This is the rule the design exists for.
- The `report` node writes the run's account, not you. Relay it; NEVER rewrite it, and never substitute your own narration for a report node that ran.
- No Fable/Astra without an explicit user model request. No token, spending, or turn caps beyond the gate retry budget and process timeouts that already exist.

## Entry

One call opens the task AND drives it. There is no sizing step for you to run by hand any more:
the daemon `tm_open` spawns judges `size` itself, the same fresh-agent contract a session used to
relay, and decides from its answer whether this is one graph run or several.

```
tm_open({
  request, cwd, isolated, flow: "auto",
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> task_id, state, docs_dir, view_url
```

That is the whole of your job to start it: size, shape, critique, every package's dispatch and
fold, integrate, the goal gate, the report — or, for a size-S request, the one run it opens —
all happen on their own from here. Prefer `tm_run` over `tm_open` when you do not even want the
`state` field back, only a pointer: same open, same daemon, `{task_id, run_id, docs_dir, view_url}` - open `view_url` in a browser to watch the run.

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

`isolated` is true only when you created or were handed a private worktree holding this run
alone; it travels straight into whichever run the daemon ends up opening — the single run a
size-S task drives, or each package's own dispatch under an L task. When the user has said, in
their own words, that the request must be split — "패키지별로 나눠서", "one worktree per
package", "these are separate deliverables" — pass `size: "L"` and `size` is recorded as pinned,
not measured; "one run, don't split it" pins `size: "S"`. A monorepo with one test script and one
commit measures S on its own: `size` reads build units and ownership boundaries, not package
counts. Do not re-measure: `plan` in the graph run returns `size` too, and if it says L where the
daemon's own `size` judgment said S, that goes in the report as an observation — the run still
proceeds as one graph.

There is no manager loop for you to read or run by hand any more — the daemon `tm_open`/`tm_run`
spawned is what a relayed session used to do, now code instead of a relay. Every graph run it
opens — the manager's own package dispatches, and a size-S task's single run — is still driven by
its own spawned headless session running `references/loop.md`; you never call
`team_next`/`team_run`/`team_submit` yourself, and now you never call `tm_next`/`tm_submit` for a
manager node either. `tm_next`/`tm_submit`/`tm_retry` still exist for the rare case you need to
intervene by hand (a human decision the daemon cannot make), and stay safe to call alongside a
running daemon.

## Output template

```
## <request>

run: <run_id>   state: <complete|blocked>   nodes: <done>/<total>

| node | vendor | stage_ok | note |
|---|---|---|---|
| implement:U1:1 | codex | true | isolated |
| test:U1:1 | codex | true | verified |
| gate:U1:1 | self | true | 95% |

### Not done
<failed, skipped or unreachable nodes, and why — including any that fell back to self. No workaround suggestions.>

### Report
<the report node's handoff, relayed verbatim. Omit this section only when no report node ran.>
```

The table and `### Not done` are yours — run bookkeeping, written from verdicts. `### Report`
is the report node's own text, passed through untouched. A run whose retry budget ran out is
not blocked: the report node runs over the `unreachable` set and its text is `### Report`. When
the run does end blocked, no report node ran: say what failed and stop, and do not write the
missing section yourself.

## Do not pull the payload into your context

This is the rule the design exists for. The goal-spec, subgoal acceptance, upstream
handoffs, prior rejection feedback, changed-file lists and evidence all live in the
graph. Every tool returns a one-line verdict instead: `node_id`, `stage`, `vendor`,
`state`, `stage_ok`, and a short `reason` when it failed.

You do not write node prompts. `team_run` composes them from graph state; passing one
is not possible on purpose.

## Routing

This skill opens with `allocation: "balanced"`. Pass `host_vendor` (`claude` or `codex`),
the actual driving `host_model`, and `native_models` (the models fresh native agents can
select). Omit host identity only when native agents are unavailable. Never claim model
selection support that the host does not expose.

The broker prefers the driving host for plan/setgoal/critique/review/gate and the other
vendor for implement/test/draft/report. `team_next` returns the executor, model, and
routing reason; the assignment persists until completion or interruption.

Everything past the entry lives in `references/`:

| need | read |
|---|---|
| the loop itself: dispatch, retries, progress mirror, verdicts, rules | `references/loop.md` |
| following a task the daemon is driving: worktrees, folds, `tm_retry`, integrate | `tm_status`/`tm_board`/`tm_ticket`/`tm_events` — read-only, safe from any session |
| a live visual of the same task instead of tool replies | `node teams/scripts/view.mjs --task <task_id>` — read-only HTTP page or `--once` text tree |
| legacy `ordered` mode, per-stage `policy`, `native_models`, provenance | `references/routing.md` |
| working directory, snapshot identity, briefing scope | `references/handoffs.md` |
| quota reporting, checkpoints, `reset_capacity` | `references/capacity.md` |

A usage limit is `failure_kind:"quota"`, never an ordinary failure — submit it that way, and
call `team_next` for the alternate route.

## What the current AI does

Sizes, then runs the loop — or the task — and reports from the verdicts. Tools missing or
`tm_open`/`team_open` failing is a stop, not a licence — see "Running without install" above for
the fix (plugin connection, not `team.json`); never the work itself.

## What you do

Nothing during a `team_run` — it blocks. The full history is in
`.teams_output/broker/` (one run) and `~/.harness/tasks/<task_id>/` (a task) if you want it.

## Related skills

- `develop` — the same loop with the flow pinned to code work
- `document` — the same loop with the flow pinned to written artifacts
- `harness` — the six-stage contract this flow implements
- `install` — connect or verify the teams-engineering MCP before running this flow
