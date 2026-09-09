# Evals — scenario-director + scenario-actor

`fixture/` is a stdlib-only order API (register/login, order lifecycle CREATED → PAID | CANCELLED,
per-user ownership, unique-email constraint) with three traps:

| Trap | What it catches |
|------|-----------------|
| unique email, no delete | a suite that registers a fixed address passes once and 409s on run 2 |
| README says another user's order → **403**; server returns **404** | copying docs into an assert instead of probing the server |
| `python3 server.py <port> --bug` — pay accepted from CANCELLED | a vacuous set: every scenario passes on a broken server |

`fixture/scenarios.md` is a hand-written Korean QA file (4 flows, no status codes). `fixture/specs/`
holds the four golden specs the director would write from it — S3's cross-user rows carry
`[확인 필요: docs say 403]`, S2's refusal row `[확인 필요]`.

## Scripts

| Script | Measures |
|--------|----------|
| `fixture/smoke.sh` | the fixture's traps behave (run after editing `server.py`) |
| `bench-actor.sh <model> <runs>` | actor reliability at CI level: fresh golden specs → `ci.sh` against a healthy server, then the same specs against `--bug` |
| `bench-director.sh <arm> <runs>` | end to end: fixture + `scenarios.md` in, one `claude -p` director run, `score.sh` |
| `score.sh <workdir> <port>` | 12 criteria (below) on what a director run left behind; the executed criteria re-run the produced `ci.sh` |

Workspaces go to `$TMPDIR/scenario-bench` (`SCENARIO_BENCH_OUT` to move). They must stay outside
the plugin tree: Claude Code denies Write/Edit under a loaded `--plugin-dir`, and a first bench
round inside `evals/results/` measured that denial instead of the skill.

Arms are isolated with `--setting-sources project` (hides installed plugins) plus `--plugin-dir`
for the arm under test; `1.3.0` is a git worktree at `18d1315`.

### score.sh criteria

Static: `spec` (≥1 `s*.spec.md`) · `ci_env` (`ci.sh` present, reads `BASE_URL`) · `no_hardcode` ·
`cleanup` (every spec has a `Cleanup:` line) · `namespace` · `run_twice` (REPORT has two `Run`
lines with counts) · `no_mock` · `no_runner_code` (no `.sh/.py/.kt/.hurl/.ts/.js` under `tests/`
besides `ci.sh`) · `docs_not_copied` (a spec records 404 for the cross-user row and no spec asserts
a bare 403).
Executed (`SCORE_EXECUTE=0` to skip): `executed` (produced `ci.sh` passes on a fresh healthy
server) · `mutation_caught` (≥1 `fail_server` against `--bug`) · `pairs` (every `results/s<n>.json`
has steps and a log with `->` lines).

## Actor bench — 2026-09-09, 1.4.0

3 runs per model, 4 golden specs per run, each run against a healthy server then `--bug`. 24 actor
invocations per model.

| Model | Healthy pass | S2 `[확인 필요]` probed into spec | S3 recorded 404 + docs≠server | `--bug` caught (S2 fail_server) | False pass on `--bug` | Cost / run (8 actors) | Cost / actor (median) | Duration / actor (median) |
|-------|-------------|------|------|------|------|------|------|------|
| haiku | 12/12 | 3/3 | 3/3 | 3/3 | 0 | $0.70–0.74 | $0.09 | 70s |
| sonnet | 12/12 | 3/3 | 3/3 | 3/3 | 0 | $1.40–1.52 | $0.20 | 56s |

Both models hit every criterion; haiku at half the cost. `ci.sh` therefore defaults
`ACTOR_MODEL` to haiku. Sonnet's verdict text for the mutation was more specific ("pay accepted on
a CANCELLED order and mutated status to PAID (expected 409) ← step 5 pair") — set
`ACTOR_MODEL=sonnet` for flows longer than ~8 steps or when the failure narrative matters.

Two rounds were discarded before this table: one run inside the plugin tree (write denial, see
above), and the smoke run that surfaced it. Two contract fixes came out of those rounds and are in
1.4.0: the actor greps the spec for leftover `[확인 필요]` before writing results, and masks
`token`/`password` fields in logged bodies, not only the `Authorization` header.

## Director bench — 2026-09-09

Input: fixture + `README.md` + `scenarios.md`, prompt "이 백엔드의 API 시나리오 테스트를 수립하고
실행해줘. QA가 쓴 scenarios.md도 있어. 서버는 BASE_URL에 떠 있어. 산출물은 tests/ 아래에, 리포트는
REPORT.md에." Director model sonnet. `score.sh` executed criteria re-run the produced `ci.sh` with
haiku actors.

| Arm | Runs | Score | What it left behind | Cost · time |
|-----|------|-------|---------------------|-------------|
| no skill | 2 | 2/12, 2/12 | `tests/*.py` unittest files, one run, no spec, no catalog; found the README 403 lie by reading `server.py` but asserted from code, not from a response | $0.32–0.83 · 2–6 min |
| 1.3.0 (code runner) | 2 | 7/12, 7/12 | 8 specs + `CATALOG.md`, `lib.sh`/`run.sh` + one `s<n>.sh` per flow, run twice; misses every 1.4.0-only criterion (`ci.sh`, no runner code, executed/mutation/pairs) — on the seven design-neutral criteria it is 7/7 | $2.4–3.3 · 6–7 min |
| 1.4.0 (AI runner) | 2 | 12/12, 11/12 | run 1: 9 specs, `CATALOG.md` with coverage matrix, `ci.sh`, `results/s1–9.{log,json}`, REPORT with run 1 / run 2 / mutation. run 2: 8 specs, catalog, `ci.sh`, results — but no REPORT: the director backgrounded `ci.sh` and "waited for the notification", which ends a `claude -p` session. Both runs' produced `ci.sh` re-run by the scorer: all healthy scenarios pass, S2/S3 `fail_server` on `--bug`, no runner scripts | $9.2 · 19 min; $2.3 · 4.5 min |

1.4.0 run 1 in detail — it did the job and exposed three things, all fixed in the same version:

- five in-session actor subagents saved a 100-line bash runner (`s<n>.sh`) in the old shape; one of
  them lost `results/s6.json`. The director rejected the reports, deleted the scripts, re-ran S6
  inline. `agents/actor.md` now says "do not save a script" in the walk step.
- `ci.sh` hung when the director ran it from inside the session: a nested `claude -p` under `xargs`
  waits on stdin. `ci.sh` now feeds `< /dev/null`; the director has a fallback (re-dispatch as
  run 2, report `ci.sh` as unverified).
- (run 2) the director ran `ci.sh` in the background and stopped to wait — in `-p` mode that is the end
  of the session. Step 5 now says foreground only, and that the dispatched actors do not replace the
  `ci.sh` runs. Run 2 also shows the no-script rule working: zero `s<n>.sh` from 8 actors.
- the scorer's `run_twice` wanted "Run 1 … N passed" on one line; the report wrote "Run 1 —" headings
  and "9/9 pass". Regex relaxed; the row above is the rescored value (static 9/9 + executed 3/3).

The cost is the story to watch: the AI runner spends ~$0.10 (haiku) to $0.20 (sonnet) per scenario
per run, so a 9-flow set run twice plus a mutation pass is ~$2–4 of actors on top of the director.
The code-runner arm was cheaper per run and would stay cheap in CI — but it cannot probe, cannot
judge spec-vs-server, and its scripts drifted from the specs in the 1.3.0 runs (the scorer's
`no_runner_code` exists because of that).
