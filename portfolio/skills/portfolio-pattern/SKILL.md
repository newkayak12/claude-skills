---
name: portfolio-pattern
description: >-
  Use when someone wants to understand the writing patterns in their portfolio —
  not what it says but how it reads: passive voice ratio, subject audit, number
  density, and decision visibility. Triggers on: "패턴 분석해줘", "오너십이 잘 드러나나", "피동형
  많이 썼나".
scenarios:
  - "Analyze the writing patterns in my portfolio — do I show ownership clearly?"
  - "How much passive voice am I using and how does it affect my portfolio?"
  - "Do my impact claims have numbers or are they all vague?"
  - "내 포트폴리오 주어 비율 분석해줘"
  - "오너십이 잘 드러나는지 패턴 분석 해줘"
compatibility:
  recommended:
    - think-tool
    - mcp-reasoner
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 각 차원 분석 전 필수 체크포인트로 사용됩니다 — 애매한 경우에만 쓰는 것이 아니라 모든 차원에서 사전 호출합니다.
    mcp-reasoner는 소유권 분류(개인 오너십 / 팀 크레딧 / 소유권 회피)가 경합할 때 판단에 사용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio Writing Pattern Analyzer

## Standing Mandates

- ALWAYS lead with the judgment. The one-line signal verdict and the most important finding come first; per-dimension tallies, Top 3 and fixes follow.
- ALWAYS tally, never adjective. Every ratio has a numbered list of sentences behind it in your working — a ratio you cannot list is not reported.
- NEVER supply a fact. A fix shows *where* and *what shape*; when the number, alternative, cause or context is not in the text, write `[확인 필요: ○○]` and stop. No 역산, no candidate values. "API 응답속도 개선" comes out with `[확인 필요: 개선 전/후 수치]`, not "40% 개선".
- NEVER fire a flag on a boundary value. The ~20% decision-verb and 60% number-free thresholds are provisional (잠정): set from eval fixtures, not screening research, and never presented as industry numbers. A flag fires only when the value is at least 10 points past the threshold *and* one entry moving would not bring it back. Otherwise the tally line reads `경계 (58%, 기준 ~60%)` — in general `경계 (값, 기준 ~N%)` — and no flag is raised.
- NEVER measure the `저는/제가` rate (see Subject Audit).

**Not for** rewriting weak sections (`portfolio-rewrite`), overall quality scoring (`portfolio-feedback`), or JD keyword matching (`jd-fit`).

Input: the portfolio text (paste or upload); Korean fully supported.

## Process

1. **Map the dimensions** — subject audit, agency language, number density, failure narrative, decision visibility, verb energy.
2. **Detect patterns** — tally each dimension; think-tool before every dimension, mcp-reasoner on contested ownership.
3. **Calculate ratios** — decision-verb rate, passive rate, number-free impact claim rate; apply the boundary rule before any flag.
4. **Identify top 3 patterns** — which most hurt (or help) the impression, each with a quoted example.
5. **Produce per-pattern fixes** — exactly which sentence to change and into what shape, facts left as `[확인 필요: ○○]`.

### Stage 1 — Map the Patterns (Sequential Thinking)

Call `sequentialthinking` to plan before reading closely: which dimensions signal ownership and seniority; what counts as passive in Korean technical writing (되었습니다, 구현했습니다 with a team subject); how to tally systematically rather than anecdotally.

### Stage 2 — Pattern Detection (Think Tool — Required per Dimension)

Call `think` **before analyzing each of the 6 dimensions** — not only when something is ambiguous:

```
think: "What would this dimension look like if the candidate had strong ownership?
What does this portfolio actually show?
Am I seeing a real pattern or a single salient example?
Is the ratio a boundary value?"
```

Call `mcp-reasoner` (beam_search, beamWidth=3) when a passage has competing ownership signals:
- Beam A: 개인 오너십 — the candidate is clearly the decision-maker and actor
- Beam B: 팀 크레딧 — appropriate acknowledgment of collaborative work
- Beam C: 소유권 회피 — collective language used to obscure weak personal contribution

This matters most for Subject Audit and Agency Language.

> 🧠 **Pattern note**: Record non-obvious judgments inline — especially when mcp-reasoner changed the classification.

