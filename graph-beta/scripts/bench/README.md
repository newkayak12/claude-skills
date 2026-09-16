# Bench — graph-beta against stable graph and no plugin

Two requests that are large enough to need several worktrees, run through three arms, scored
by what the arm left in the tree and what the session cost.

| Arm | What runs | Skill |
|-----|-----------|-------|
| `beta` | graph-beta 0.x with the user's words that the work must be split → `size` pinned L: `task-manager` shapes packages, one child graph run per package, integrate | `graph-beta:develop` (code), `graph-beta:orchestrate` with `flow: auto` (docs) |
| `betas` | graph-beta 0.x without those words: `size` measures (S on these fixtures) and delegates to one graph run — the same topology as `stable`, with the `document` kind and `flow` | same |
| `skills` | `betas`, with `--plugin-dir` for every plugin any `STAGE_SKILLS` (taskmanager.mjs) or `kindSkills` (graph.mjs) entry actually names — `develop`, `think`, `cognition`, `completion`, `write` — plus `agents`, mounted only when the directory exists | same as `betas` |
| `stable` | graph 1.x: one graph run for the whole request | `graph:orchestrate` |
| `none` | plain `claude -p` on the same request, no plugin | — |

Without the `skills` arm's extra `--plugin-dir`s, every `Skill()` call the mounted-skills tables
name misses and falls back silently — round 3's `skills_used: ["none"]` on every manager stage
(see "three sets on 0.7.3" below) was this, not a defect: `beta`/`betas`/`stable` never mount
anything but the arm's own plugin, so `develop:*`, `think:*`, `cognition:*`, `completion:*` and
`write:*` are genuinely not installed in those workspaces. `skills` exists to measure whether
mounting them changes the outcome; it does not change the engine, only what the engine can find.

| Case | Fixture | Request | Sizes |
|------|---------|---------|-------|
| `code` | `fixtures/ledger-mono` — 4 workspace packages (csv, rules, report, cli), stubs and smoke tests | implement the expense tracker across the packages, tests per package, root README | L |
| `docs` | `fixtures/tinyq-mono` — 3 workspace packages with real code and tests, no docs | 3 package READMEs, `docs/architecture.md`, 3 ADRs, `CONTRIBUTING.md`, root README, all reviewed against the code | L |
| `code-flat` | `fixtures/ledger` — one empty package | the same work as four files under `src/` | S |
| `docs-flat` | `fixtures/tinyq` — one flat library | the same documents with one `docs/api.md` | S |
| `goal-code` | `fixtures/ledger-mono` | **one line**: import bank CSVs, categorize by rules, report monthly from the CLI; the split, contracts, CLI shape and tests are the harness's to decide | — |
| `goal-docs` | `fixtures/tinyq-mono` | **one line**: document it so a new maintainer can use, extend and understand it; the document set is the harness's to decide | — |
| `seam` | `fixtures/seam-mono` — 3 workspace packages (`codes`, `parser`, `cli`); `codes` is pre-built and fixed, `parser`/`cli` are stubs | parser and CLI must both agree with `codes`' exit-code table, the README must document it, and the CLI must run identically as given, as its realpath, and through a symlink | L |
| `seam-flat` | `fixtures/seam` — one empty package | the same domain (`codes.mjs`, `parser.mjs`, `bin/lintcfg.mjs`) built by one worker, no split | S |

The `goal-*` cases exist because the `code`/`docs` requests already do the decomposition — four
packages, module contracts, a CLI signature — so a manager whose value is the planning layer
had nothing left to plan. A one-line goal is where shape, critique and integrate earn or lose
their cost; the scorer judges the outcome against the goal and the decomposition on its own
terms (several packages, disjoint ownership, no cycles).

The `-flat` cases exist because `size` decides from what commands show — file and module
counts, ownership boundaries, build units — and an empty single-package repository has none:
the first e2e round sized both flat requests S and delegated to one graph run. They measure the
delegate path; the monorepo cases measure the manager.

