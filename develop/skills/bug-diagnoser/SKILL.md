---
name: bug-diagnoser
effort: high
description: >-
  Use when a bug, failing test, error, or wrong result is reported and the cause is unproven — invoke before reading or
  editing code. Triggers on: "fix this bug", "debug this", "why is this failing", "고쳐줘", "안 돼요", "에러 나요", "왜 이러죠", "갑자기 안 돼", "디버깅".
scenarios:
  - "Page 2 of the product list shows 9 items instead of 10 — find out why and fix it"
  - "This endpoint started returning 500 after yesterday's deploy and I don't know why"
  - "상품 목록 2페이지만 개수가 하나 모자라요, 원인 찾아서 고쳐줘"
  - "어제 배포 후로 정산 금액이 가끔 틀려요, 디버깅해줘"
  - "주문 수량이 가끔 음수로 저장돼요, 왜 이러는지 모르겠어요"
  - "저번 주까지 되던 업로드가 갑자기 안 돼요, 봐줄래요?"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 가설마다 예측을 세우고 반증 결과를 정리하는 데 도움이 됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- NEVER propose a cause or edit code before one repro command has been run and gone red on the user's exact symptom.
  Reading code first anchors on whatever looks wrong; a `FIXME: off by one?` over correct code is the classic trap,
  and "fixing" it ships a second bug while the first stays. (mattpocock `diagnosing-bugs`: "jumping straight to a
  hypothesis is the exact failure this skill prevents.")
- NEVER show a secret in a command or output — write `<REDACTED>`; build loops against env vars.
- ALWAYS tag every temporary debug line `[DEBUG-<4 hex>]` so cleanup is one grep. Untagged logs survive into commits.

Goal: the user's symptom goes red in one command, the fix turns that command green, and the cause is named with the
evidence that falsified the alternatives.

# Bug Diagnoser

**Not for:** a test that fails only sometimes (`flaky-test-analyzer`); a live outage — mitigate with
`incident-response-playbook` first, then come here for root cause; slowness with correct output
(`performance-profiling-optimization`); writing new code test-first (`test-driven-development`). An intermittent bug in
application code belongs here, with a pinned reproduction rate.

## Process

1. **Build the loop.** Find one command that drives the real code path and asserts the user's symptom. Try in order:
   failing test at the nearest seam → script against the running app (curl, CLI with a fixture input) → replay a
   captured payload → throwaway harness around the one function → loop the trigger N× for non-deterministic bugs →
   `git bisect run` when it worked at a known commit. Done when the command is:
   - **red-capable** — fails on *this* symptom, not "runs without error";
   - **already run once**, invocation and (redacted) output shown;
   - **deterministic**, or a pinned reproduction rate high enough to debug against (raise it: repeat, parallelise, narrow timing);
   - **fast** (seconds) and **unattended**.
   Cannot build one → stop. List what you tried and ask one line: access to the reproducing environment, a redacted
   artifact (log, HAR, payload), or permission for temporary instrumentation. No hypotheses without the loop.
2. **Reproduce and minimise.** Confirm the red is the user's failure, not a neighbour. Cut inputs, config, callers, and
   steps one at a time, re-running after each cut. Stop when every remaining element is load-bearing.
3. **Hypothesise.** Rank hypotheses — usually 3–5, never padded — each with a prediction:
   "If X is the cause, changing Y makes the symptom vanish." No prediction, no hypothesis. Recent changes
   (`git log -p` over the touched files) are a source. Show the ranked list before testing; the user may re-rank it.
4. **Probe.** One variable per probe, each mapped to one prediction. Debugger or a tagged log at the boundary that
   separates two hypotheses; never "log everything". Record each result as falsified / supported.
5. **Fix and lock.** Write the regression test before the fix, at a seam that exercises the real call pattern (the
   multi-caller chain if that is what fails). No such seam → report that as a finding; do not fake one with a shallow
   test. Apply the smallest fix; the loop and the test go green; re-run the original, un-minimised scenario.
6. **Clean up.** `grep -rn "DEBUG-"` returns nothing; throwaway harnesses deleted; the confirmed hypothesis goes into
   the commit message.

**Stop rule.** Two rounds in which every hypothesis is falsified (three failed fixes count as a round) → stop. Report
what was ruled out and why the loop or the architecture is now the suspect; do not start a third round of guesses.

## Output Template

```
## Diagnosis — <symptom in the user's words>

Loop: `<command>`   red before fix: <exact failing line>   green after: <passing line>
Minimised to: <what remained load-bearing>

| # | Hypothesis | Prediction | Probe | Result |
|---|------------|------------|-------|--------|
| 1 | ...        | if ..., then ... | ... | falsified / confirmed |

Cause: <one sentence> — evidence: hypothesis #n confirmed by <probe>; #m falsified by <probe>
Fix: <file:line> — <change>
Regression test: <path::name>  |  No correct seam: <why — this is a finding>
Cleanup: DEBUG- tags left 0 · harnesses removed <n>

Verdict: fixed | stopped after 2 rounds (ruled out: #...) | blocked — no loop (asked: ...)
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Builds and runs the repro loop, shows its red output | Supply the environment, data, or artifact the loop needs |
| Ranks falsifiable hypotheses and runs one-variable probes | Re-rank from domain knowledge ("we deployed #3 yesterday") |
| Writes the regression test at a real seam, then the fix | Decide on fixes that change behaviour others depend on |
| Removes every tagged debug line | Review the commit that names the confirmed cause |

## Related Skills

- `develop:flaky-test-analyzer` — the failing thing is a test that passes on re-run.
- `develop:incident-response-playbook` — production is down now; restore first.
- `develop:performance-profiling-optimization` — correct but slow; measure before changing.
- `develop:test-driven-development` — once the cause is known and a new behaviour is needed.
- `completion:verification-before-completion` — before declaring the fix done.
