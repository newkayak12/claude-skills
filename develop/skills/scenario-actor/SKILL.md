---
name: scenario-actor
effort: medium
description: >-
  Use when one API scenario spec must be executed by hand against a live server — curl per step,
  captured values chained, request/response evidence logged, verdict returned. scenario-director's
  per-flow subagent, the `claude -p` unit CI runs, or alone for one flow. Triggers: "이 시나리오 하나만
  돌려줘", "이 spec 실행해줘", "run this scenario", "spec=… BASE_URL=…".
scenarios:
  - "Run S3 from tests/scenarios against the staging URL and show me every request"
  - "spec=tests/scenarios/s2_pay_twice.spec.md BASE_URL=http://localhost:8080 results=tests/scenarios/results"
  - "이 시나리오 하나만 서버에 돌려봐"
  - "spec에 [확인 필요]로 남은 상태 코드, 실제로 쏴서 채워줘"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 실패 시 "스펙이 틀렸나 서버가 틀렸나"를 판단할 때 씁니다.
---

## Standing Mandates

- ALWAYS read `agents/actor.md` first and follow it exactly — it is the whole job. Standalone, you are that agent with the user as director; under `claude -p`, the prompt's `spec= BASE_URL= results=` are your inputs.
- ALWAYS be the runner: curl each step yourself, capture → use, assert named fields. NEVER write test code, a script file, or a framework test for the scenario — the spec and the log are the artifacts.
- ALWAYS chain and namespace: every step after the first uses a value captured earlier; every string you create carries the run id; cleanup goes through the API on every exit path.
- ALWAYS resolve `[확인 필요]` by sending the request once and writing the real status and message into the spec, marked `(probed)`. When docs and server disagree, the spec takes the server's code and notes `(docs said X, server Y)`.
- ALWAYS write `results/s<n>.log` (every pair, tokens masked) and `results/s<n>.json` (schema in `references/http.md`) — CI reads the JSON, a reviewer replays the log. A pass without both is not a report.
- ALWAYS treat a 5xx, or a refusal that changed state, as `fail_server` on the spot. Decide spec-wrong vs server-wrong once; one re-run; never loop.
- NEVER touch another scenario's files, `CATALOG.md`, `ci.sh`, the server, or repo source. NEVER put a literal host in a command — `"$BASE_URL/..."` always.
- Goal: one spec, one log a reviewer can replay by hand, one JSON CI can count.

# Scenario Actor

Executes one spec against the live server by hand and returns the evidence. Three ways in, one
contract (`agents/actor.md`):

| Called by | How | Inputs arrive as |
|-----------|-----|------------------|
| `scenario-director` | one subagent per spec, in parallel | the dispatch prompt |
| CI (`tests/scenarios/ci.sh`) | `claude -p "/develop:scenario-actor spec=… BASE_URL=… results=…"` | the skill argument line |
| a person | "이 시나리오 하나만 돌려줘" + a spec path | the conversation |

`references/http.md` has the curl, log-line, and result-JSON shapes; `references/ci.md` has
`ci.sh` and the GitHub Actions job the director installs.

## Process

1. Read the spec and `references/http.md`; read only the route handlers the spec names.
2. Namespace the run; probe every `[확인 필요]` first and update the spec.
3. Walk the table with curl: capture → next request → assert code + named field (+ message fragment on refusals) → log the pair. Verify step after every refusal.
4. Cleanup through the API — also after a failed step.
5. On failure: read the pair, decide spec-or-server (`think-tool` if available). Spec wrong → fix the row, re-run once with a fresh namespace. Server wrong → stop, `fail_server`.
6. Write `results/s<n>.json`, return the report in `agents/actor.md`'s format.

## Output Template

See `agents/actor.md` — id and flow, verdict, spec + results paths, probed values, docs≠server
findings, one line per step with code and ms, cleanup line.

## What Claude Does / What You Do

| Claude | You (or the director / CI) |
|---|---|
| Sends every step, chains captures, logs pairs, writes the result JSON | Supply spec path, `BASE_URL`, results dir |
| Probes `[확인 필요]`, records docs≠server mismatches in the spec | Decide spec-vs-server when the actor cannot |
| Cleans up through the API on every exit path | Keep the server up for the run |

## Related Skills

- `develop:scenario-director` — collects, generates, normalizes, dispatches actors, installs `ci.sh`, runs the set twice
- `develop:flaky-test-analyzer` — the scenario passes alone and fails in the set after isolation is ruled out
