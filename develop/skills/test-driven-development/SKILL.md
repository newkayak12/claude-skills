---
name: test-driven-development
effort: high
description: >-
  Use when someone wants tests that prove a fix or feature actually works, not
  just tests that happen to pass — TDD, red-green-refactor, falsifiable tests.
  Triggers: "TDD", "테스트 먼저 작성", "test-first", "red-green-refactor".
references:
  - references/testing-anti-patterns.md
scenarios:
  - "let's do TDD on this feature"
  - "prove this test would actually catch the bug"
  - "TDD로 개발해줘"
  - "이 테스트가 진짜 버그를 잡는지 증명해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 falsifiability probe 설계와 REFACTOR 단계의 동작 변경 여부
    판단이 더 정확해집니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를
    추가하세요.
---
## Standing Mandates

- ALWAYS write a failing test before writing any implementation code.
- ALWAYS name the exact production change that would make a RED test fail before you run it — a falsifiability probe, not a hope.
- ALWAYS make the smallest possible change to turn RED to GREEN before refactoring.
- NEVER accept a passing test without evidence it can also fail for the right reason. (Scar: a test that passed on its first run was exercising code that already existed; the "fix" was never tested.)
- NEVER keep code that arrived before its test "for reference" — discard it and rebuild from the test.
- NEVER patch a bug without a test that fails first for that exact reason.
- Goal: each behavior has one RED Evidence Record whose observed reason matches the prediction, then GREEN. A mismatch is re-diagnosed once; if it still mismatches, stop and report the record, do not implement.

# Test-Driven Development (TDD)

A test never watched failing is an unverified claim. Every RED is a small experiment: state what would break it, run it, record what happened. GREEN counts only once that record exists.

**Not for** throwaway prototypes, generated code, config files, or adding tests to untested legacy (`test-master`). Intermittent failures go to `flaky-test-analyzer`.

## Modes

| Step | Solo | Harness-engaged (a harness pipeline invoked this skill) |
|---|---|---|
| RED | probe self-checked against the acceptance criterion | probe checked against SetGoal's criteria before Implement proceeds |
| GREEN | you run the verify command before claiming done (`completion:verification-before-completion`) | the Test stage runs it; QualityGate blocks claims without its output |
| Evidence | RED Evidence Record kept in your notes or commit message | durable artifact for QualityGate — a missing or fabricated record fails the gate |

Unsure → solo, and defer to stage boundaries if a pipeline owns the run.

## Process

Cycle: RED → falsifiability probe → verify failure → GREEN → verify pass → REFACTOR → repeat. Before the first RED, skim `references/testing-anti-patterns.md` (asserting on mocks, test-only production methods, tautological expectations).

**RED.** One behavior per test, named as a sentence about that behavior, real collaborators (mock only what cannot run in the test).

```typescript
test('opens the circuit after 3 consecutive failures', async () => {
  const breaker = new CircuitBreaker({ threshold: 3 });
  const failingCall = () => Promise.reject(new Error('down'));
  for (let i = 0; i < 3; i++) await breaker.attempt(failingCall).catch(() => {});
  expect(breaker.isOpen()).toBe(true);
});
```

**Falsifiability probe (required, fresh for every RED).**
1. Name the breaking change in one sentence specific enough for someone else to make it ("removing the failure counter increment").
2. Run the test before any implementation exists and confirm it fails.
3. After GREEN, optionally apply that change and re-run: still passing means the test pins nothing — fix the test; failing as predicted means revert and keep the proof.

A test you cannot name a breaking change for is not understood yet; do not run it.

**RED Evidence Record** — filled as you go, never reconstructed:

| Field | Example |
|---|---|
| Test name | `opens the circuit after 3 consecutive failures` |
| Breaking change named (pre-GREEN) | removing the failure counter increment |
| Observed failure reason | `TypeError: breaker.isOpen is not a function` — missing implementation, as predicted |

**Verify RED (mandatory).** Run it. With think-tool: does the failure text match the recorded reason, or is it a typo, bad import, syntax slip? Only the former is a valid RED. Passes immediately → you are exercising existing code, rewrite the test. Errors instead of failing → fix the error and rerun until the failure is the predicted one.

**GREEN.** Only enough code for the test in front of you; no options, generality, or cleanup yet.

**Verify GREEN (mandatory).** Run it. With think-tool: passed because the behavior is implemented, or because an assertion was loosened on the way?

**REFACTOR on green only.** Classify each planned edit as structure-only (rename, extract, dedupe) or behavior-changing; do the first kind, and give the second its own RED. A test going red mid-refactor means the edit was not structure-only.

**Repeat** with the next behavior.

A bug report is a missing test: reproduce it as a failing test, name the probe, run the normal cycle.

## When Stuck

| Symptom | Likely fix |
|---|---|
| Can't picture the test | Sketch the call you wish existed, write the assertion first, then the setup |
| Test is fighting you | The design is — simplify the interface, not the test |
| Everything needs a mock | Too tightly coupled; inject the dependency |
| Setup dwarfs the assertion | Extract a helper; if still huge, shrink the design |

## Red Flags — discard the code, restart from a failing test

Writing implementation before the test · a test that passed on the first run · unable to say why a test failed · "I'll add tests once this works" · "already checked it manually" · "tests-after get the same place" · "I'm honoring the spirit of it" · "too much time invested to throw this away" · "strict TDD is dogma".

## Output Template

Per cycle:

```
## TDD cycle <n> — <behavior>
Verdict: <GREEN with record | stopped: failure reason mismatch>
Test + probe: <test name> · breaks if <named change>
RED Evidence Record: observed "<failure text>" · matches prediction: yes|no
GREEN: <minimal change> · verify command output: <N passed, 0 failed>
Refactor: <structure-only edits | none>
Next: <next behavior queued>
```

Closing tally after the last cycle: `Cycles: N · RED records: N · mismatches: M · probe re-run after GREEN: K/N`.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes the failing test and states the probe before running it; fills the record from real command output | Confirm the probe names a real, specific breaking change; spot-check the observed reason |
| Writes the minimal GREEN, classifies refactor edits, flags red-flag language | Approve refactor direction; say go/no-go on discarding pre-written code; run verification in solo mode |

## Related Skills

- `completion:verification-before-completion` — the solo-mode evidence gate GREEN defers to
- `harness:harness` — the QualityGate this evidence trail feeds
- `develop:test-master` — tests for existing untested code
- `develop:flaky-test-analyzer` — intermittent failures
