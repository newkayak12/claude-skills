---
name: orchestrate
description: >-
  Use when running a whole request through the graph-engineering MCP and driving
  its harness nodes without holding the payload yourself. Not for installation.
effort: high
scenarios:
  - "Run this request through the harness flow but keep my context free for the loop"
  - "Dispatch every stage to whichever vendor can actually do it"
  - "요청 전체를 MCP에 던지고 노드 단위로 할당받아서 돌리고 싶어"
  - "결과가 메인에 쌓이지 않게 그래프를 끝까지 돌려줘"
compatibility:
  required:
    - graph-engineering
related:
  - harness
  - install
---

# orchestrate — drive the graph-owned harness flow

Throw the request at the graph engine, then run the loop it hands back. The engine owns the
graph, the spec, the prompts, and the verdicts. You own only the loop.

## Standing Mandates

- Open balanced runs with the actual host identity/model and native model capabilities.
- Reasoning prefers the driving AI; Implement/Test prefer the other AI's efficient model.
- Do not select Fable or Astra without an explicit user model request. Do not add token,
  spending, or turn caps. Existing gate retry budgets and process timeouts still apply.
- Every role uses a fresh context. Pass artifact paths and preserve partial work on quota failure.

## The loop

```
graph_open({
  request, cwd, isolated,
  vendor: "auto", allocation: "balanced",
  host_vendor, host_model, native_models
})                                               -> run_id + first ready node
while state == "running":
    graph_next({run_id})                          -> ready[] with routing
    for each ready node:
        vendor node  -> graph_run({run_id, node_id})
        self node    -> assign briefing_path to a fresh native agent, then graph_submit({run_id, node_id, payload})
        quota interruption -> graph_next selects the remaining available vendor
    if state == "blocked":
        a failed subgoal    -> graph_retry({run_id, subgoal_id})
        a failed critique   -> graph_retry({run_id})          # redo the spec
        nothing retryable   -> report and stop
graph_status({run_id})                            -> final counts
```

That is the whole protocol. Six tools, one loop.

**A node can fail with `stage_ok: true`.** On judging nodes that field means "the judging
itself worked"; the verdict is `accept` (gate), `verified` (test), or `sound` (critique).
A node whose verdict is negative is `failed` and holds back everything downstream — that
is the gate doing its job, not an error to route around. Read `state`, not `stage_ok`.

**`graph_retry` without a `subgoal_id` or `node_id` retries the spec.** When critique rejects the
goal-spec, redoing one subgoal fixes nothing: the whole decomposition is in question. That
call reopens `setgoal` and `critique` with the critique's problems as feedback and retires
the subgoal graph the rejected spec produced.

## Do not pull the payload into your context

This is the rule the design exists for. The goal-spec, subgoal acceptance, upstream
handoffs, prior rejection feedback, changed-file lists and evidence all live in the
graph. Every tool returns a one-line verdict instead: `node_id`, `stage`, `vendor`,
`state`, `stage_ok`, and a short `reason` when it failed.

If you accumulate payloads, the loop dies before the work does — a graph with retries
outgrows your context and you can no longer decide the next step. When you genuinely
need a detail, read `detail_path` for that one node, or call
`graph_status({full: true, node_id})` for that one node. Never `full: true` for a run.

You do not write node prompts. `graph_run` composes them from graph state; passing one
is not possible on purpose.

## Routing

This skill opens with `allocation: "balanced"`. Pass `host_vendor` (`claude` or `codex`),
the actual driving `host_model`, and `native_models` (the models fresh native agents can
select). Omit host identity only when native agents are unavailable. Never claim model
selection support that the host does not expose.

The broker prefers the driving host for Plan/SetGoal/Critique/Gate/Report and the other
vendor for Implement/Test. Execution defaults are Claude `sonnet` and Codex
`gpt-5.6-sol`; reasoning on the host inherits `host_model`, except Fable/Astra fall back
to the safe defaults unless the user explicitly requests them through `model` or a
stage policy. Explicit stage policies override automatic selection.

