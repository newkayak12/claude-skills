# Bench — graph-beta against stable graph and no plugin

Two requests that are large enough to need several worktrees, run through three arms, scored
by what the arm left in the tree and what the session cost.

| Arm | What runs | Skill |
|-----|-----------|-------|
| `beta` | graph-beta 0.x: `task-manager` sizes and shapes, one child graph run per package, integrate | `graph-beta:develop` (code), `graph-beta:orchestrate` with `flow: auto` (docs) |
| `stable` | graph 1.x: one graph run for the whole request | `graph:orchestrate` |
| `none` | plain `claude -p` on the same request, no plugin | — |

| Case | Fixture | Request | Sizes |
|------|---------|---------|-------|
| `code` | `fixtures/ledger-mono` — 4 workspace packages (csv, rules, report, cli), stubs and smoke tests | implement the expense tracker across the packages, tests per package, root README | L |
| `docs` | `fixtures/tinyq-mono` — 3 workspace packages with real code and tests, no docs | 3 package READMEs, `docs/architecture.md`, 3 ADRs, `CONTRIBUTING.md`, root README, all reviewed against the code | L |
| `code-flat` | `fixtures/ledger` — one empty package | the same work as four files under `src/` | S |
| `docs-flat` | `fixtures/tinyq` — one flat library | the same documents with one `docs/api.md` | S |

The `-flat` cases exist because `size` decides from what commands show — file and module
counts, ownership boundaries, build units — and an empty single-package repository has none:
the first e2e round sized both flat requests S and delegated to one graph run. They measure the
delegate path; the monorepo cases measure the manager.

## Run

```
scripts/bench/bench.sh <arm> <case> [label]                     # one fresh run, scored at the end
scripts/bench/resume.sh <workspace> [n]                         # continue an interrupted one in a new session
scripts/bench/drive.sh "beta code run1" "stable docs run1" ...  # jobs in sequence, resuming across usage-limit resets
GRAPH_BENCH_OUT=... (default $TMPDIR/graph-bench)
node scripts/bench/score.mjs <case> <workspace> [a.jsonl,b.jsonl]  # re-score; streams add up
```

A headless session on a plan with a usage limit dies mid-run — three rounds of this bench did,
at roughly $20–25 per five-hour window across every concurrent session. Nothing is lost: the
task under `.harness-tasks`, every child run file, every worktree are on disk, and `resume.sh`
opens a new session that continues them (`tm_status`/`tm_next` for a task, `graph_status({cwd})`
for a bare run) instead of opening again. `drive.sh` parses the reset time out of the limit
message, sleeps past it, resumes, and moves to the next job when a session ends for any other
reason. The scorer sums duration, cost and turns over every session that drove a workspace and
counts the limit hits (`sessions`, `limit_hit`).

Workspaces go outside the plugin tree (Claude Code denies Write/Edit under a loaded
`--plugin-dir`). Arms are isolated with `--setting-sources project` (hides installed plugins)
plus `--plugin-dir` for the arm under test. Task state goes to `<ws>/.harness-tasks`
(`HARNESS_TASKS_DIR`), so a workspace holds everything the run produced. `env -u CLAUDECODE` and
`< /dev/null` are what let a nested `claude -p` start. There is no `timeout` on macOS; a run
ends when the session does.

## Score

Judged tree: the integration worktree (`<ws>/.harness-tasks/*/worktrees/integration*`) when the
arm produced a task, else the workspace. Criteria are booleans; the row shows `passed/of`.

