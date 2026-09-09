# scenario-director / scenario-actor 1.4.0 — AI-run scenarios at CI level

## Decision
The actor AI is the runner. No generated runner code (`s<n>.sh`, `run.sh`, RestAssured, Hurl).
The director analyzes the backend and writes scenario specs; one actor per spec sends the requests
itself, records evidence, and returns a verdict. CI invokes the same skill headlessly.

## Artifacts (all under `tests/scenarios/`)
- `CATALOG.md` — inventory (unchanged shape) + coverage matrix (transition × refusal).
- `s<n>_<flow>.spec.md` — source of truth. Shape unchanged; new marker `(docs said X, server Y)`.
- `results/s<n>.log` — every request/response pair, tokens masked.
- `results/s<n>.json` — `{id, flow, status: pass|fail_spec|fail_server, steps:[{n, method, path, code, ms}], probed:[], verdict, duration_ms}`.
- `ci.sh` — loops specs, runs `claude -p "/develop:scenario-actor <spec>"` per spec in parallel with
  `BASE_URL`, `SCENARIO_RESULTS`, `--output-format json --max-turns N --model $ACTOR_MODEL`, merges
  `results/*.json` into `results/junit.xml`, exits non-zero on any fail. Written by the director once
  from `scenario-actor/references/ci.md`.

## Actor contract (`agents/actor.md`)
Inputs: spec path, `BASE_URL`, results dir. Job: read spec + named routes only; probe `[확인 필요]`;
send each step with curl; assert fields; verify-after-refusal; cleanup through the API even on failure;
5xx → fail_server immediately; one re-run only after a spec fix; write log + json; return report.
Same contract as subagent (director) and as `claude -p` (CI).

## Director changes
- Step 3 writes `ci.sh` (not `lib.sh`/`run.sh`); runner choice removed.
- New step: coverage matrix in CATALOG.md — every transition has a happy row and ≥1 refusal row or a written skip reason.
- New step: mutation sanity when the server offers a fault switch — set must fail against it.
- Step 5: `ci.sh` twice on the same process; per-scenario diff, not just summary.
- Rejection rules for actor reports: no pairs, whole-body assert, literal host, probed value absent, refusal without verify step.

## Fixture v2 (`evals/fixture`)
- README documents "other user's order → 403"; server returns 404 (probe-vs-docs trap).
- `--bug` flag: pay allowed from CANCELLED (mutation trap).

## Bench
- Actor: model ∈ {haiku, sonnet} × 4 specs × 3 runs, healthy + `--bug` server → verdict accuracy,
  evidence completeness, false-pass rate, duration, cost. Picks `ACTOR_MODEL` default.
- Director E2E: no-skill / 1.3.0 / 1.4.0 × input scenarios.md × 2 runs, scorer v2 (12 pts:
  spec · env base url · no hardcoded host · cleanup evidence · namespace · run twice (real) ·
  no mocks · suite actually executed with pass count · mutation caught · docs code not copied ·
  per-step pairs in report · results json present).

## Out of scope
Load tests, browser flows, code-runner export.
