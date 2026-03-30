---
name: portfolio-pattern
description: >-
  Use when someone wants to understand the writing patterns in their portfolio — not what it says but how it reads: passive voice ratio, subject audit, number density, and decision visibility.
  Triggers on: "패턴 분석해줘", "오너십이 잘 드러나나", "피동형 많이 썼나", "주어 분석", "writing pattern analysis", "ownership signal audit", "how does my writing come across".
  Best for: understanding narrative habits that hurt ownership perception; diagnosing passive voice, vague agency, and number-free impact claims before rewriting.
  Not for: rewriting specific sentences (use portfolio-rewrite), overall quality scoring (use portfolio-feedback), JD-specific positioning (use portfolio-jd).
scenarios:
  - "Analyze the writing patterns in my portfolio — do I show ownership clearly?"
  - "How much passive voice am I using and how does it affect my portfolio?"
  - "Do my impact claims have numbers or are they all vague?"
  - "내 포트폴리오 주어 비율 분석해줘"
  - "오너십이 잘 드러나는지 패턴 분석 해줘"
compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 "우리 팀이 구축했습니다"가 적절한 팀 크레딧인지 수동적 소유권 회피인지
    구분하는 판단 품질이 높아집니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio Writing Pattern Analyzer

## When to Use / When Not to Use

**Use when:**
- Wanting to understand how your writing reads to an interviewer before making changes
- Diagnosing patterns: passive voice, vague participation language, number-free impact claims, missing decision visibility
- You've received feedback that your portfolio lacks "ownership" but don't know where

**Not for:**
- Rewriting specific weak sections (use portfolio-rewrite)
- Overall portfolio quality scoring (use portfolio-feedback)
- JD-specific keyword matching (use portfolio-jd)

## Process

1. **Map the dimensions** — identify which patterns to analyze: subject ratio, agency language, number density, failure narrative, decision visibility, verb energy
2. **Detect patterns** — tally each dimension; flag ambiguous cases with think-tool
3. **Calculate ratios** — subject frequency (저는/제가 vs. 팀이 vs. passive); number-free impact claim rate
4. **Identify top 3 patterns** — which most hurt (or help) this portfolio's impression; quote specific examples
5. **Produce per-pattern fixes** — concrete, specific rewrites: not "use active voice" but exactly which sentence to change and how

## Standalone Inputs

Provide: your portfolio text (paste or upload). Korean-language portfolios are fully supported.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Audits 6 dimensions: subject ratio, agency language, number density, failure narrative, decision visibility, verb energy | Provides the portfolio text |
| Calculates approximate ratios (subject frequency, number-free impact claims) | Validates findings against your actual intent |
| Identifies top 3 patterns hurting (or helping) the portfolio | Decides which patterns to address in a rewrite |
| Gives one concrete fix per flagged pattern | Executes the rewrites (or uses portfolio-rewrite) |

## Related Skills

- `../portfolio-rewrite/SKILL.md` — act on the patterns identified here
- `../portfolio-feedback/SKILL.md` — overall assessment alongside pattern analysis
- `../portfolio-jd/SKILL.md` — after improving patterns, check fit against a specific JD

---

## Stage 1 — Map the Patterns (Sequential Thinking)

Call `sequentialthinking` to plan the analysis before reading the text closely.

Think through:
- What dimensions of writing signal ownership and seniority?
- What counts as "passive voice" in Korean technical writing specifically? (되었습니다, 구현했습니다 with team subject, etc.)
- How will you tally patterns systematically vs. anecdotally?
- What is the most useful way to present findings — list, table, annotated excerpt, or summary?

---

## Stage 2 — Pattern Detection (Think Tool at Key Moments)

Call `think` when you encounter:
- An ambiguous case: Is "우리 팀이 구축했습니다" passive ownership or appropriate team credit?
- A pattern that seems intentional (every project description uses "저는" — is that overcompensation?)
- Something you can't categorize cleanly

> 🧠 **Pattern note**: Record non-obvious judgments inline.

---

## Dimensions to Analyze

### 1. Subject Audit
Track who is doing things in each sentence:
- **"저는 / 제가"** — direct individual ownership (positive)
- **"저희 팀이 / 팀에서"** — team credit (neutral; fine in moderation)
- **No subject / passive** — "구현되었습니다", "도입되었습니다" (flag)

Calculate an approximate ratio. A senior portfolio where fewer than 40% of action sentences have "저는/제가" as subject is a signal worth calling out.

### 2. Agency Language
Flag sentences where the candidate is acted upon rather than acting:
- Passive constructions: ~되었습니다, ~되었고, ~되어
- Vague participation: "관여했습니다", "참여했습니다", "기여했습니다" (without saying what)
- Directed work: "맡았습니다" without explaining why they were chosen or what decisions they made

### 3. Number Density
Count how many impact claims have a concrete number attached:
- With number: "응답시간 40% 감소", "MAU 12만 → 80만"
- Without: "성능 개선", "대용량 트래픽 처리", "안정적인 서비스 운영"

Report the ratio. For a 5+ year portfolio, a number-free impact claim rate above 60% is a problem.

### 4. Failure Narrative Presence
Senior engineers have war stories. Scan for:
- Incident descriptions and what was done
- Decisions that turned out to be wrong and how they recovered
- Technical debt acknowledged and addressed
- Trade-offs explicitly stated

Complete absence of failure or difficulty in a multi-year portfolio is itself a signal — either the candidate is not introspective, or they're being evasive.

### 5. Decision Visibility
Can you see the candidate making choices? Look for:
- "A 대신 B를 선택한 이유는..."
- "당시 옵션은 X, Y, Z였고 우리는 Y를 선택했는데..."
- "돌아보면 이 결정이 좋지 않았던 이유는..."

If every tech choice is presented as obvious or pre-decided, that's a pattern worth flagging.

### 6. Verb Tense and Energy
Korean technical writing often defaults to a flat, report-like register. Note if:
- The portfolio reads like a status report vs. a story
- Action verbs are specific ("설계했다", "디버깅했다", "제안했다") or generic ("했습니다", "진행했습니다")

---

## Output Structure

Write the analysis in Korean. Use this structure:

---

**[패턴 분석 요약]**
A 3–5 sentence overview of what the portfolio's writing pattern signals to an interviewer. Start with the most important finding.

---

**[항목별 분석]**

For each dimension:
- **주어 비율**: [ratio, short interpretation]
- **수동/피동 표현**: [count or estimate, examples]
- **숫자 밀도**: [ratio — how many claims have numbers]
- **실패/어려움 서술**: [present / minimal / absent — examples]
- **의사결정 가시성**: [how many decisions are visible vs. implied]
- **동사 에너지**: [flat / moderate / active — examples]

Insert `🧠 Pattern note` where a finding required non-obvious judgment.

---

**[가장 자주 나타나는 패턴 Top 3]**
The three patterns that most hurt (or help) this portfolio's impression. Concrete, with a quoted example from the text.

---

**[패턴별 개선 제안]**
For each flagged pattern: one concrete fix. Not "use more active voice" — but "이 문장의 주어를 '저희 팀이'에서 '제가'로 바꾸고, 본인이 실제로 한 결정을 명시하세요."

---

**[시그널 요약]**
What does this writing pattern say about the candidate to an interviewer — even before they read the content?
