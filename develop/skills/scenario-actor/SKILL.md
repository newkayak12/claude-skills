---
name: scenario-actor
effort: medium
description: >-
  Use when one API scenario spec must become runner code and run against a live server with
  request/response evidence — scenario-director's per-flow subagent, or alone for one flow.
  Triggers: "이 시나리오 하나만 돌려줘", "이 spec 실행해줘", "run this scenario".
scenarios:
  - "Run S3 from tests/scenarios against the staging URL and show me every request"
  - "Implement this one spec as a curl script and execute it"
  - "이 시나리오 하나만 서버에 돌려봐"
  - "spec에 [확인 필요]로 남은 상태 코드, 실제로 쏴서 채워줘"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 실패 시 "스펙이 틀렸나 서버가 틀렸나"를 판단할 때 씁니다.
---

## Standing Mandates

- ALWAYS follow `agents/actor.md` exactly — it is the whole job. Standalone, you are that agent with the user as director.
- ALWAYS hit the server over HTTP with the runner the director chose (or the repo's stack, `references/runners.md`). No imports of the app, no mocks, no database access.
- ALWAYS chain: every step after the first uses a value captured from an earlier response; every string the scenario creates carries the run namespace; cleanup runs through the API on exit even after a failed step.
- ALWAYS resolve `[확인 필요]` by sending the request once and writing the real status and message into the spec — mark it `(probed)`. Never fill it from the README.
- ALWAYS report evidence: the request/response pair for every step, the runner's exit line, and for a failure the verdict — spec wrong or server wrong — with the line that decides it. A pass without the pairs is not a report.
- NEVER touch another scenario's files, the shared helpers, the server, or any repo source. You own `s<n>_*` and nothing else.
- NEVER assert on a whole body, and NEVER write a literal host or port into runner code.
- Goal: one scenario, one runner file, one log a reviewer can replay by hand.

# Scenario Actor

Turns one spec into runner code, runs it against the live server, and returns the evidence.
Runs as a subagent of `scenario-director` — one actor per spec, in parallel — or alone when the
user hands over a single flow. The prompt in `agents/actor.md` is the contract; `references/runners.md`
holds the per-stack shapes (curl + bash default, pytest + httpx, RestAssured, Hurl).

## Process

1. Read the spec, the shared helper (if any), and the routes the spec names. Do not read the rest.
2. Implement `s<n>_<flow>.<ext>` in the runner's shape: capture → use, `expect` with body in the message, cleanup deferred.
3. Run it once with `BASE_URL` and `SCENARIO_LOG` set. Probe every `[확인 필요]` first and update the spec.
4. On failure: read the pair, decide spec-or-server (`think-tool` if available), fix only if the spec was wrong, re-run once. A server-side failure stays failed and is reported with the pair.
5. Return the report in `agents/actor.md`'s format.

## Output Template

See `agents/actor.md` — spec id, files written, probed values, per-step pairs, exit line, verdict.

## What Claude Does / What You Do

| Claude | You (or the director) |
|---|---|
| Writes and runs one scenario, returns pairs and verdict | Supply spec path, `BASE_URL`, runner, helper path |
| Probes `[확인 필요]` against the server and records what came back | Decide spec-vs-server when the actor cannot |

## Related Skills

- `develop:scenario-director` — collects, generates, normalizes, dispatches actors, runs the set twice
- `develop:flaky-test-analyzer` — the scenario passes alone and fails in the set after isolation is ruled out
