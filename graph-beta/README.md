# graph-beta

**English** · [한국어](KOR.md)

The beta line of [`graph`](../graph/README.md). `graph` stays the stable engine and keeps
getting fixes; everything below is being built here first and graduates to `graph` only
when it is proven on real runs.

Same broker, same six tools, same skills — with these differences:

| | `graph` (stable) | `graph-beta` |
|---|---|---|
| MCP server name | `graph-engineering` | `graph-beta-engineering` |
| Run files | `.harness-run/broker/` | `.harness-run/broker-beta/` |
| Skills | `graph:install`, `graph:orchestrate` | `graph-beta:install`, `graph-beta:orchestrate`, `graph-beta:develop`, `graph-beta:document` |
| Version line | 1.x | 0.x until it graduates |

**Do not enable both in the same project.** Both servers expose `graph_*` tools; a driving
session with two of each cannot tell which run it is in.

## Why a beta line

The stable engine is built for one shape of work: a request that becomes subgoals, each of
which **changes files** and is verified by **running commands** against a git worktree. That is
the right shape for code. It is the wrong shape for a design document, a research write-up,
or a request large enough that it should be split into several runs across several
worktrees — and it has no notion of a run that manages other runs.

Three things are being added, in this order, each behind the previous one's tests:

1. **Kinds.** A subgoal declares what kind of work it is, and the kind decides which node
   chain it expands into. `subgoal` (code) keeps `implement → test → gate` exactly as today.
   `document` gets `draft → review → gate`: author ≠ reviewer, rubric-based, a missing
   worktree change is not a failure. A spec may mix kinds — "implement the feature and
   update the design doc" is one run.
2. **Entry per flow.** `graph-beta:orchestrate` stays the no-decision entry: `plan` sizes the
   request and picks the flow. `graph-beta:develop` and `graph-beta:document` are thin
   manual entries — trigger words, a `flow` default, a persona set — that hand off to the
   same loop. Nothing in the loop is duplicated.
3. **TaskManager.** A second MCP server in this plugin, `task-manager`, for medium and large
   requests. It sizes, splits into packages with `touches[]` and dependencies, and for each
   package opens a child graph run in its own worktree — **the broker opens it, never a
   node** — then accepts the child's verdict, integrates worktrees, and reports. It reuses
   `mcp/graph.mjs` as a library (DAG, typed edges, retries, settled failure) and reads child
   run files without ever writing them. Small requests skip it entirely.

Design and step list: [`docs/plans/2026-09-11-graph-beta-taskmanager.md`](../docs/plans/2026-09-11-graph-beta-taskmanager.md).

## Status

- **v0.3.0 — flows and entry skills**: `graph_open({flow, mixed})`. `flow: "auto"` (the
  `graph-beta:orchestrate` default) leaves the choice to `plan`, whose contract now returns
  `flow` (develop | document), `size` (S | L) and the commands it measured with; a plan that
  says nothing falls to develop and the run records `flow_source: "default"` rather than
  passing it off as a decision. `graph-beta:develop` and `graph-beta:document` are thin manual
  entries — trigger words, the pinned `flow`, a persona set — that hand off to the one loop,
  now in `orchestrate/references/loop.md`. The flow supplies the kind a subgoal did not name;
  `mixed: false` makes the other kinds a spec defect at setgoal. `graph_next`/`graph_status`
  report `flow` and `size`. Three new cases; 98 pass. `size: L` is recorded, not yet acted on.
- **v0.2.0 — `document` kind**: a subgoal may declare `kind: "document"` and expands to
  `draft → review → gate` instead of implement/test/gate; kinds mix in one spec. `draft`
  writes the artifact and is cross-checked like implement, except that an empty file claim
  is `changed_files_verified: null` (`document-unchanged`), never a contradiction — a note
  delivered in the handoff is judged by its reviewer, not by git. `review` is a reasoning
  node: read-only sandbox, one entry per acceptance item quoting the passage or naming what
  is missing, verdict `verified`. Author ≠ reviewer is enforced where the broker can see
  identity: a review routed to the vendor+model that drafted is refused and left pending
  (`reviewer_independence: distinct-identity | unverifiable-self` on the verdict). Balanced
  allocation gets this for free — draft goes to the peer, review stays on the host. A retry
  after a failed review or test now carries that node's checks as feedback, not only a
  gate's gaps. Five new cases; 95 pass.

- **v0.1.0 — fork + kind table**: copied from graph 1.7.0 (typed edges, settled failure).
  `expandSubgoals` and `retrySubgoal` now build a subgoal's node chain from a `KINDS` table
  instead of hard-coded implement/test/gate; `subgoal.kind` is validated against it. One kind
  so far — `subgoal` — and the 89-case regression suite passes unchanged, which is the point
  of this step: the seam exists and behaviour has not moved. One new case: an unknown `kind`
  fails at setgoal like any other spec defect.

## Install

Install `graph-beta@newkayak12-claude-skills` and run `graph-beta:install` to verify the six
`graph_*` tools are present. For a source checkout, register `mcp/broker.mjs` under the name
`graph-beta-engineering` in the project's `.mcp.json`; `graph-beta:install` shows the entry.

## Everything else

Tools, routing, adjudication, vendors, capacity recovery and the ledger are unchanged from
stable — read [`graph/README.md`](../graph/README.md). Stable fixes are forward-ported here;
beta work is not back-ported until it graduates.
