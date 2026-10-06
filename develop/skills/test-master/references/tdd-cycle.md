# Test-First Discipline

Supports the Reference-mode hand-off: cases written here become failing tests in the implementer's first step.

## The loop

1. **Red** -- write one small test for one behavior. Run it. It must fail, and for the reason you predicted (missing behavior, not a typo or compile error).
2. **Green** -- write the least code that makes it pass. Hard-coding a return value is acceptable if the next test will force generalization.
3. **Refactor** -- with all tests green, improve names and structure. No new behavior in this step.

Repeat in short turns of minutes.

## Why watching it fail matters

A test never seen failing may be asserting nothing: wrong object, always-true condition, code path never reached. The red run is the evidence the test can detect the defect it claims to guard.

## Excuses and replies

| Excuse | Reply |
|---|---|
| "Too simple to test" | simple code still regresses; the test takes a minute |
| "I'll write tests after" | tests written after confirm what the code does, not what it should do |
| "I already wrote the code, keep it as reference" | delete it and re-derive from tests; you will often write less |
| "Hard to test" | that is design feedback -- split the unit, inject the dependency |
| "Need to explore first" | spike freely, then discard the spike and start with a test |

## Applying it

- **New feature**: list cases (see case-spec.md), pick the simplest, red-green, then the next. Order cases from trivial to general.
- **Bug fix**: first write a test reproducing the report and watch it fail; then fix; the test stays as the regression guard.
- **Legacy code**: add characterization tests around the part you will change, then change it under that net.

## Before calling it done

- [ ] every new behavior has a test that was seen failing first
- [ ] failures were for the expected reason
- [ ] minimal code written; no untested extras
- [ ] whole suite green, output clean
- [ ] tests use real objects unless a boundary forces a double
- [ ] error and boundary cases included