### Dimensions to Analyze

**1. Subject Audit.** Who is doing things in each sentence:
- **"저희 팀이 / 팀에서"** — team credit where the individual contribution is unclear (flag when it dominates)
- **No subject, active** — "제안했습니다", "채택했습니다" (normal Korean; not a defect)
- **No subject, passive** — "구현되었습니다", "도입되었습니다" (flag)

**Do not measure the `저는/제가` rate.** Subject omission is standard in 국문 경력기술서, and well-written ones sit near 0% — a pronoun threshold flags documents whose ownership is strong, exactly backwards. What separates an owner from an executor is the **verb**: count action sentences carrying a decision verb (제안 / 채택 / 배제 / 결정 / 도입 판단) and report that ratio. Clearly under ~20% (provisional; boundary rule applies) is the signal — the candidate built what they were told and never says who chose it.

**2. Agency Language.** Flag sentences where the candidate is acted upon:
- Passive constructions: ~되었습니다, ~되었고, ~되어
- Vague participation: "관여했습니다", "참여했습니다", "기여했습니다" (without saying what)
- Directed work: "맡았습니다" without why they were chosen or what they decided

**3. Number Density.** How many impact claims carry a concrete number:
- With: "응답시간 40% 감소", "MAU 12만 → 80만"
- Without: "성능 개선", "대용량 트래픽 처리", "안정적인 서비스 운영"

Report the ratio. For a 5+ year portfolio, a number-free rate clearly above 60% (provisional; boundary rule applies) is a problem.

**4. Failure Narrative.** Scan for incidents and what was done, wrong decisions and the recovery, technical debt acknowledged, trade-offs stated. Complete absence across multiple years is itself a signal — not introspective, or evasive.

**5. Decision Visibility.** Can you see choices being made? "A 대신 B를 선택한 이유는...", "당시 옵션은 X, Y, Z였고 Y를 선택했는데...", "돌아보면 이 결정이 좋지 않았던 이유는...". Every tech choice presented as obvious or pre-decided is a pattern worth flagging.

**6. Verb Tense and Energy.** Note whether it reads like a status report or a story, and whether verbs are specific ("설계했다", "디버깅했다", "제안했다") or generic ("했습니다", "진행했습니다").

## Output Template

Write the analysis in Korean:

---

**[시그널 요약]**
One line: what this writing pattern tells an interviewer before they read the content. Then the single most important finding, with its tally.

---

**[항목별 분석]**
- **의사결정 동사 비율**: [n/m = n% — flag, or `경계 (값, 기준 ~20%)`]
- **수동/피동 표현**: [count, examples]
- **숫자 밀도**: [number-free n/m = n% — flag, or `경계 (값, 기준 ~60%)`]
- **실패/어려움 서술**: [present / minimal / absent — examples]
- **의사결정 가시성**: [visible vs. implied decisions]
- **동사 에너지**: [flat / moderate / active — examples]

Insert `🧠 Pattern note` where a finding required non-obvious judgment.

---

**[가장 자주 나타나는 패턴 Top 3]**
The three patterns that most hurt (or help) the impression, each with a quoted example from the text.

---

**[패턴별 개선 제안]**
For each flagged pattern: one concrete fix that changes shape, never adds a fact. Not "use more active voice" but "'팀에서 Kafka를 도입했습니다'를 '`[확인 필요: 검토한 대안]`을 비교해 Kafka를 채택했습니다'로 바꿔, 누가 무엇을 근거로 정했는지 드러내세요."

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Audits 6 dimensions: subject audit, agency language, number density, failure narrative, decision visibility, verb energy | Provides the portfolio text |
| Calculates ratios and marks boundary values `경계` instead of flagging | Validates findings against your actual intent |
| Identifies top 3 patterns with quotes and one fix each, missing facts as `[확인 필요]` | Fills the `[확인 필요]` facts and decides what to rewrite (or uses portfolio-rewrite) |

## Related Skills

- `../portfolio-rewrite/SKILL.md` — act on the patterns identified here
- `../portfolio-feedback/SKILL.md` — overall assessment alongside pattern analysis
- `../jd-fit/SKILL.md` — after improving patterns, check fit against a specific JD
