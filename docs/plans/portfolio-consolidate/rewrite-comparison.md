# rewrite run-it comparison — merged portfolio-rewrite vs cbdfcd6 baselines

Method (PRD run-it rule): each run is a fresh `general-purpose` subagent on the same model as the author. It had not seen the PRD or the diff and was told to read only the skill under test (+ its linked references) and the fixtures. Baselines were read with `git show cbdfcd6:…`. Fixtures: `portfolio/skills/portfolio-rewrite/evals/files/resume-backend-kr.md` (a) and `jd-fintech-senior-backend.md` (b). Condition (c) is (a) with no posting and no company named. The evals are recorded as ids 1 and 2 in `portfolio/skills/portfolio-rewrite/evals/evals.json`.

Rerun clause (plan critique, adopted as default - revisit): on a parity mismatch, both sides get one fresh rerun. Every attempt is listed below, including the ones that did not count.

## (i) JD mode — merged skill vs `cbdfcd6:resume-tailorer` on (a)+(b)

User prompt, both sides: "이 공고에 맞게 이력서 고쳐줘." + (a) + (b).

### Attempt 1 (mismatch on 최우선 변경 → rerun)

- Merged (first draft of the skill):
  > **JD 적합도 판정:** must-have 5개 중 Missing 0 · Weak 1. 최우선 변경은 커머스랩의 「주문 API p95 응답시간 820ms → 310ms 단축」 줄입니다. 이 줄을 JD 문구 "쿼리 튜닝"으로 다시 쓰고, 유일한 Weak 행인 "RDBMS 설계"를 채울 설계 사례 자리를 `[확인 필요]`로 표시했습니다.
- Baseline:
  > **JD 적합도 판정:** 자격요건(must-have) 5개 중 Missing 0 · Weak 1(RDBMS 설계·쿼리 튜닝). 가장 먼저 바꿀 것은 경력기술서 맨 위에 요약을 새로 넣는 일입니다.

Counts matched (0 / 1), but the target area did not (Experience p95 line vs Profile/Summary). Cause: the draft `references/jd-tailoring.md` said 최우선 변경 is "the change with the most leverage on the must-have rows", which pulled the pick onto the Weak row. The baseline says Summary/Profile is "the highest-leverage single edit". Fix: REF L42 now makes Summary/Profile the default 최우선 변경. The merged run had also paraphrased the 판정 labels, so SKILL L145 now requires them literally.

### Attempt 2 (both fresh; merged run was on the REF fix, before the L145 label fix)

- Merged:
  > **JD 적합도 판정:** 필수요건 5개 중 Missing 0 · Weak 1. 가장 먼저 고칠 곳은 이력서 맨 위의 요약입니다. 지금은 요약이 없으니 새로 넣으면 됩니다.
- Baseline (**counted**):
  > **JD 적합도 판정:** must-have 5개 중 Missing 0 · Weak 1 (RDBMS 설계·쿼리 튜닝) — 최우선 변경: 경력기술서 맨 위에 결제·정산 경력과 Kafka 전환 성과로 시작하는 Profile 요약을 새로 넣기

### Attempt 3 (merged only, on the final skill text; **counted**)

- Merged:
  > **JD 적합도 판정:** must-have 5개 중 Missing 0 · Weak 1 (RDBMS 설계) — 최우선 변경: 이력서 맨 위에 Profile / Summary를 새로 만든다. 지금 이력서에는 요약이 없어서, 이미 가진 결제·정산, Kafka 비동기 처리, 쿼리 튜닝 근거가 bullet 사이에 흩어져 있다.

### Result (merged attempt 3 vs baseline attempt 2)

