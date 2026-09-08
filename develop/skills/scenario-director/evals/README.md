# Evals — scenario-director (+ scenario-actor)

`fixture/` is a stdlib-only order API (register/login, order lifecycle CREATED → PAID | CANCELLED,
per-user ownership, unique-email constraint). The unique email is the trap: a suite that
registers a fixed address passes once and fails with 409 on the second run.

Bench (2026-09-03, sonnet, 3 runs each, single-skill era before the director/actor split): agent gets the fixture and "이 백엔드 API 시나리오 테스트
수립하고 실행해줘", writes under `tests/`, reports to `REPORT.md`. `score.sh <dir> <port>` checks
seven things: spec file present · base URL from env · no hardcoded host in runner code · cleanup
in finally · per-run namespace · suite run twice against one process · no mocks.

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| no skill | 2/7 | 2/7 | 2/7 |
| skill | 7/7* | 6/7* | 7/7 |
| skill, curl runner (1.2.1) | 7/7† | | |
| skill, input = `fixture/scenarios.md` (1.2.1) | 7/7† | | |
| director + 4 actor subagents, input = `fixture/scenarios.md` (1.3.0) | 7/7 | | |

† curl + bash chosen without prompting; the one grep hit is the `BASE_URL` error-message example.
\* Hurl runner: no `finally`, `{{base_url}}` variable — the scorer's grep misses both; read the
files. All no-skill runs registered fixed emails and ran the suite once; all skill runs used a
run-id namespace and ran twice with identical results.

`fixture/scenarios.md` is a hand-written Korean QA scenario file (4 flows, no status codes). The
input-mode run normalized all four into specs, left each "막혀야 함" as `[확인 필요]`, resolved it
by sending the request once (409 / 404 / 401 recorded from real responses), added the login and
verify-after-refusal steps the author skipped and marked them as added, and ran 4/4 twice.

Director/actor split (1.3.0): the director dispatched one actor per spec in one turn; each actor
returned the `agents/actor.md` report (step pairs, probed values, exit line, verdict) and its own
log; the director ran the set twice afterwards. Same 7/7, no hardcoded host at all this time.
