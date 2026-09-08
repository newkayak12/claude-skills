# Evals — api-scenario-test

`fixture/` is a stdlib-only order API (register/login, order lifecycle CREATED → PAID | CANCELLED,
per-user ownership, unique-email constraint). The unique email is the trap: a suite that
registers a fixed address passes once and fails with 409 on the second run.

Bench (2026-09-03, sonnet, 3 runs each): agent gets the fixture and "이 백엔드 API 시나리오 테스트
수립하고 실행해줘", writes under `tests/`, reports to `REPORT.md`. `score.sh <dir> <port>` checks
seven things: spec file present · base URL from env · no hardcoded host in runner code · cleanup
in finally · per-run namespace · suite run twice against one process · no mocks.

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| no skill | 2/7 | 2/7 | 2/7 |
| skill | 7/7* | 6/7* | 7/7 |

\* Hurl runner: no `finally`, `{{base_url}}` variable — the scorer's grep misses both; read the
files. All no-skill runs registered fixed emails and ran the suite once; all skill runs used a
run-id namespace and ran twice with identical results.
