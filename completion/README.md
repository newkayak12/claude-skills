# completion

**English** · [한국어](#한국어)

One skill, for the moment right before you say "done". A completion claim made from the same
context that produced the work is the author grading their own paper: every ambiguous signal tilts
toward passing. This plugin closes that gap two ways — it forces a **verify-level** (an explicit
pass bar) before any check runs, and it hands the check to an **isolated subagent** whose context
never saw your reasoning, so the verdict is independent of your wish to be done.

## Install & Uninstall

```bash
/plugin install completion@newkayak12-claude-skills
/plugin uninstall completion@newkayak12-claude-skills
```

## Skills

### `verification-before-completion`

State the pass bar, delegate the check to a context that isn't yours, and claim only what the
returned evidence proves. Use it before any status statement — "tests pass", "build is green",
"bug is fixed", "ready to commit" — and before a commit, push, or PR. It is not a substitute for
having tests; it is the gate that decides whether their result may be spoken as a claim.

```
Retry backoff is implemented and I think the suite is green — verify it properly
before I open the PR.
```

The iron law: **no completion claim without a verify-level and isolated fresh evidence.** The gate,
with no skippable step:

```
0. LEVEL    Bar defined? harness project → .claude/conventions/verification.md,
            otherwise references/verification-patterns.md, else stand one up now.
1. ISOLATE  Fresh subagent per claim. Brief = {claim, verify-level, command} only.
2. RUN      Subagent runs the FULL command, captures raw output + exit code.
3. VERDICT  pass/fail against the bar, evidence attached — not "trust me".
4. GATHER   Multiple claims → N subagents in parallel, no shared context.
5. CLAIM    Assert only what the evidence supports.
```

Standing up a bar when none exists takes one line — *bug fixed* → the exact scenario that used to
fail now exits 0; *tests pass* → full suite exits 0 with zero failures (a subset run is "partial",
never "passing"); *build green* → exits 0 with no `error:` lines, warnings are not failures. An
ambiguous result after applying the bar counts as a **fail**: the burden of proof is on passing.

What does and does not settle a claim:

| Claim | Isolated evidence that settles it | Does NOT settle it |
|---|---|---|
| Tests pass | Full suite, 0 failures, exit 0 | An earlier run; "should still pass" |
| Bug fixed | The original failing case now passes | Code changed, therefore assumed fixed |
| Regression test real | Red-green proven (fails without the fix) | It passes once, direction unchecked |
| Subagent finished | You checked the VCS diff yourself | The subagent's "success" message |

Isolation quality matters as much as isolation itself: the moment "I'm pretty sure it works, just
confirm" leaks into the brief, the verifier is re-infected with your bias and the isolation is
fake. Supporting files: `agents/delegation-verifier.md` (the verifier brief spec) and
`references/verification-patterns.md` (default bars for ambiguous results).

## Harness relationship

This is the harness *judge ≠ actor* rule brought down to a single session. When the six-stage
engine runs, its Test stage does exactly this automatically — and mounts this skill statically to
do it. Solo, this skill **is** that stage.

---

# 한국어

[English](#completion) · **한국어**

"다 됐어"라고 말하기 직전을 위한 스킬 하나짜리 플러그인입니다. 작업을 만든 그 컨텍스트가 내리는
완료 선언은 자기 답안 자기가 채점하는 것과 같습니다 — 애매한 신호가 전부 통과 쪽으로 기웁니다.
이 플러그인은 그 틈을 두 방향으로 막습니다. 검사를 돌리기 전에 **verify-level**(명시적 통과
기준)을 먼저 세우게 하고, 실제 검사는 당신의 추론을 본 적 없는 **격리된 서브에이전트**에게
넘깁니다. 판정이 "끝내고 싶은 마음"과 무관해지도록.

## 설치 / 제거

```bash
/plugin install completion@newkayak12-claude-skills
/plugin uninstall completion@newkayak12-claude-skills
```

## 스킬

### `verification-before-completion`

통과 기준을 말하고, 검사는 내 것이 아닌 컨텍스트에 맡기고, 돌아온 증거가 증명하는 것만 주장합니다.
모든 상태 선언 — "테스트 통과", "빌드 성공", "버그 고쳤어", "커밋할게" — 앞과 commit·push·PR
앞에서 씁니다. 테스트를 대신해 주는 스킬이 아니라, 그 결과를 주장으로 말해도 되는지를 결정하는
게이트입니다.

```
재시도 백오프 구현했고 테스트도 다 통과한 것 같은데, PR 올리기 전에 제대로 검증해줘.
```

철칙: **verify-level과 격리된 새 증거 없이는 완료를 주장하지 않는다.** 건너뛸 수 있는 단계는
없습니다:

```
0. LEVEL    기준이 있나? 하네스 프로젝트 → .claude/conventions/verification.md,
            아니면 references/verification-patterns.md, 그것도 없으면 지금 하나 세운다.
1. ISOLATE  주장마다 새 서브에이전트. 브리프는 {주장, verify-level, 실행할 명령}뿐.
2. RUN      서브에이전트가 명령을 전체로 실행, raw 출력 + exit code 캡처.
3. VERDICT  기준에 대고 pass/fail, 증거 첨부 — "믿어줘"는 안 됨.
4. GATHER   주장이 여럿이면 N개 서브에이전트 병렬, 컨텍스트 공유 없음.
5. CLAIM    증거가 뒷받침하는 것만 주장.
```

기준이 없을 때 세우는 건 한 줄이면 됩니다 — *버그 고침* → 원래 실패하던 그 시나리오가 exit 0,
*테스트 통과* → 전체 스위트가 실패 0으로 exit 0(부분 실행은 "partial"이지 절대 "passing"이
아님), *빌드 성공* → exit 0에 `error:` 줄 없음(경고는 실패가 아님). 기준을 적용했는데도 결과가
애매하면 그건 **fail**입니다. 입증 책임은 통과 쪽에 있습니다.

주장을 결정짓는 것과 아닌 것:

| 주장 | 결정짓는 격리된 증거 | 결정짓지 못하는 것 |
|---|---|---|
| 테스트 통과 | 전체 스위트, 실패 0, exit 0 | 아까 돌린 결과, "아직 통과할 거야" |
| 버그 고침 | 원래 실패하던 케이스가 지금 통과 | 코드를 바꿨으니 고쳐졌겠지 |
| 회귀 테스트 유효 | red-green 증명(수정 없으면 실패) | 한 번 통과했고 방향은 미확인 |
| 서브에이전트 완료 | VCS diff를 직접 확인 | 서브에이전트의 "성공" 메시지 |

격리는 했느냐만큼 어떻게 했느냐가 중요합니다. "거의 되는 것 같은데 확인만 해줘"가 브리프에 새는
순간 검증자는 당신의 편향에 다시 감염되고 격리는 가짜가 됩니다. 부속 파일:
`agents/delegation-verifier.md`(검증자 브리프 규격), `references/verification-patterns.md`(애매한
결과에 대한 기본 통과 기준).

## 하네스와의 관계

이건 하네스의 *judge ≠ actor* 규칙을 한 세션으로 내린 것입니다. 6단계 엔진이 돌 때 Test 단계가
정확히 이 일을 자동으로 하고, 그때 이 스킬을 정적으로 마운트합니다. 단독으로 쓸 땐 이 스킬이 곧
그 단계입니다.
