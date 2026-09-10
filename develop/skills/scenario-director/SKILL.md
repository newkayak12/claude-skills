---
name: scenario-director
effort: high
description: >-
  Use when a backend's API scenario tests must be collected or read from md, written as specs,
  then run against a live server by one actor AI per flow. Triggers: "API 시나리오 테스트",
  "시나리오 md 읽고 서버에 돌려줘", "flow test", "시나리오 CI 붙여줘".
scenarios:
  - "Set up scenario tests for this backend and run them against the dev server"
  - "Turn these Postman collections and this incident into repeatable scenario tests"
  - "I wrote the flows in scenarios.md — read it and run each one against the server"
  - "이 백엔드 API 시나리오 테스트 수립하고 실행해줘"
  - "시나리오 md로 써놨어, 이거 읽고 서버에 돌려줘"
  - "주문 생성부터 결제·취소까지 흐름 따라가는 테스트 만들어줘, mock 말고"
compatibility:
  optional:
    - sequential-thinking
    - think-tool
  remote_mcp_note: >-
    sequential-thinking이 있으면 1단계 상태 전이를 빠짐없이 나열할 때 씁니다. 실행 판단은 액터가 합니다.
---

## Standing Mandates

- ALWAYS collect before generating. Existing collections, logs, incidents, and the user's own scenario file are real flows; the state map generates the rest. Every flow enters `tests/scenarios/CATALOG.md` with its source before it has a spec.
- ALWAYS accept a scenario the user wrote — markdown, a table, a sentence per step — and normalize it into the spec shape (`references/scenario-spec.md`). Their title stays; a missing status code becomes `[확인 필요]` for the actor to resolve by sending the request, never a guess.
- ALWAYS confirm the server answers one real request before writing any spec. A state map read from code is not trusted until a response backs it.
- ALWAYS hand execution to `scenario-actor` — one subagent per spec, dispatched in one turn, each with the spec path, `BASE_URL`, and the results dir. The actor is the runner: nobody writes test code. The director never sends a scenario request itself and never asserts a result it did not receive from an actor.
- ALWAYS install `tests/scenarios/ci.sh` (copied from `scenario-actor/references/ci.md`) before dispatching — it is the same actor under `claude -p`, and it is what CI and the two-run check execute.
- ALWAYS run `ci.sh` twice against the same server process after the actors return. Run 2 differing from run 1 — in count or per scenario — is a cleanup gap and is reported as such.
- ALWAYS keep a coverage matrix in `CATALOG.md`: every transition in the state map has a happy row and at least one refusal row, or a written reason for skipping it.
- ALWAYS check the set is not vacuous when the server offers a fault switch (a `--bug` flag, a chaos toggle, a feature flag that breaks a rule): run `ci.sh` once against the broken server and require at least one `fail_server`. A set that passes on a broken server tests nothing.
- NEVER invent an endpoint, field, or status code, and NEVER let an actor's report through unread. Return to the actor: a pass with no step pairs, a missing `results/s<n>.json`, an assert on a whole body, a literal host in any command, a `[확인 필요]` still in the spec, a refusal step without a verify step after it.
- NEVER build state outside the API — no database inserts, no fixture edits — and never let a spec share a token or a record with another spec.
- Goal: a catalog a teammate can extend by adding a row, a spec per flow they can read in a minute, and one `ci.sh` that gives the same pass/fail against any `BASE_URL` — locally and in CI.

# Scenario Director

Owns the scenario set for a backend: collects flows from what exists, generates the rest from
the state map, normalizes anything a person wrote, keeps the catalog, installs `ci.sh`, and
dispatches one `scenario-actor` subagent per spec to execute it by hand. Aggregates the actors'
evidence into one report. The director thinks in flows; the actor thinks in requests; CI runs
the same actor through `claude -p`.

**Not for** unit or single-endpoint tests with mocks (`test-master`), load tests, one
intermittent failure (`flaky-test-analyzer`), or browser flows.

---

## Process

**0. Mode by input.**

| Input | Mode |
|-------|------|
| A backend and nothing else | Collect → generate → dispatch (steps 1–5) |
| Scenario files — `*.spec.md`, or any markdown/text where a person wrote flows | Normalize → dispatch (steps 3–5; step 1 only to confirm the server and the routes the file names) |
| `tests/scenarios/` already exists | Extend: new rows, new specs, re-run `ci.sh` (steps 2–5) |
| A Postman / Insomnia / `.http` / `.hurl` collection | Convert → dispatch (origin kept in the catalog) |

**1. Collect, then map.** Read all five sources before writing anything:

| Source | Yields |
|--------|--------|
| Routes, handlers, OpenAPI, README | resources, state values, transitions, auth rule |
| Postman / Insomnia / `.http` / `.hurl` / existing E2E files | flows someone already walks by hand — convert, don't rewrite |
| Access logs or traces (a day is enough) | the request sequences real clients send, in order |
| Bug reports, incidents, closed issues | the exact sequence that broke once |
| The user, one question: "어떤 흐름이 깨지면 제일 아픈가요?" | the flow that goes first |

