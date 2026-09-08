---
name: api-scenario-test
effort: high
description: >-
  Use when a backend needs multi-step scenario tests that hit a running server over HTTP —
  login → create → transition → refuse — and get executed, not mocked. Triggers: "API 시나리오
  테스트", "서버 띄우고 실제로 쳐보는 테스트", "진짜 동작하는지", "mock 말고", "flow test".
scenarios:
  - "Set up scenario tests for this backend and run them against the dev server"
  - "Our API has no flow tests — write ones that go login → create order → pay → assert state"
  - "Turn these Postman collections into repeatable scenario tests in the repo's language"
  - "이 백엔드 API 시나리오 테스트 수립하고 실행해줘"
  - "주문 생성부터 결제·취소까지 흐름 따라가는 테스트 만들어줘"
  - "서버 띄운 상태에서 실제로 치는 테스트가 필요해, mock 말고"
compatibility:
  optional:
    - sequential-thinking
    - think-tool
  remote_mcp_note: >-
    sequential-thinking이 있으면 1단계 상태 전이를 빠짐없이 나열할 때, think-tool이 있으면 4단계에서
    "스펙이 틀렸나 서버가 틀렸나"를 판단할 때 씁니다.
---

## Standing Mandates

- ALWAYS hit a running server over HTTP. A scenario test that imports the app, mocks a client, or calls a service class is not a scenario test — it belongs to `test-master`.
- ALWAYS build state through the API. Data a scenario needs is created by earlier steps or by a documented seed endpoint; NEVER insert into the database or edit fixtures files to get a precondition — that tests a state the API cannot produce.
- ALWAYS chain: every step after the first uses a value captured from an earlier response (id, token, version, location header). A scenario whose steps share nothing is a list of smoke tests.
- ALWAYS give each scenario its own data namespace — a unique prefix or fresh account per run — and clean up through the API in a finally block. Two scenarios that can see each other's rows will fail together someday.
- ALWAYS include one fail-path per state transition: the request that must be rejected (wrong state, wrong owner, missing auth) with the exact status and error the API returns — the 409 matters more than the 200.
- ALWAYS run what you wrote and paste the evidence: the runner's summary line and, for every failure, the request and response bodies. "Should pass" is not a result.
- NEVER invent an endpoint, field, or status code. Everything comes from routes, handlers, OpenAPI, or a request you actually sent. When the contract is unclear, send the request and read what comes back; if the server can't be started, stop and say so.
- NEVER classify a failing scenario as flaky on the first failure. Re-run once in isolation; if it passes alone and fails in the suite, the leak is in data isolation — fix the namespace, not the assertion.
- NEVER write assertions on whole response bodies. Assert the fields the flow depends on (status, id present, state value, total) so an added field doesn't fail every scenario.
- Goal: a runner command that a teammate can execute against any environment URL and get the same pass/fail, with a report that names each flow, its steps, and where it broke.

# API Scenario Test

Establishes and runs scenario tests for a backend: flows that walk a real server through the
states its API promises, step by step, capturing values along the way and asserting each
transition — including the ones that must be refused. Two outputs: the scenario set (spec +
runner code in the repo's language) and the execution report with evidence.

**Not for** unit or single-endpoint tests with mocks (`test-master`), load tests
(`test-master` performance reference), diagnosing one intermittent failure
(`flaky-test-analyzer`), or UI flows through a browser.

---

## Process

**1. Map the surface and the states.** Read routes, handlers, OpenAPI, and any README. List
every resource, its state values, and the transitions between them, with the auth and ownership
rule on each. Then confirm the server starts and answer one request by hand — the map is not
trusted until a real response backs it. If `sequential-thinking` is available, use it here so no
transition is skipped.

**2. Choose the flows.** From the state map, pick scenarios in this order:
1. The primary lifecycle — the longest happy path through the main resource.
2. One refusal per transition — wrong state, wrong owner, missing or bad auth.
3. Cross-user isolation — user B cannot read or mutate user A's resource.
4. Input rejection at the entry point — the 400s that guard the lifecycle.
Cap the first set at the flows a reviewer can read in five minutes; more flows come after the
runner is green.

**3. Write the spec, then the runner.** Each flow is a spec first (`references/scenario-spec.md`):
steps with request, captured values, and asserted fields. Then implement it in the runner that
matches the repo (`references/runners.md`): RestAssured for JVM, pytest + httpx for Python,
Vitest + fetch for Node, Hurl when the repo has no test stack. The base URL, credentials, and
port are configuration, never literals. Once the specs are fixed, the runner files are
independent per flow and can be written in parallel.

**4. Run, then run again.** Execute the full set against the started server. On any failure:
read the request/response pair, decide whether the spec or the server is wrong (`think-tool` if
available — this is the one judgment call in the loop), fix the one that is, re-run. Then run the suite a second time without restarting the server — a suite that passes
only on a clean process has a cleanup gap.

**5. Report.** Per flow: steps, pass/fail, and for failures the exact request and response. Close
with the runner command and the environment variables it reads.

---

## Output Template

```
## Scenario set — <service>
State map: <resource>: CREATED → PAID | CANCELLED (PAID ✗ cancel) · auth: bearer, per-owner

| # | Flow | Steps | Refuses |
|---|------|-------|---------|
| S1 | order lifecycle | login → create → get → pay → get | — |
| S2 | pay twice | login → create → pay → pay | 409 "cannot pay from PAID" |
| S3 | cross-user | A: create · B: get | 404 |

Files: tests/scenarios/*.spec.md · tests/scenarios/<runner files>
Run: BASE_URL=http://localhost:8080 <runner command>

## Execution — <timestamp>, <base url>
<runner summary line, verbatim>
Run 2 (same process): <summary line>
Failures:
- S2 step 4 — POST /orders/{id}/pay → expected 409, got 200
  request: {...}  response: {...}
  cause: <spec wrong | server wrong> → <what was changed>
```

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Maps resources, states, and transitions from the code and one real request | Confirm the state map — you know which transitions are intended |
| Writes specs, then runner code in the repo's language, with config-driven base URL | Provide credentials for a test account or a seed endpoint |
| Starts the server, runs the suite twice, pastes the summary and every failure's request/response | Decide, for each failure, whether the server or the expectation is wrong when Claude cannot tell |
| Names the cleanup gap when run 2 differs from run 1 | Wire the runner command into CI |

## Related Skills

- `develop:test-master` — unit/integration tests with mocks, coverage, test plans
- `develop:flaky-test-analyzer` — when one scenario fails intermittently after isolation is confirmed
- `develop:transaction-boundary-reviewer` — when a scenario reveals partial writes after a failed step
- `develop:spring-boot-engineer` — RestAssured runner details on Spring