Availability, current assignments, execution errors, and prior completion counts affect
ranking. A negative Gate verdict does not count as a vendor execution error. This is
a deterministic heuristic, not learned cost optimization. `graph_next` returns the
executor, model, and routing reason; the assignment persists until completion or
interruption. Named vendor policies remain strict and never silently switch vendors.

`graph_open` takes `vendor` (the table describes legacy `allocation: "ordered"`, which
remains the default for direct callers that omit allocation):

| value | behavior |
|---|---|
| `"auto"` (default) | **stays on `self`** — the candidate list is empty unless you pass `candidates` |
| `"auto"` + `candidates: [...]` | try those vendors in order, fall back to `self` |
| a vendor name | require it — a node returns `vendor-failure` rather than degrading |
| `"self"` | the host dispatches each node to a fresh native agent |

**Registering a vendor does not enrol it in `auto`.** An installed, ready Codex still goes
unused in a bare `graph_open({vendor: "auto"})` call until you name it (`vendor: "codex"`)
or list it in `candidates`.

The requesting session may be Codex or Claude; its identity does not determine node
ownership. `vendor: "self"` means host-managed execution: dispatch each briefing to a
fresh native agent without inheriting the conversation, then submit its result. The
lead holds only run identifiers, paths, and compact verdicts. Never execute all roles
in the lead's accumulated context. If the host cannot provide fresh role contexts,
use a permitted external executor or report the execution capability as unavailable.

Do not impose equal quotas or assume one vendor is universally better. Fresh context
is required even when the same vendor handles different roles. Verify actual native
executor provenance before submitting; broker executor/model fields record assignment,
not independent proof of which native model the host actually launched.

Use explicit vendor policies or candidates when the task calls for an available
external executor. Do not infer availability from a vendor name or an installed
binary; use the broker's readiness probe. Inside Codex, execute harness stages with
native tools rather than delegating them back into a nested Codex CLI process.
A user-supplied vendor, candidate list, model, or policy overrides the defaults,
subject to the host session's execution constraints.

### Shared artifacts and bounded work

Resolve one absolute project path and run-artifact directory at run start, regardless
of which AI received the request. Give each executor an explicit working directory
and artifact paths. Implement, Test, and Gate for a task must inspect the same code
snapshot. Separate concurrently edited tasks into private worktrees and run an
assembled-goal gate after integration. Record the commit or diff identity with test
evidence so it cannot be applied to a different revision.

For Implement/Test, deliver only the task's acceptance criteria, required source and
dependency paths, deterministic check commands, and relevant prior gate gaps. Do not
forward the full conversation, unrelated tasks, or full logs. A path is not itself a
token saving: the referenced briefing must also be scoped. Keep implementation
handoffs at most 1500 characters; save detailed evidence to files and return paths
with compact verdicts. If the task cannot fit a small briefing, return it for further
decomposition instead of expanding the executor's scope.

Persist each attempt's artifacts separately. Test independently executes checks;
Gate compares evidence with the original acceptance criteria. Retry only unmet work
within the run's retry budget. Do not weaken criteria to pass: a defective goal must
return to SetGoal and Critique with a recorded revision. Record token usage when the
executor exposes it; do not claim a hard token cap without runtime enforcement.

Both Codex and Claude adapters are bundled. In balanced mode `claude` is a real vendor;
the old alias to `self` exists only in legacy ordered mode. When the selected vendor
is the host, native agents execute it. A Codex host never launches nested Codex CLI.
The broker enforces routing and persists recovery artifacts, but native session isolation
and code snapshot attribution remain caller obligations. No token/spending cap is imposed.

### Capacity failure and recovery