| Check | Merged | Baseline | Same? |
|---|---|---|---|
| Missing / Weak | 0 / 1 (RDBMS 설계) | 0 / 1 (RDBMS 설계·쿼리 튜닝) | yes |
| 최우선 변경 area | Profile / Summary 신설 | Profile 요약 신설 | yes |
| 'API 응답속도 개선' | `[확인 필요: 대상 API와 개선 전/후 수치. 주문 API p95 건과 같은 성과라면 이 줄 삭제] 응답속도 성능 개선` (After) | folded into the p95 bullet, with the stand-alone form `"[확인 필요: 대상 API] 응답속도 개선 [확인 필요: 개선 전/후 수치]"` if it is a different API | yes, both mark the number (baseline puts it in a note under the After, not in the After block) |
| '820ms → 310ms' in After | `주문 API p95 응답시간 820ms → 310ms 단축(3개월)` | `p95 응답시간 820ms → 310ms 단축 (3개월)` | unchanged in both |
| '4시간 → 40분' in After | `일 정산 처리 시간 4시간 → 40분 단축` | `일 정산 처리 시간 4시간 → 40분 단축` | unchanged in both |
| First block / last block (merged) | `JD 적합도 판정:` line / `## What NOT to Change` | — | yes |

In every attempt, all four runs gave Missing 0 · Weak 1, and none invented a percentage, scale figure or skill (Kotlin, MSA and 전자금융거래법 were left out or marked `[확인 필요]` everywhere).

## (ii) No-JD mode — merged skill vs `cbdfcd6:portfolio-rewrite` on (a) under (c)

User prompt, both sides: "이 경력기술서 문장들 더 임팩트 있게 고쳐줘." + (a). No posting, no company.

The merged no-JD side was run twice: once on the first draft and once on the final text (**counted**). The edits between them touched only JD-mode text.

- Merged, final (**counted**), diagnosis for 'API 응답속도 개선':
  > **진단 / Diagnosis**: 네 요소(X·Y·Z·S)가 모두 비어 있습니다. 어떤 API를, 얼마나, 어떻게 개선했는지가 없습니다.

  After: `[확인 필요: 대상 API] 응답시간 [확인 필요: 측정 지표와 개선 전/후 수치] 단축: [확인 필요: 적용한 조치]`
- Merged, first draft:
  > **진단:** X만 있고 Y·Z·S가 모두 없습니다. 어떤 API인지, 얼마나 빨라졌는지, 무엇을 했는지가 빠져 있습니다.
- Baseline:
  > **진단 / Diagnosis:** 어떤 API인지, 결과 수치(Y), 한 일(Z), 맥락(S)이 모두 빠져 있습니다. 결과 없이 활동 이름만 남은 상태입니다.

  After: `[확인 필요: 대상 API] 응답시간 [확인 필요: 측정 지표와 개선 전/후 수치] 단축 ([확인 필요: 적용한 조치])`

| Check | Merged (final) | Baseline | Same? |
|---|---|---|---|
| Missing XYZ+S element for 'API 응답속도 개선' | Y (metric), Z and S; the target API is unnamed | Y (metric), Z and S; the target API is unnamed | yes |
| Number/cause/scope absent from (a) introduced | none. The Rewriter note flags a possible duplicate of the p95 line and does not borrow 820→310 | none. The note says explicitly that it did not borrow 820→310 or turn it into a % | yes |
| '820ms → 310ms', '4시간 → 40분' identical Before/After | yes | yes | yes |
| `JD 적합도 판정` line / gap table | absent / absent | absent / absent | — |
| PR7 block order per passage | 진단 → Before → After → 왜 더 강해졌는가 → Rewriter note; [확인 필요 질문] and [확정] collected at the end | same, with questions per passage | yes (the template allows either placement) |

Other diagnosis lines, merged final vs baseline:
- 결제 모듈: "주도권이 드러나지 않습니다(\"참여\", \"기여\"). Y도 없이 \"코드 품질 향상\"이라는 추상어로 끝납니다." vs "본인 역할이 수동적이고(\"참여하여 기여\"), 결과 수치(Y) 없이 \"코드 품질 향상\"이라는 막연한 표현으로 끝납니다."
- 정산 배치: "수치와 주도권은 있습니다. 왜 배치를 이벤트 처리로 바꿨는지(판단)가 빠져서…" vs "X·Y·Z와 본인 역할은 있습니다. 기존 배치의 문제(S)와 Kafka를 고른 이유가 빠졌습니다."
