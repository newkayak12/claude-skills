# Bench axes — pre-registered protocol

Fixed before any arm runs. Arms: A and B, anonymized before judging. Each problem runs 3 times per
arm. Every problem is fictional and generic: no real project, company, task or person's work.

## Axes

Win, tie and loss are per problem, from that problem's hidden check
(`hidden/gh-<slug>-<n>/check.mjs`) and the run record of each run.

| # | slug | Measures | Win | Tie | Loss |
|---|------|----------|-----|-----|------|
| 1 | `verified` | verified output, hidden tests | arm's median run passes the hidden check, the other arm's fails | both pass or both fail | arm's median fails, the other's passes |
| 2 | `defect` | defect caught before implement | the planted defect in the request or fixture is named in a pre-implement stage record (plan, critique, ledger) in the median run, and the other arm's is not | both name it or neither does | the other arm names it and this arm does not |
| 3 | `recovery` | recovery keeps accepted work, stranded package | after the injected failure, the hidden check passes and every package accepted before it is still in the workspace unchanged, in the median run; the other arm's fails either | same outcome on both | the other arm keeps accepted work and this arm loses or strands it |
| 4 | `denied` | tool-denied handled as blocked | a denied tool call ends in a `blocked` record naming the tool, with no retry of the same call and no fake pass, in the median run; the other arm's does not | both handle it or both mishandle it | the other arm records `blocked` correctly and this arm does not |
| 5 | `baseline` | red baseline not charged to the change | the fixture's pre-existing failing check is reported as baseline, not as the change's failure, and the hidden check passes, in the median run; the other arm's does not | same outcome on both | the other arm separates the baseline and this arm charges it to the change |
| 6 | `seam` | cross-area seam settled | the hidden check passes on the seam between the two areas, and the run record shows one agreed contract, in the median run; the other arm's does not | same outcome on both | the other arm settles the seam and this arm does not |
| 7 | `progress` | progress visible | more of the problem's listed progress fields (stage, owner, state, next step) are readable from the run files while the run is still going | equal field count | fewer fields |
| 8 | `decisions` | decisions surfaced | more of the problem's listed decisions (what, who, why) are recorded in the run files as asked of the person or auto-decided | equal count | fewer decisions recorded |
| 9 | `cost` | cost and time | lower median cost (tokens, else USD) by at least the minimum effect, with wall time not worse by that margin | cost within the minimum effect, or a cost win offset by an equal time loss | higher median cost by at least the minimum effect |

Fields for 7 and 8 are listed per problem in its hidden check header. Axis 9 reads cost and wall time
from the run record, lower is better.

## Median of pass/fail runs

For axes 1-6 a run is pass or fail on the criterion above. The median of 3 runs is pass when at
least 2 pass. For axes 7-9 the median is the middle value of the 3 runs.

## Minimum effect

Defaults, placeholders awaiting the user's values. The run must not stall on them: use these until
the user replaces them, and record which values a report used.

| Axes | Minimum effect |
|------|----------------|
| 1-6 | 1 problem (wins minus losses) |
| 7-8 | 1 field (summed over problems) |
| 9 | 20% (per-problem median difference) |

## Aggregation

1. Per problem: the median of its 3 runs per arm.
2. Per axis: count wins, ties and losses across that axis's problems.
3. When the win-loss margin is under the axis minimum, report `below minimum effect`; do not call a winner.
4. No total score across axes. Each axis is reported on its own.

Pass bar for the protocol: this file committed with its sha256 recorded, at least 3 problems per
axis, each with a hidden check.

## Layout and naming

All under `teams/scripts/bench/`.

| Path | Holds |
|------|-------|
| `requests/gh-<slug>-<n>.txt` | the request text for problem `gh-<slug>-<n>` |
| `fixtures/<fixture>` | the starting workspace, copied whole by `bench.sh` |
| `hidden/gh-<slug>-<n>/check.mjs` | the hidden check |
| `hidden/gh-<slug>-<n>/good/` | a workspace state the check must accept (non-empty) |
| `hidden/gh-<slug>-<n>/bad/` | a workspace state the check must reject (non-empty) |
| `cases.tsv` | one row per problem |

- Problem id: `gh-<slug>-<n>`, `<slug>` one of the nine above, `<n>` from 1.
- `cases.tsv` columns, tab separated: `id axis slug request fixture check status`. `status` starts at `pending`.
- `check.mjs` takes a workspace directory as `argv[2]`, exits 0 when the work passes and non-zero when it fails. It uses node built-ins and workspace files only.
- `hidden/` sits outside `fixtures/` because `bench.sh` copies a fixture whole: a check inside a fixture would be visible to the arm.

## Unmeasured

| Item | Status |
|------|--------|
| Codex delegation | `unmeasured` while Codex auth fails. No problems, no row in `cases.tsv`. |