`code`: `npm_test` (`node --test` at the root passes) · `no_deps` · `modules` (the three package
entry points and `packages/cli/bin/ledger.mjs` exist) · `exports` (each library package exports
something) · `tests` (every package has more than the seed's one smoke test) · `readme` (`ledger
report`, rules, a fenced example) · executed: `cli_ok` (sample CSV with and without a header row,
output names the category) · `cli_invalid` (bad amount → exit 1) · `cli_month` (`--month` filters).

`docs`: `npm_test` · `no_deps` · `files` (all nine documents) · `api_exports` (every export of a
package is named in its README) · `api_examples` (a fenced example per reference) · `adr_shape`
(context, decision, consequences, alternatives in each ADR) · `readme_links` · `src_untouched`
(no diff against the seed under `packages/*/src` and `packages/*/test`) · `accuracy` — the one
LLM-judged criterion: haiku reads the three sources and `packages/retry/README.md`,
`packages/worker/README.md`, `docs/adr/0002-retry-policy.md`, and lists claims the code does not
support; passes when the list is empty (`GRAPH_BENCH_JUDGE=0` skips it).

Session meta comes from the top-level `stream-json` only: duration, cost, turns, tool-call
counts per MCP tool, top-level Write/Edit calls (a manager doing node work), sub-agent count,
whether the final text carries the `### Report` section and a node table. Harness state comes
from `task.json` and every child run file: size verdict, packages, node states per vendor,
failed nodes with reasons, conflicts.

## Results — round 1, 2026-09-11 → 12

One run per cell. Wall time is the runner's own stamps (a session's `duration_ms` does not cover
its sub-agents); cost is the session's reported `total_cost_usd`, summed over every session that
drove the workspace. `sessions > 1` means a usage limit killed the first one and `resume.sh`
continued it. Judged tree: the integration worktree for the manager, the workspace otherwise.

| arm | case | score | wall | cost | sessions | fresh agents | what happened |
|---|---|---|---|---|---|---|---|
| none | code | 9/9 | 8 min | $2.17 | 1 | 0 | 26 Bash calls, uncommitted working tree |
| none | docs | 9/9 | 14 min | $3.97 | 1 | 0 | judge: 0 false claims / 82 checked |
| stable 1.7.0 | code | 9/9 | 48 min | $13.27 | 1 | 20 | one graph run, 20 nodes; first `graph_open` blocked on the host-model variant (Step 8), reopened |
| stable 1.7.0 | docs | 9/9 | 61 min | $18.10 | 2 | 32 | `test:U3` and `gate:U5` failed → two `graph_retry`; docs ran as implement/test (no `document` kind); judge parsed 0 claims |
| beta 0.6.2, size pinned L | code | 9/9 | 173 min | $72.97 | 2 | 67 | 4 packages (csv, rules, report←csv,rules, cli←all); P1 child critique caught a contradictory check → spec retry; fold → integrate → `gate:goal` → report, all `self`; judge n/a |
| beta 0.6.2, size pinned L | docs | 9/9 (tree) · task **blocked** | 104 min | $48.63 | 2 | 69 | 4 document packages, every `review` `verified` with `distinct-identity`; `integrate` ran the README examples and failed P2's (bare `@tinyq/retry` needs `npm install`) → `tm_retry(P2)` fixed it (gate 95%) → **integrate never reopened** (engine gap, fixed after); judge: 0 false / 58 |
| beta, size measured (S → one run) | code · docs | interrupted | 45 min | $12–13 each | — | — | the delegate path; killed by the usage limit mid-subgoals, not resumed (superseded by the L runs) |

Read across a row pair: the manager delivered the same 9/9 as the plain session at roughly 34×
the cost and 21× the time on `code`, 12× and 7× on `docs`; stable's single run sat at 6× / 6× and
5× / 4×. The request was S by the harness's own `size` measurement — the manager was forced on by
the pin — so this round measures the manager's overhead, not its value; its value needs a request
that measures L on its own (plan doc, Graduation).

Where the manager's money went (`code`, from per-message usage; proportions): the driving
session itself ~55% (context grew to 507k tokens over 331 turns and every turn re-read it), the
38 opus judging agents ~40%, the 15 sonnet execution agents ~3%. See plan doc Step 7.

What only the harness arms produced: per-package gates with percentages, a critique that
rejected a spec with an unsatisfiable check, a gate and an integrate that executed README examples
and diffed the output, reviews by a different identity than the author, commits on package
branches and an integration branch. The plain session left an uncommitted working tree.

Engine defects this round found, none visible to the unit suite: host-model variant refused
(0.6.1); tier default vs declared ids → `vendor-failure` with zero failed nodes (0.6.2); fold
`git add` with `':!.harness-run'` exits 1 when the project ignores it (0.6.3); `tm_retry` with a
package id not in the shape created a phantom package (0.6.3); a failed `integrate` was never
reopened after the package it blamed was retried (0.6.3). Stable shares the first.

Fixture note: the `size` agents were right that these monorepos are one build unit; the
`code-flat`/`docs-flat` cases and the unpinned beta runs measure the delegate path.