The `seam` case exists because none of the cases above discriminate the harness from a plain
session: both score 8-9/9 on `code`/`docs` (see "Results — three sets on 0.7.3" below), because
every criterion there is checkable from inside one package or one document. `seam` splits the
request across three packages that each pass their own tests in isolation and only agree when
a cross-cutting constraint — an error-code table defined once, in `packages/codes` — is honoured
by both `packages/parser` (which names failures) and `packages/cli` (which turns a name back
into a process exit code). The fixture also reproduces the 0.8.1 defect on purpose: bench
workspaces already live under `$TMPDIR`, itself a `/var` path that resolves through
`/private/var` on macOS, so the workspace path as given and its `realpath` are already the two
spellings that broke a naive `import.meta.url === pathToFileURL(argv[1]).href` main-module
guard. See "How to read a seam result" under Score.

## Run

```
scripts/bench/bench.sh <arm> <case> [label]                     # one fresh run, scored at the end
scripts/bench/resume.sh <workspace> [n]                         # continue an interrupted one in a new session
scripts/bench/drive.sh "beta code run1" "stable docs run1" ...  # jobs in sequence, resuming across usage-limit resets
GRAPH_BENCH_OUT=... (default $TMPDIR/graph-bench)
node scripts/bench/score.mjs <case> <workspace> [a.jsonl,b.jsonl]  # re-score; streams add up
```

`<arm>` is `beta | betas | skills | stable | none`; `<case>` is `code | docs | code-flat |
docs-flat | goal-code | goal-docs | seam | seam-flat`.

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

`seam`/`seam-flat`: `no_deps` · `npm_test` · `modules` (`codes`/`parser`/`cli` entry points exist)
· `exports` · `tests` (parser and cli have grown past the seed's smoke test) · `cli_ok` (valid
config → exit 0) · `cli_invalid` (a missing file → non-zero, not a silent exit 0) — all ordinary.
Five are **SEAM** — they fail when either half was built without regard for the other, even
though `cli_ok`/`cli_invalid`/`npm_test` above can still pass:

- `readme_exit_codes` — every `KEY: number` pair actually in `packages/codes`' source must also
  appear in `README.md`, read from the tree at run time rather than assumed, so a legitimate
  future change to the table cannot make this scorer wrong the way a hardcoded answer key would.
- `parser_names_match_codes` — every failure-code name `packages/parser`'s source actually
  returns must be a key `packages/codes` actually defines — catches a naming drift between the
  two packages that neither package's own tests would ever see.
- `cli_uses_codes_table` — for every failure kind (`MISSING_FIELD`, `BAD_TYPE`, `UNKNOWN_FIELD`,
  `PARSE_ERROR`), the CLI's actual exit code, from running it, must equal `packages/codes`'
  actual numeric value for that name. A CLI that kept its own copy of the table — right or
  wrong — fails this the moment its copy and `packages/codes` disagree, even though the CLI's
  own unit tests (written against its own copy) never noticed.
- `cli_abs_path` / `cli_realpath` — the 0.8.1 defect, reproduced directly rather than simulated:
  the CLI is run once with the workspace path as given and once with its `realpath`; both must
  exit 0 and print the same line. A naive `import.meta.url === pathToFileURL(argv[1]).href`
  main-module guard makes the process exit 0 with **no output** under exactly one of the two
  spellings — a silent no-op that `cli_abs_path`/`cli_realpath` catch and `npm_test` would not,
  since `node --test` never invokes the binary through either spelling.

### How to read a seam result

A plain session (`none`) is expected to pass `cli_ok`/`cli_invalid`/`npm_test` — there is only
one worker, so there is no seam to miss — and to score however it scores on the SEAM criteria
by chance, not by design: nothing tells it a shared table exists to disagree with. The harness
arms' claim is narrower and checkable: a gate, critique or integrate node catches the seam
*before* the scorer does, because it is the harness's job to read across package boundaries
that no single package's own worker or tests can see (see "What `goal-docs` found, by failing"
and "What `code-flat` found, by failing" below for two prior instances of exactly this gap). The
`judge` fields below (`seam_detected`, `gate_rejections`, `judges_with_checks`) are what let a
reader tell "the harness caught it and fixed it" apart from "the harness got lucky" apart from
"nothing caught it and the scorer's SEAM criteria are the only thing that did."

### Judge fields

