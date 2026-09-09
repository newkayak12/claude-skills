# Scenario AI Runner (director/actor 1.4.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scenario-actor AI the runner (no generated test code), give CI a `claude -p` entry point, and benchmark actor reliability + director E2E on a fixture with two new traps.

**Architecture:** Director analyzes → writes `s<n>.spec.md` + `CATALOG.md` + `ci.sh` → dispatches actor subagents. Actor reads one spec, curls the server, writes `results/s<n>.{log,json}`, returns a verdict. CI runs `claude -p "/develop:scenario-actor <spec>"` per spec via `ci.sh`. Evals: fixture with `--bug` and a docs-vs-server trap; `score.sh` v2 executes the produced set; two bench scripts.

**Tech Stack:** Markdown skills, bash, curl, python3 stdlib (fixture), `claude -p`.

**Spec:** `docs/superpowers/specs/2026-09-09-scenario-ai-runner-design.md`

## Global Constraints
- Skill authoring rules from `write/skills/writing-skills/SKILL.md`: `description` starts with `Use when`; EN+KR scenarios; sections Process → Output Template → What Claude Does / What You Do → Related Skills.
- No generated runner code anywhere (`s<n>.sh`, `run.sh`, `lib.sh`, RestAssured, Hurl, pytest shapes are removed).
- `BASE_URL` always from env; a literal host in any produced file is a scorer failure.
- Results dir: `tests/scenarios/results/`; JSON schema exactly: `{id, flow, status: pass|fail_spec|fail_server, steps:[{n, method, path, code, ms}], probed:[{step, code, message}], verdict, duration_ms}`.
- Version: develop 1.3.0 → 1.4.0 in `.claude-plugin/marketplace.json` and `develop/.claude-plugin/plugin.json`; `develop/README.md` and `develop/KOR.md` move together.

---

### Task 1: Fixture v2 — mutation switch and docs trap
**Files:** Modify `develop/skills/scenario-director/evals/fixture/server.py`, `.../fixture/README.md`; Create `.../fixture/smoke.sh`.
**Produces:** `python3 server.py <port> [--bug]`; README claims other-user order → 403 while server returns 404.
- [ ] Write `smoke.sh`: start server on a free port, register user, create+cancel order, `pay` → expect 409; start with `--bug` → expect 200; bob GET alice's order → expect 404. Exit 1 on mismatch.
- [ ] Run it → fails (`--bug` not implemented, pay returns 409).
- [ ] server.py: `BUG = "--bug" in sys.argv`; in pay: `if o["status"] != "CREATED" and not (BUG and o["status"] == "CANCELLED")`. README: add "Another user's order → **403**" line (deliberately wrong) and a hidden note in `evals/README.md` explaining the trap.
- [ ] Run smoke.sh → passes. Commit `test(develop): fixture v2 — --bug switch, docs 403 trap`.

### Task 2: scenario-actor 1.4.0 — actor is the runner
**Files:** Rewrite `develop/skills/scenario-actor/agents/actor.md`, `.../SKILL.md`; Delete `.../references/runners.md`; Create `.../references/http.md`, `.../references/ci.md`.
**Produces:** actor contract consumed by director and by `ci.sh`; `ci.sh` template.
- [ ] `agents/actor.md`: inputs (spec, `BASE_URL`, `SCENARIO_RESULTS`); job list (read spec + named routes; probe; curl each step with `-sS -w '\n%{http_code}'`, time with `date +%s%N`; assert fields via python3 `-c`; verify-after-refusal mandatory; cleanup through API in all exit paths; 5xx → fail_server; docs≠server → spec marker `(docs said X, server Y)`; one re-run after spec fix); write log + json; report format with pairs, exit verdict.
- [ ] `references/http.md`: curl shapes (header auth, json body, code capture), token masking rule (`Bearer ****` in log), results JSON schema, log line format, JUnit mapping.
- [ ] `references/ci.md`: full `ci.sh` (spec loop, `claude -p "/develop:scenario-actor $spec" --output-format json --max-turns "${ACTOR_MAX_TURNS:-40}" --model "${ACTOR_MODEL:-sonnet}" --allowedTools 'Bash,Read,Write,Edit'` in parallel with `xargs -P`, wait, merge json → `results/junit.xml`, exit code) + GitHub Actions job (secrets.ANTHROPIC_API_KEY, service start, upload results).
- [ ] SKILL.md: mandates (no runner code, evidence, 5xx, masking), Process, Output Template, tables, Related. Commit `feat(develop): scenario-actor 1.4.0 — actor runs the spec itself, ci.sh`.