Start the server, send one request by hand, then write the state map. If `sequential-thinking`
is available, use it so no transition is skipped.

**2. Choose the flows.** Collected flows first, then generated: the primary lifecycle; one
refusal per transition (wrong state, wrong owner, missing auth); cross-user isolation; input
rejection at the entry point. Cap the first set at what a reviewer reads in five minutes.

**3. Write the specs, the catalog, and `ci.sh`.** One `tests/scenarios/s<n>_<flow>.spec.md` per
flow in the shape from `references/scenario-spec.md`; `CATALOG.md` with the inventory table
(source, spec ✓, run —) and the coverage matrix (transition × happy / refusal / skip reason). Copy
`ci.sh` from `scenario-actor/references/ci.md` into `tests/scenarios/` unchanged; a status code
the docs give but nobody has seen returned stays `[확인 필요]`.

**4. Dispatch the actors.** One `scenario-actor` subagent per spec, all in one turn, each told:
spec path · `BASE_URL` · results dir (`tests/scenarios/results/`) · "follow
`scenario-actor/agents/actor.md`; run your scenario once; write your log and JSON; return the
report." Actors resolve `[확인 필요]` by sending the request and recording the real response in
the spec, and note `(docs said X, server Y)` when documentation lied. Read every report against
the rejection list in the mandates; send the actor back once, then report the gap.

**5. Run `ci.sh` twice, mutation-check, report.** `BASE_URL=… tests/scenarios/ci.sh` twice
against the same server process, in the foreground — never backgrounded: a headless director that
backgrounds `ci.sh` and waits for a notification ends its session with no report. Both `Run:` lines
verbatim, plus any scenario whose status changed between runs. The actors dispatched in step 4 are
not a substitute for these runs; `ci.sh` is the command CI will execute, so it is what gets verified. If `ci.sh` cannot run from inside this session (a nested `claude -p` that
never returns within two minutes), stop it, re-dispatch the actors once more with fresh namespaces
as run 2, and say in the report that `ci.sh` itself is unverified until the user runs it in a
terminal. If the server has a fault switch, restart it broken and run `ci.sh` once
more: at least one `fail_server` or the set is vacuous — say which scenario should have caught it.
Update `CATALOG.md` (run ✓, last run). Per failure: the actor's pair and its spec-or-server
verdict. Hand over `references/ci.md`'s GitHub Actions job for the user to wire in.

---

## Output Template

```
## Scenario set — <service>
State map: <resource>: CREATED → PAID | CANCELLED (PAID ✗ cancel) · auth: bearer, per-owner
Catalog: tests/scenarios/CATALOG.md — 9 flows (3 Postman, 1 incident #212, 1 scenarios.md, 4 generated) · 6 specced · 6 run
Coverage: 4 transitions · 4 happy · 5 refusal · 1 skipped (no delete — retention, see README)

| # | Flow | Source | Steps | Refuses | Actor |
|---|------|--------|-------|---------|-------|
| S1 | order lifecycle | generated | login → create → get → pay → get | — | pass, 5 req, 38ms |
| S2 | pay twice | scenarios.md › "결제 두 번" | … → pay → pay → get | 409 "cannot pay from PAID" (probed) | pass, 6 req, 41ms |
| S3 | other user's order | generated | bob GET/pay alice's | 404 (docs said 403, server 404) | pass, 5 req, 30ms |

CI: BASE_URL=… tests/scenarios/ci.sh  → results/junit.xml   (workflow: scenario-actor/references/ci.md)

## Execution — <timestamp>, <base url>
Run 1: 6 passed, 0 failed  (actor cost $0.42)
Run 2 (same process): 6 passed, 0 failed — no per-scenario change
Mutation (--bug): 5 passed, 1 failed — S2 fail_server "pay accepted from CANCELLED" ✓ set is not vacuous
Failures: none | per failure: step, request, response, verdict (spec | server), what changed
Docs≠server: README says 403 for another user's order; server returns 404 (S3 spec updated)
```

---

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Collects flows from code, collections, logs, incidents, and your file into a catalog; maps states from one real request | Name the flow that hurts most when it breaks; hand over any scenario file you have |
| Normalizes your wording into specs, leaves unknown codes as `[확인 필요]` | Answer the one question when a step names something the routes don't have |
| Installs `ci.sh`, dispatches one actor per spec, rejects evidence-free passes, runs the set twice, mutation-checks it | Provide a test account or seed endpoint; decide spec-vs-server when an actor cannot |
| Keeps `CATALOG.md` (inventory + coverage matrix) current | Add the GitHub Actions job and `ANTHROPIC_API_KEY` secret |

## Related Skills

- `develop:scenario-actor` — executes one spec by hand (curl, evidence, verdict); the director's subagent, CI's `claude -p` unit, also callable alone
- `develop:test-master` — mocked unit/integration tests, coverage, test plans
- `develop:flaky-test-analyzer` — one scenario failing intermittently after isolation is confirmed
- `develop:transaction-boundary-reviewer` — a scenario reveals partial writes after a failed step
