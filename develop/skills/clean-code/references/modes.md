# Gate and Implement Modes — rubric and worked examples

## Severity rubric (gate mode)

| Severity | Meaning | Typical examples |
|----------|---------|------------------|
| **blocking** | The code as written breaks, or cannot be shown to meet, a stated acceptance item; or it is a correctness defect the next caller will hit | swallowed error (`catch (e) {}`) where acceptance says the error reaches the caller; `return null` where acceptance forbids null; a comment claiming behaviour the code does not have, on the path an acceptance item covers; a public behaviour the acceptance names with no test |
| **major** | Meets acceptance today but will cost the next reader or changer | flag argument; function doing several things; misleading name; duplicated logic; error without context; test that cannot fail |
| **minor** | Local readability | magic number whose meaning is obvious from context; formatting; a "what" comment |

Rules:
- Severity follows the acceptance, not taste. A smell becomes blocking only when you can
  name the acceptance item (or the correctness property) it breaks.
- No acceptance given: blocking is reserved for correctness defects (lost errors, null
  leaks, comments that lie, unreachable required paths). Say "no acceptance supplied" in the
  verdict line.
- Unclear intent is never a question. Record it as a finding: `assumption: <what you
  assumed> — <what evidence would settle it>`. If the unclear intent is exactly what an
  acceptance item turns on, the finding is blocking ("cannot verify A2: …").
- Absent evidence is a fail, not a pass. If a check names a command and you can run it,
  run it; cite what it printed.

## Finding row — worked example

| ID | file:line | Dimension | Severity | Verdict | Threatens | Fix |
|----|-----------|-----------|----------|---------|-----------|-----|
| F1 | src/discount.js:23 | errors | blocking | fail | A2 pricing-API error reaches caller | rethrow as `PricingUnavailableError(cause)`; delete empty catch |
| F2 | src/discount.js:31 | errors | blocking | fail | A3 no null to callers | throw `UnknownUserError(userId)` or return `NO_DISCOUNT` |
| F3 | src/discount.js:12 | comments | blocking | fail | A1 never negative | comment says "clamped at zero" but no clamp: add `Math.max(0, …)` and a test |
| F4 | src/discount.js:8 | smells | minor | fail | — | `0.15` → `LOYALTY_RATE` |
| F5 | src/discount.js:40 | functions | major | fail | — | split `format(isPrint)` into `formatForPrint` / `formatForScreen` |
| P1 | src/discount.js:1-45 | names | — | pass | — | — |

Verdict: **FAIL** — 3 blocking (F1, F2, F3).

## Mapping onto a fixed caller contract (teams gate) — worked example

```json
{
  "stage_ok": true,
  "accept": false,
  "match_pct": 40,
  "checks": ["read src/discount.js:20-26 -> catch (e) {} swallows fetchPrice error",
             "node --test test/discount.test.js -> 4 pass, no test for negative discount"],
  "gaps": ["F1 src/discount.js:23 — blocking — threatens A2 pricing-API error reaches caller — rethrow as PricingUnavailableError",
           "F2 src/discount.js:31 — blocking — threatens A3 no null to callers — throw UnknownUserError",
           "F3 src/discount.js:12 — blocking — threatens A1 never negative — comment claims a clamp the code lacks; add Math.max(0, …) + test"],
  "observations": ["F4 src/discount.js:8 — minor — 0.15 magic number -> LOYALTY_RATE",
                   "F5 src/discount.js:40 — major — flag argument format(isPrint)"],
  "reason": "3 of 3 acceptance items threatened by blocking findings",
  "evidence": "src/discount.js diff, test run above"
}
```

`match_pct` is the caller's field: estimate it as the caller defines it (share of
acceptance met). It is not the skill's 0–10 score scaled up.

## Implement mode — worked example

Requirement: `parseDuration('1h30m') -> 5400` in `src/duration.js`; units h/m/s; invalid
input throws `DurationFormatError`; tests in `test/duration.test.js`.

| # | Step | Leaves in tree | Check |
|---|------|----------------|-------|
| 1 | Pin behaviours: valid units, combination, empty/garbage/unknown unit/negative → error | handoff note listing cases + assumptions (e.g. "`'90'` without unit is invalid — assumed") | every acceptance item maps to ≥1 case |
| 2 | Cases first: `parses hours and minutes`, `rejects unknown unit`, … (test-master reference mode); write them, run → RED for the right reason (TDD) | `test/duration.test.js` with named tests | runner shows them failing on missing behaviour, not a syntax error |
| 3 | Structure: one module, one public export | `src/duration.js` exports `parseDuration`, `DurationFormatError` | public surface = what the requirement names |
| 4 | Names: domain words | `UNIT_SECONDS`, `parseSegment`, `DurationFormatError` | no `data`, `tmp`, `x` |
| 5 | Function boundaries: `parseDuration` orchestrates, `parseSegment` handles one `<n><unit>` | two functions, each < 20 lines, no flag args | each readable without its callee's body |
| 6 | Error handling: throw `DurationFormatError(input, reason)`; no null, no silent 0 | error class with context fields; tests asserting the type | error tests pass |
| 7 | GREEN + tidy: make tests pass, remove duplication and magic numbers | passing suite | runner output, all green |
| 8 | Self-gate: run gate mode over the diff; fix blocking/major | no new findings | gate-mode findings list empty of blocking |

In an implement stage the table above is how the work is ordered and checked; what is
returned is the caller's shape (`changed_files: ["src/duration.js", "test/duration.test.js"]`,
`checks` with the runner output), not this table.