For a native executor that hits its provider usage limit, submit
`{stage_ok:false, failure_kind:"quota", ...}` with available handoff/evidence. Never
mark an ordinary implementation failure as quota. External adapter diagnostics are
classified by the broker. The broker preserves a checkpoint, raw result/log paths,
partial working files, and the original goal; it excludes that vendor for the run and
returns a pending, recoverable node. Call `graph_next` to receive the alternate route.

The next fresh session reads the checkpoint and inspects the current files before
continuing. This is artifact-based recovery, not a portable vendor session transcript.
Each external invocation has a unique artifact directory, so retries do not overwrite
earlier output. Reopening the MCP process does not discard the run or checkpoints.

If all permitted vendors are exhausted, report blocked. Once capacity is restored,
`graph_retry({run_id, cwd, node_id, reset_capacity:true})` reopens the interrupted node
and clears capacity exclusions/readiness cache. This cannot reopen completed nodes or
bypass a rejected Gate. Keep `run_id` and `cwd` to resume after restarting the client.

Name the vendor when the run must prove who did the work. Silent degradation is what
lets a graph claim an external vendor implemented something it never touched.

### Per-stage routing

`vendor` and `model` above apply to the whole run. `policy` overrides them per stage —
this is how the harness contract (reasoning on a strong model, execution on whatever can
actually write here) gets expressed:

```js
graph_open({
  request, cwd,
  vendor: "self",                         // current session; retain its model
  policy: {
    implement: { vendor: "codex", model: "gpt-5.6-sol" },
    test:      { vendor: "codex" },
  }
})
```

The example above is optional external routing from a Claude session. Use a named `codex` vendor
for execution when provenance matters: unlike `auto`, it blocks visibly on readiness
failure instead of silently turning an implement or test node back into Claude work.

Keys are stage names — `plan`, `setgoal`, `critique`, `implement`, `test`, `gate`,
`report` — plus the optional `gate:goal`. Each entry may set `vendor`, `candidates`,
`sandbox`, `model`. A stage entry wins over the run-level setting; a stage with no entry
inherits it. `graph_next` reports the chosen `model` per ready node.

For a `self` node, launch a fresh native agent at the returned model. Declare supported
models through `native_models` so unsupported tiers are routed away or visibly blocked.

Readiness is a real write probe, not a version check: a sandbox can start, accept the
run, write nothing, and still exit 0.

## Verdicts

| field | meaning |
|---|---|
| `stage_ok` | adjudicated. Never report a value above what the broker returned. |
| `verified` | test nodes: the checks ran and passed |
| `accept`, `match_pct`, `gap_count` | gate nodes |
| `changed_files_verified` | `true`/`false` under `isolated`; `null` in a shared worktree unless contradicted |
| `contradicted_files` | claimed files the worktree does not show — these fail the node |

`null` verification means "could not attribute": neither a pass nor a failure. Say so
rather than rounding it up.

## Rules

- **Follow `graph_next`.** Both `graph_run` and `graph_submit` refuse a node whose
  dependencies are unmet, are already finished, or do not exist yet. Do not try to
  outrun the graph.
- **`isolated: true` only when true** — a private worktree with only this run in it.
  Assert it falsely and positive attribution becomes meaningless.
- **A blocked run is a result.** When `state` is `blocked` and retries are exhausted,
  report what failed and stop. Do not start doing the nodes yourself to force a finish,
  and do not re-open the run to dodge a gate that rejected the work.
- **Self nodes are still adjudicated.** Read the briefing, do the work, submit honestly;
  the broker cross-checks your claims the same way it checks a vendor's.

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
<failed or skipped nodes, and why — including any that fell back to self>
```

## What the current AI does

Opens the run, follows `graph_next`, dispatches each node, retries rejected subgoals
within budget, and reports from the verdicts.

## What you do

Nothing during a `graph_run` — it blocks. The full history is in
`.harness-run/broker/` if you want it.

## Related skills

- `harness` — the six-stage contract this flow implements
- `install` — connect or verify the graph-engineering MCP before running this flow
