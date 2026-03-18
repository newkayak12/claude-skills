# Verification Result Standards

Use this table when a verification command returns an ambiguous result. Running the command is not enough — the output must meet these standards to count as passing verification.

| Scenario | Passes If | Fails If | Notes |
|----------|-----------|----------|-------|
| Unit test suite | Exit 0 + output shows 0 failures | Any non-zero exit OR any failure count > 0 | "Skipped" tests are acceptable; "errors" are not |
| Flaky test | Passes 3 consecutive runs | Fails on any of 3 runs | One pass is not sufficient for flaky suites |
| Partial test suite (subset run) | All targeted tests pass AND you explicitly state coverage is partial | Full suite would pass | Never claim "tests pass" when only a subset was run |
| Linter | Exit 0 + 0 errors | Any errors, even if warnings only | Warnings alone are acceptable; errors are not |
| Build | Exit 0 + no error lines in output | Non-zero exit OR "error:" lines in output | "Warning:" lines do not constitute failure |
| Build with warnings | Exit 0 + warnings only | "error:" present anywhere in output | Claim "build passes with warnings", not "build passes cleanly" |
| Integration test | All integration tests exit 0 | Any failure, even in "optional" suites | Do not skip integration tests by declaring them optional |
| Static analysis | Zero issues at configured severity | Any issue at or above configured severity | Reconfiguring severity to hide issues is a violation |

---

## The Interpretation Rule

If a verification result is ambiguous after applying this table, **treat it as a failure**. The burden of proof is on passing, not on explaining why the ambiguous result might be OK.

Acceptable: "Verification returned ambiguous result — treating as fail, investigating."
Not acceptable: "Verification probably passed, continuing."