### Task 3: scenario-director 1.4.0
**Files:** Modify `develop/skills/scenario-director/SKILL.md`, `.../references/scenario-spec.md`.
- [ ] SKILL.md: step 3 writes `ci.sh` from `scenario-actor/references/ci.md` (no runner choice); new step "coverage matrix" (CATALOG.md second table: transition × happy/refusal/skip reason); new step "mutation sanity" when a fault switch exists; step 5 `ci.sh` twice, per-scenario diff; rejection list for actor reports; Output Template updated with `results/junit.xml`, matrix line.
- [ ] scenario-spec.md: `(docs said 403, server 404)` marker rule; coverage matrix shape; remove runner references; results dir note.
- [ ] Commit `feat(develop): scenario-director 1.4.0 — ci.sh, coverage matrix, mutation sanity`.

### Task 4: score.sh v2 + bench scripts
**Files:** Rewrite `develop/skills/scenario-director/evals/score.sh`; Create `.../evals/bench-actor.sh`, `.../evals/bench-director.sh`, `.../evals/fixture/specs/s1..s4.spec.md` (golden specs for the actor bench).
**Produces:** `score.sh <workdir> <port>` → 12 `name:0/1` lines + `TOTAL:n/12`; `bench-actor.sh <model> <runs>` → table; `bench-director.sh <arm> <runs>`.
- [ ] score.sh criteria: spec · env_baseurl (ci.sh or specs reference `BASE_URL`) · no_hardcode · cleanup (spec Cleanup lines or json cleanup) · namespace (run id in logs) · run_twice (two `Run` lines in REPORT with real counts) · no_mock · executed (results/*.json count ≥ specs count, all pass on healthy server) · mutation_caught (re-run `ci.sh` vs `--bug` server → ≥1 fail_server) · docs_not_copied (no `403` assert for cross-user; a `404` recorded) · pairs (every json has steps ≥2 and log has `->` per step) · results_json.
- [ ] Golden specs: S1 lifecycle, S2 pay after cancel (`[확인 필요]`), S3 cross-user (spec written from README: 403 → actor must probe to 404), S4 no token.
- [ ] bench-actor.sh: for run in 1..N: healthy server → `ci.sh` with `ACTOR_MODEL=$1`; `--bug` server → `ci.sh`; collect per-spec status, duration, cost from `claude -p` json (`total_cost_usd`); print table.
- [ ] bench-director.sh: arm ∈ {noskill, 1.3.0 (git worktree at 18d1315 plugin dir), 1.4.0}; copy fixture into a temp workspace with `scenarios.md`, run `claude -p` with the prompt "이 백엔드 API 시나리오 테스트 수립하고 실행해줘 (scenarios.md 참고)" and `--plugin-dir`, then `score.sh`.
- [ ] Dry-run both scripts with `--help`/syntax check (`bash -n`). Commit `test(develop): scorer v2 (12 pts), actor + director bench scripts`.

### Task 5: Run benches, record
- [ ] `bench-actor.sh haiku 3`, `bench-actor.sh sonnet 3` (background, parallel).
- [ ] `bench-director.sh noskill 2`, `1.3.0 2`, `1.4.0 2`.
- [ ] Write tables + observations into `evals/README.md`; set `ACTOR_MODEL` default in `ci.md` from the actor result. Commit `docs(develop): scenario bench 1.4.0 results`.

### Task 6: Version + docs
- [ ] marketplace.json + plugin.json → 1.4.0; README.md/KOR.md scenario sections rewritten (AI runner, ci.sh, bench numbers). Commit `feat(develop): 1.4.0 — scenario director/actor AI-run at CI level`.
