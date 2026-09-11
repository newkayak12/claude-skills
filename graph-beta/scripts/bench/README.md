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
scripts/bench/bench.sh <arm> <case> [label]
GRAPH_BENCH_OUT=... scripts/bench/bench.sh beta code run1     # default $TMPDIR/graph-bench
node scripts/bench/score.mjs <case> <workspace> [stream.jsonl]  # re-score a finished workspace
```

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

## Results

_(filled in from `*.score.json` after each round; see the plugin README's Status for the round's
findings.)_
