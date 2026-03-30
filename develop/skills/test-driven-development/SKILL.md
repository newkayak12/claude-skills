---
name: test-driven-development
description: >-
  Apply when someone wants to drive implementation through tests rather than write tests after the fact — new features, bug fixes, or refactors where design confidence matters.
  Triggers on: "TDD", "테스트 먼저 작성", "test-first", "red-green-refactor", "failing test first", "테스트 주도 개발", "write test before code", "TDD 사이클".
  Best for: new features with uncertain API design, bug fixes that need a regression test, refactoring with safety net.
  Not for: test generation for existing untested code (use test-master); diagnosing flaky tests (use flaky-test-analyzer).
references:
  - references/testing-anti-patterns.md
scenarios:
  - "let's do TDD on this feature"
  - "I want to write the test first"
  - "how do I apply red-green-refactor here?"
  - "TDD로 개발해줘"
  - "테스트 먼저 작성하고 싶어"
  - "red-green-refactor 사이클 적용해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 RED 단계에서 실패 이유 검증과 REFACTOR 단계에서 동작 변경 여부 판단이 더 정확해집니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Test-Driven Development (TDD)

Write the test first. Watch it fail. Write minimal code to pass.

**Core principle:** If you didn't watch the test fail, you don't know if it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| New features | Throwaway prototypes |
| Bug fixes | Generated code |
| Refactoring | Configuration files |
| Behavior changes | Adding tests to untested legacy (use test-master instead) |

Thinking "skip TDD just this once"? Stop. That's rationalization.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Delete means delete

## Process: Red-Green-Refactor

Cycle: RED → verify failure → GREEN → verify pass → REFACTOR → repeat

### RED — Write Failing Test

Write one minimal test showing what should happen.

```typescript
// Good: clear name, tests real behavior, one thing
test('retries failed operations 3 times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };

  const result = await retryOperation(operation);

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

**Requirements:**
- One behavior
- Clear name
- Real code (no mocks unless unavoidable)

### Verify RED — Watch It Fail

**MANDATORY. Never skip.**

```bash
npm test path/to/test.test.ts
```

If think-tool is available, invoke it now: reason about whether the failure message confirms the test is testing the right thing — not just that it ran, but that it failed *for the expected reason* (feature missing, not a typo or import error).

**Test passes?** You're testing existing behavior. Fix test.

**Test errors?** Fix error, re-run until it fails correctly.

### GREEN — Minimal Code

Write simplest code to pass the test. Don't add features, refactor other code, or "improve" beyond the test.

```typescript
// Good: just enough to pass
async function retryOperation<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === 2) throw e;
    }
  }
  throw new Error('unreachable');
}
```

### Verify GREEN — Watch It Pass

**MANDATORY.**

```bash
npm test path/to/test.test.ts
```

If think-tool is available, invoke it now: reason about whether the test is passing because the feature is correctly implemented, or because the assertion was inadvertently weakened.

### REFACTOR — Clean Up

If think-tool is available, invoke it now: reason about each planned change and classify it as structure-only (rename, extract, deduplicate) or behavior-changing. Proceed only if all changes are structure-only.

After green only:
- Remove duplication
- Improve names
- Extract helpers

Keep tests green. Don't add behavior.

### Repeat

Next failing test for next feature.

## Good Tests

| Quality | Good | Bad |
|---------|------|-----|
| **Minimal** | One thing. "and" in name? Split it. | `test('validates email and domain and whitespace')` |
| **Clear** | Name describes behavior | `test('test1')` |
| **Shows intent** | Demonstrates desired API | Obscures what code should do |

## When Stuck

| Problem | Solution |
|---------|----------|
| Don't know how to test | Write wished-for API. Write assertion first. Ask your human partner. |
| Test too complicated | Design too complicated. Simplify interface. |
| Must mock everything | Code too coupled. Use dependency injection. |
| Test setup huge | Extract helpers. Still complex? Simplify design. |

## Red Flags

See `references/rationalization-red-flags.md` for the full list of rationalizations that mean: Delete code. Start over with TDD.

Common ones: "I already manually tested it," "just this once," "keeping as reference."

## Verification Checklist

Before marking work complete:

- [ ] Every new function/method has a test
- [ ] Watched each test fail before implementing
- [ ] Each test failed for expected reason (feature missing, not typo)
- [ ] Wrote minimal code to pass each test
- [ ] All tests pass
- [ ] Output pristine (no errors, warnings)
- [ ] Tests use real code (mocks only if unavoidable)
- [ ] Edge cases and errors covered

Can't check all boxes? You skipped TDD. Start over.

## Debugging Integration

Bug found? Write failing test reproducing it. Follow TDD cycle. Test proves fix and prevents regression.

Never fix bugs without a test.

## Testing Anti-Patterns

Before writing any RED test, read `references/testing-anti-patterns.md` to pre-screen test design. If sequential-thinking is available, walk through each gate function in `references/testing-anti-patterns.md` as sequential steps before writing the test.

Common pitfalls:
- Testing mock behavior instead of real behavior
- Adding test-only methods to production classes
- Mocking without understanding dependencies

## Output Template

When applying TDD, produce:
1. Failing test with explanation of what it tests and why it should fail
2. Minimal implementation to make it pass
3. Refactored version (if cleanup was done)
4. Next test in the cycle

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Writes failing tests with clear names | Confirm the test tests the right behavior |
| Writes minimal passing implementation | Run tests and verify they pass/fail as expected |
| Suggests refactoring options (structure-only) | Approve refactoring direction |
| Flags rationalization anti-patterns | Delete pre-written code when required |

## Final Rule

```
Production code → test exists and failed first
Otherwise → not TDD
```

No exceptions without your human partner's permission.

## Related Skills

- `develop:test-master` — generating tests for existing untested code
- `develop:flaky-test-analyzer` — diagnosing intermittent test failures
- `develop:clean-code` — test code quality principles