Printed alongside the `passed/of` row, never folded into it — they describe the harness's own
judging behaviour on this run, not what the tree contains, and are written to `score.json` under
`judge` plus one `JUDGE: {...}` line for machine parsing:

- `seam_detected` — did any `gate`/`critique`/`report` node's own words (`checks`, `attacks`,
  `gaps`, `problems`, `reason`, `handoff`), or — for a `none` session with no harness nodes at
  all — the driving session's own prose, mention the cross-cutting constraint this case's
  criteria check (a small per-case keyword list; `'n/a'` for a case with none defined).
- `gate_rejections` — count of `gate`/`accept`/etc. nodes whose result carried `accept: false`
  or `stage_ok: false` anywhere in the run.
- `judges_with_checks` `N/M` — of every `gate`/`accept`/`critique`/`review` node, how many logged
  a non-empty `checks[]` or `attacks[]` — 0.8.0's rule is that `accept: true` with an empty
  `checks[]` is refused by the engine, so this is how often a judgement actually had evidence
  behind it versus how often it merely could have.
- `repairs` — count of nodes on an explicit `repair` stage/id, plus packages opened under a
  `R<n>` repackage generation — the two shapes a seam fix can currently take. `tm_retry` alone
  resends work to a worktree that cannot see the seam it needs to fix (see "What `goal-docs`
  found, by failing"); a repair or repackage is what actually addresses one.
- `cost_usd`, `turns`, `minutes` — the same session totals already in the row, repeated here so
  a `JUDGE:` line alone is enough to compare runs without re-parsing the human-readable row.

Session meta comes from the top-level `stream-json` only: duration, cost, turns, tool-call
counts per MCP tool, top-level Write/Edit calls (a manager doing node work), sub-agent count,
whether the final text carries the `### Report` section and a node table. Harness state comes
from `task.json` and every child run file: size verdict, packages, node states per vendor,
failed nodes with reasons, conflicts.

### Claims

The criteria above check what the arm left behind; `claims` checks what it *said* — the same
standard for every arm, the plain `none` session included, since that is the one thing the
fixture criteria never look at. A claim is any checkable assertion the arm made: a harness node's
`changed_files`, a `checks` entry (`"<cmd> -> <shown>"`), a `verified: true` or `accept:
true`/`match_pct` flag, a `handoff` sentence naming a test count (only from `implement`/`draft`/
`report` nodes — `plan`/`setgoal`/`critique` narrate process context, e.g. "package P3 is already
green at 41/0", a snapshot of one worktree mid-task, not a claim about the tree being scored), a
`contradicted_files` entry (already flagged false by the harness itself); for `none`, the same
things said in prose in the stream's assistant text and final result — a test count or "all tests
pass", a file named as created/updated, a descriptive "the README documents X". Each becomes one
of `verified`, `false`, or `unverifiable`, printed as `false <false>/<total>` in the row (after
cost) and listed in full under `claims.items` in the score JSON.

Verification: a changed/created file claim is `existsSync` on the judged tree, plus (harness arms
only) `git log --name-only` — a plain session is never credited with a commit it didn't make, so
its file claims are existence-only. A test-count or "all pass" claim is checked against one
whole-tree `node --test` run (the same run `npm_test` already does, reused rather than repeated).
A `checks` entry is only re-run when its command is on a narrow, safe allowlist (`node --test`,
`node bin/*.mjs`, `npm test`, `cat`/`ls`/`grep '...'`/`wc`/`head` — `grep` only when it is actually
grep syntax, flags then a quoted pattern, not prose that happens to start with the word "grep");
its exit code (or, for a bare count like `grep -c … -> 0`, its literal output) is compared against
what the shown text implies. A `verified: true` / `accept: true` flag is judged by its own node's
`checks`: false if any of them came back false, verified if they didn't and there were some to
check, otherwise `unverifiable`. README shell examples (fences starting `node bin/` or `ledger `)
are run against the tree for every arm alike, after materializing any "Save this as `<file>`"
sample the README shows inline; a non-zero exit is a false "README example runs" claim,
attributed to whoever last touched `README.md` (a `draft`/`implement` node, or `session`).

`unverifiable` is not `false`: most `checks` entries are free-text descriptions of manual
inspection ("namespace export check -> [...]"), not commands — there is no cheap, safe way to
re-run those, so they are left uncounted rather than guessed at. Same for a `gate:*` node's
`accept`/`match_pct` when it logged no checks of its own, and for a `none` session's descriptive
README mentions (checking those would need the same LLM read the docs cases already spend on
`accuracy`, and this does not add a second one). Anything that lands in `unverifiable` is a claim
this scorer chose not to adjudicate, not one it cleared.

A `code-flat betas` live run on 2026-09-16 turned up nine scorer misreads (all `false`, none of
them a real defect in the tree) that are now fixed in `verifyCheckClaim` and the README-example
block, unit-tested in `test-score.mjs` against the pure helpers in `lib/claims.mjs`:

- `impliesFailure` now reads filesystem-not-found phrasing ("No such file or directory", "not
  found", "ENOENT", "cannot access", "does not exist") as implying a non-zero exit, the same way
  it already read "fail"/"error".
- A check whose command is several ` / `-joined paths in prose ("`node --test a.mjs / b.mjs /
  c.mjs -> each exited 0 individually`") is split and each command verified against the same
  claim, rather than run once as one bogus command; a slash that is not between bare path-like
  tokens still reads as prose and stays `unverifiable`.
- A content-showing command (`cat`, `sed -n`, `head`, `tail`, `grep` without `-c`) is no longer
  judged by the fail/error-word heuristic at all — the shown text describes the file's content
  ("...fail-fast throw on first bad row"), not an outcome, so a successful rerun is
  `unverifiable` ("shown text describes content, not an outcome") and only a rerun that cannot
  read the file at all is `false`.
- README shell examples now run `hasPlaceholder` before executing, same as `checks[]` entries
  (an example like `` ledger report <csv> --rules <json> `` is `unverifiable`, not run as a
  literal shell command with `<` read as redirection), map a bare `ledger ...` example to the
  tree's actual `bin` entry from `package.json` before running it, and materialize any file-like
  argument a command names but the README never says to "Save this as" — the first fenced block
  whose language tag matches the argument's extension (`.csv` → ` ```csv `, `.json` → ` ```json
  `) — before running, removing it afterward; a command naming an input with no matching fenced
  block anywhere is `unverifiable` ("README example names an input it never shows"), not run.
- `verified_flag`/`gate_accept` claims on the same node as a fixed check flip to `verified` (or
  `unverifiable`, if the node logged no checks at all) on their own — they were never wrong
  themselves, only downstream of a `checks[]` entry that was.

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

Two topologies are in this table and they must not be read as one. `none` and `stable` are one
session or one graph run; `beta` (pinned L) is **four child graph runs plus a manager**. Its 34× /
12× over the plain session is mostly four runs' worth of harness (stable's single run is 6× / 5×
on its own); the manager's own share is the remainder — roughly $73 − 4 × $13 ≈ $20 on `code`,
of which most is the driving session's context (below). The like-for-like engine comparison is
`stable` against `betas` (one run each, same fixtures); `betas` is round 2. And the request was
S by the harness's own `size` measurement — the manager was forced on by the pin — so this round
measures the manager's overhead, not its value; its value is what the `goal-*` cases and a request
that measures L on its own are for (plan doc, Graduation).

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

## Results — round 2, 2026-09-14 (in progress)

Same-topology and one-line-goal runs. Rows land here as the sequential driver finishes them.

| arm | case | score | wall | cost | sessions | fresh agents | what happened |
|---|---|---|---|---|---|---|---|
| betas (unpinned, one run) | code | 8/9 | 50 min | $13.20 | 1 | 21 | `size` measured S, delegated; the run used `implement/test` for code and `draft/review` for the README (mixed); failed only the README phrasing criterion. Same topology and same cost as `stable` (9/9 · 48 min · $13.27): the engine's overhead is the engine's, not the beta's |
| betas (unpinned, one run) | docs | 9/9 | 68 min | $21.79 | 2 | 31 | `size` measured S, `flow` chose `document`: 9 `draft` · 9 `review` · 10 `gate` and not one `implement` — round 1's stable ran the same request as implement/test because it has no `document` kind. Three review rejections retried and passed. Against stable's 9/9 · 61 min · $18.10: the same score for 20% more, and the 20% buys author≠reviewer on every document |
| none | goal-code | 6/6 | 29 min | $11.92 | 1 | 0 | the plain session met the one-line goal on its own — at 5.5× what it cost with the four-package spec written for it ($2.17): the planning moved inside the session |
| beta (pinned L) | goal-code | **7/7 · delivered** | 130 min | $44.74 | 3 | 65 | shape split the one-line goal into `csv` / `rules` / `report` / `cli`+README+examples, disjoint touches, only `cli` depends (on all three) — the same split a person wrote for the `code` case. Critique returned 11 problems, one of which caught a stale sentence in the shape contract (dependents "branch from HEAD" — they branch from their dependency's branch since 0.6.0); fixed. 4 packages, 4 child runs, integrate → `gate:goal` → report all passed |
| beta (pinned L) | goal-docs | 8/8 tree · **settled-failure** | 135 min | $53.38 | 3 | 57+ | `integrate` twice refused the combined tree over a seam no package could see, and the package could not be repaired in isolation — below |

Both same-topology pairs are now in: `stable` against `betas` is 9/9 · $13.27 against 8/9 ·
$13.20 on `code` and 9/9 · $18.10 against 9/9 · $21.79 on `docs`. The engine's cost is the
engine's — the beta adds no overhead at the same topology, and on `docs` the 20% it does add is
the `document` flow doing review work stable cannot express. Round 1's 34×/12× figures belong to
the manager topology (four child runs plus a manager), not to the beta.

### What `goal-docs` found, by failing

`packages/retry/README.md:3` said "the repo has no other docs, so everything a maintainer needs
to know about @tinyq/retry is written here." On branch `harness/…/P2` that was **true** — `git
ls-tree` shows it was the only `.md` in that tree. In the combined tree it is false: seven `.md`
files, several of them documenting retry behaviour, and the same file's own "See also" section
links to them. `integrate:1` caught it, `integrate:2` caught it again after a retry, the child
run for P2 then went blocked on its own gate, the manager's retry budget ran out, and
`gate:goal`, `accept:P2:3` and `integrate:3` became `unreachable` — the settle path, working as
designed, releasing a partial report.

The finding is the design gap, not the defect: **a seam defect cannot be repaired by retrying
the package in isolation.** `tm_retry({package_id})` sends the work back to a worktree where the
offending sentence is correct, so the author receives feedback that is unsatisfiable where they
stand and spends the budget failing. The repair path has to be `repackage`, or integrate
feedback that tells the package what the combined tree looks like. Neither exists yet.

The scorer gave that same tree **8/8**, `accuracy` judge included. The harness read the seams and
the bench's own scoring did not: a score is now printed alongside the harness's verdict
(`delivered` / `settled-failure` / `incomplete` / `not-delivered`) precisely so a rejected tree
can never again be reported as a pass.

## Results — cross-vendor, 2026-09-16

The first run in which any node executed on a vendor other than the one driving. Codex
logged in on the bench machine; `betas` arm, so one graph run and no manager.

| arm | case | score | wall | cost | nodes | what happened |
|---|---|---|---|---|---|---|
| betas + codex | code-flat | 8/9 (`readme`) | 44 min | $11.88 | 23, all done | 7 execution nodes on codex, 16 on Claude |

```
codex  (7)  draft:U1  implement:U2 test:U2  implement:U3 test:U3  implement:U4 test:U4
claude (16) plan setgoal critique | review:U1 gate:U1..U6 gate:goal report
            + implement:U5 test:U5 draft:U6 review:U6   (after codex ran out)
```

Until Codex's capacity ran out the split held without exception: every `draft`, `implement`
and `test` went to the peer, every `critique`, `review` and `gate` stayed on the host. Nobody
arranged that — `CROSS_VENDOR_STAGES` sends execution to the peer and judging stays where the
run is driven, so **author and reviewer were different vendors on U1–U4 as a side effect of the
routing**. Codex returned a valid stage contract 7 times out of 7.

When capacity ran out the run did not stop: the vendor was recorded in
`unavailable_vendors`, the node's `attempts` kept the reason, ranking still named codex as
preferred, and the work fell back to Claude. The reason survives in the run file, so a reader
can tell later why a node ran where it did.

Cost did not rise: $11.88 / 44 min here against $13.20 / 50 min for `betas code` all on Claude
(different fixtures, so this is a first signal and not a measurement).

`changed_files_verified` came back `null` on all 7 codex nodes, with `contradicted_files` empty
— no false claim, but no positive attribution either. That is the shared-worktree path and not
a gap: `crossCheck` only asserts attribution when one node had the tree to itself. The manager
creates every child run with `isolated: true` and hands out one mutating node at a time, and
across the manager-path runs already on disk the tally is **49 nodes, every one
`('isolated', true)`**. What is still unmeasured is narrow: an `isolated` node whose executor is
codex. The mechanism is a `git status` comparison and vendor-independent, but there is no data.

## Cross-vendor before 2026-09-16 — not measured Codex is installed on the bench
machine but not logged in, so every `vendor: auto` route reported `codex unreachable` and every
node ran on Claude — the harness's first stated purpose, dispatching to whichever vendor can do
the work regardless of which one is driving, has no data yet. That round needs `codex login` on
the machine and adds to the scorer: nodes per vendor, `changed_files_verified` on cross-vendor
implement/test, and how many review/gate identities differed from their author's by vendor
rather than by model tier.

## Results — three sets on 0.7.3, 2026-09-16

Three runs in parallel, one per path, to check that everything landed between 0.6.9 and 0.7.3
actually shows up in a live run. Codex was logged in; the session limit was expected and the
driver was allowed to fall back to the host.

| arm | case | score | wall | cost | turns | ended |
|---|---|---|---|---|---|---|
| betas + codex | code-flat | 8/9 (`readme`) | 44 min | $11.88 | 72 | complete |
| betas + codex | docs-flat | 9/9 | 63 min | $21.79 | 92 | complete |
| beta + codex | code-flat | 6/9 (`cli_ok`, `cli_invalid`, `cli_month`) | 143 min | $42.50 | 201 | **session limit at `integrate`** |

The manager run is the interesting one, and it did not fail — it ran out of quota. `size` measured
**L** on its own and shaped **4 packages**; all four were dispatched, judged and accepted:

```
dispatch:P1:1 done accept=true match=95   accept:P1:1 done 95
dispatch:P2:1 done accept=true match=95   accept:P2:1 done 95
dispatch:P3:1 FAILED accept=false match=93 -> accept:P3:1 skipped
dispatch:P3:2 done accept=true match=94   accept:P3:2 done 93
dispatch:P4:1 done accept=true match=92   accept:P4:1 done 90
integrate:1 / gate:goal:1 / report        pending — driver gave up at resume 6
```

Three things this round settled.

**The rejected-package retry works outside the unit tests.** P3 came back `accept: false`, the
manager marked `accept:P3:1` skipped, opened `dispatch:P3:2` against a *fresh child run* in the
same worktree, and that one was accepted. Five child runs on four packages, and the retry is the
difference. This is `tm_retry` doing in the live loop what `autoReassign` does inside a graph.

**The last empty attribution cell is filled.** Across the five child runs the tally is
**claude 32 / codex 22**, and of those, **17 nodes carry `('codex', 'isolated', changed_files_verified: true)`**
with `contradicted_files` empty. Before this round every one of the 49 `isolated` attributions on
disk had run on Claude, so positive cross-vendor attribution was asserted from the mechanism and
not from data. It is now measured: an isolated worktree plus a `git status` comparison verifies a
peer vendor's file claims exactly as it verifies the host's. The `null` results in the
cross-vendor section above were the shared-worktree path, not a vendor limitation.

**`goal_threshold` and `auto_reassign` reach the children.** Every one of the five child runs
carries `isolated: true, goal_threshold: 90, auto_reassign: true` — the `child_opts` plumbing from
0.7.0/0.7.2 is not theoretical. `accept:P4:1` came back at exactly 90 and passed, which is the
floor behaving as specified rather than as a rounding accident.

One non-finding worth recording so it is not rediscovered: every manager stage reported
`skills_used: ["none"]`. That is correct. The bench arms load `--plugin-dir graph-beta` and
nothing else, so `develop:*`, `think:*` and `cognition:*` are genuinely not installed in the
workspace, and the briefing's rule is that a missing skill is skipped without comment or
substitute. `stage_skills` was `null` on the task, meaning the default `STAGE_SKILLS` table was
injected as designed. Measuring whether the skills change the output needs an arm that installs
the other plugins; no such arm exists yet.

What is still unmeasured after this round: `integrate` and the manager's own `gate:goal`, which
no run has reached with four packages in play. The manager's `gate:goal` is also held to no
threshold — `goal_threshold` is a run-level field and the task object has none.

Rescored on 0.8.0's claim-counting scorer (`false N/M` column): `betas code-flat` **0/107**,
`betas docs-flat` **0/92**, `beta code-flat` **0/193** false claims. The scorer's first draft
reported 16 on the first row; all 16 were its own misreadings and are fixed. No `none`-arm
workspace from this round survives to be scored, so the plain session's false-claim rate — the
number this column exists to produce — is still unmeasured.

### What `code-flat` found, by failing

The manager run scored 6/9 with `cli_ok`, `cli_invalid` and `cli_month` failing — and the
integrated CLI is correct. Run by hand from inside the tree it prints the report, rejects a bad
amount with exit 1, and filters by month. The scorer got nothing: exit 0, empty stdout, on every
call. The reason is one line at the bottom of `bin/ledger.mjs`:

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
```

An "am I the main module" guard. `import.meta.url` is the resolved path
(`file:///private/var/...`); the scorer passes the workspace path as given (`/var/...`, a
symlink on macOS). They differ, `run()` is never called, the process exits 0 having printed
nothing. Any `ledger` reached through a symlink — an npm `bin` link, a `/usr/local/bin` entry —
behaves the same way on every platform. It is a real defect, and the fixture found it the way a
user would.

Who missed it, in order: `implement:U1:1` (**codex**) wrote the guard. `test:U1:1` (**codex**)
invoked the CLI through `process.execPath` and a path derived from `import.meta.url` — the one
spelling that makes the comparison true — and reported 17/17. `gate:U1:1`, `gate:U2:1`,
`gate:goal:1` (**claude**) accepted at 92–95 with `checks: []`. The plain-session CLI from the
`none` arm has no such guard at all (`grep -c import.meta.url` → 0), which is why `none` scored
9/9 on the same criteria.

Three readings of this, and only one is "the other vendor cannot be trusted":

1. *Vendor quality.* The guard is an idiom this model family reaches for and the other does not.
   That is a style difference that happened to carry a bug — not evidence that its code is worse
   in general (the same run's 17 codex nodes all verified their file claims; `npm test` in the
   tree is 85/85).
2. *Shared blind spot.* `CROSS_VENDOR_STAGES` sent **both** implement and test to the peer.
   Author and tester were the same vendor, so the tester invoked the program the way its author
   thinks about it. The design said author ≠ reviewer; the routing delivered that for the gate
   and not for the test, which is the node that actually runs things. **Fixed in 0.8.1**: test
   prefers whichever vendor did not implement the subgoal, wherever that vendor ended up.
3. *Judges that do not execute.* Every gate that accepted this ran zero checks. A gate that had
   run `node /var/…/bin/ledger.mjs report …` once from outside the tree would have caught it.
   0.8.0's rule — `accept: true` with empty `checks[]` is refused — was written before this was
   found and would have refused all three.

The earlier score drops in this table are not this failure. `betas code` 8/9 and `betas
code-flat` 8/9 both lost `readme` (a phrasing criterion) with **all-Claude** execution in round
2 — that is spec narrowing across decomposition layers, not vendor. The one blocked run (3/9)
was an engine bug. Across every code run to date the score losses divide into: one real
cross-vendor defect (this), two spec-drift phrasing misses, one engine bug. None is "the peer
wrote worse code"; one is "the peer's tester shared the peer's assumptions and the host's judges
did not run anything".
