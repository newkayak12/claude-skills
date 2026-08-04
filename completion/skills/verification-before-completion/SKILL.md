---
name: verification-before-completion
description: >-
  Use before claiming work is done, tests pass, a build is green, or a bug is
  fixed without fresh isolated evidence. Triggers on: "완료했어", "테스트 통과", "빌드 성공",
  "버그 고쳤어", "커밋할게", "PR 올릴게", "done", "should pass", "bug is fixed".
scenarios:
  - "테스트 다 통과했어 → 커밋할게"
  - "버그 고쳤어"
  - "Build should be green now"
  - "PR 올려도 될 것 같아"
  - "The feature is complete"
  - "요구사항 다 구현됐어"
compatibility:
  optional:
    - think-tool   # reasoning about the verify-level before running anything
  remote_mcp_note: >-
    think-tool이 있으면 검증 전에 "어떤 증거가 이 주장을 증명하는가"(verify-level)를
    명확히 세우는 데 활용하세요. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Verification Before Completion

## Overview

A completion claim made from the same context that produced the work is not a
verification — it is the author grading their own paper. This skill closes that
gap two ways: it forces a **verify-level** (an explicit pass bar) before any
check runs, and it delegates the check to an **isolated subagent** whose context
never saw your reasoning, so the verdict is independent of your wish to be done.

**Core principle:** evidence before claims — and the evidence must come from
somewhere that isn't rooting for the answer.

Meeting the letter while dodging the spirit is a violation. Rewording a claim so
"this rule doesn't apply" is the violation the rule exists to catch.

## The Iron Law

```
NO COMPLETION CLAIM WITHOUT A VERIFY-LEVEL AND ISOLATED FRESH EVIDENCE
```

If the check did not run this turn, in a context that is not yours, against a bar
you stated up front — you cannot claim it passed.

## The Gate

Run before any status statement or expression of satisfaction. No step is skippable.

```
0. LEVEL    Is the verify-level (pass bar) defined for this claim?
            → harness project → .claude/conventions/verification.md
            → otherwise, default bar → references/verification-patterns.md
            → still undefined → STAND ONE UP first: state what command/output
              would prove this claim, THEN proceed. No bar → no verification.
1. ISOLATE  Delegate each independent claim to a fresh subagent.
            Do NOT pass your reasoning or optimism. Brief = {claim, verify-level,
            command to run} only. (Brief spec: agents/delegation-verifier.md)
2. RUN      The subagent executes the FULL command, captures raw output + exit code.
3. VERDICT  The subagent returns pass/fail AGAINST the bar, with the raw evidence
            attached — not "trust me", the actual command + output + exit code.
4. GATHER   Multiple claims → N subagents in parallel, no shared context.
            Collect verdicts.
5. CLAIM    Assert only what the evidence supports. Any fail → report the real
            state, not the hoped-for one.
```

## Why the verifier must be isolated

The context that wrote the code has a stake in the code passing. Ask it to also
judge, and every ambiguous signal tilts toward "done". A fresh subagent has no
stake: it sees the claim and the command, runs it, and reports what actually
happened. That independence is the whole value — a check run in your own context
is theater. This is the harness *judge ≠ actor* rule brought down to a single
session: when the six-stage engine runs, its Test stage does exactly this
automatically; solo, this skill IS that stage.

**Isolation quality condition:** the brief must be minimal and clean. The moment
you leak "I'm pretty sure it works, just confirm" into the subagent, you've
re-infected the verifier with your bias and the isolation is fake.

## Establishing a verify-level when none exists

Solo work often has no written bar. Do not skip verification for lack of one —
**stand one up**, in one line, before checking:

- *Bug fixed* → bar = the exact scenario that used to fail now exits 0.
- *Tests pass* → bar = the full suite exits 0 with a failure count of zero (a
  subset run is "partial", never "passing" — see verification-patterns.md).
- *Build green* → bar = build exits 0 with no `error:` lines (warnings ≠ failure).
- *Requirements met* → bar = each requirement mapped to one observable check.

Ambiguous result after applying the bar? Treat it as a **fail** — the burden of
proof is on passing, not on explaining the ambiguity away.

## Failure modes

| Claim | Isolated evidence that settles it | Does NOT settle it |
|-------|-----------------------------------|--------------------|
| Tests pass | Subagent: full suite, 0 failures, exit 0 | An earlier run; "should still pass" |
| Build green | Subagent: build exits 0, no error lines | Linter was clean; logs "looked fine" |
| Bug fixed | Subagent: original failing case now passes | Code changed, therefore assumed fixed |
| Regression test real | Red-green proven (fails without the fix) | Test passes once, direction unchecked |
| Subagent finished | You checked the VCS diff yourself | The subagent's "success" message |
| Requirements met | Line-by-line map, each checked | The test suite happens to be green |

## Rationalizations this rule exists to stop

| Excuse | Reality |
|--------|---------|
| "This one's trivial, I'll just check it myself" | The *actor* deciding a check is trivial is the bias. Always isolate. |
| "Spawning a subagent is overkill here" | The gate only fires at claim-time; the cost is bounded and it is the point. |
| "It should work now" | "Should" is a prediction. Run it. |
| "I'm confident" | Confidence is not evidence. |
| "The subagent said success" | A report is not proof — check the diff / re-run yourself. |
| "Partial run is close enough" | Partial proves the part, never the whole. |
| "Different wording, so the rule doesn't apply" | Spirit over letter. |

## Red flags — stop

- Reaching for "should", "probably", "seems", "looks right".
- Typing "Done!" / "Perfect!" / "완료" before a verdict came back.
- About to commit / push / open a PR with no fresh isolated check.
- Taking a subagent's word instead of its evidence.
- Deciding *this* claim doesn't need isolation.

## What Claude does / What you do

- **Claude:** states the verify-level, dispatches an isolated verifier per claim,
  reports the returned evidence, and makes the claim only if the evidence backs it.
- **You:** supply the pass bar if the project has one; otherwise confirm the bar
  Claude stood up before it verifies against it.

## Related

- `harness:harness` — the six-stage engine; its Test/QualityGate is the automated
  form of this gate. This skill is its solo counterpart.
- `.claude/conventions/verification.md` — the verify-level for a harness project.
- `references/verification-patterns.md` — default pass bars for ambiguous results.
- `agents/delegation-verifier.md` — the brief for the isolated verifier subagent.

## Bottom line

State the bar. Hand the check to a context that isn't yours. Claim only what its
evidence proves. This is non-negotiable.
