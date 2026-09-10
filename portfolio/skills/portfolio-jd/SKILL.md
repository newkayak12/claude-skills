---
name: portfolio-jd
effort: high
description: >-
  Use when someone provides both a portfolio and a specific job description and
  wants to know how well they match — gap analysis, fit score, and positioning
  advice for that exact role. Triggers on: "이 공고에 맞아?", "JD랑 비교해줘", "이 포지션 지원해도
  돼?".
scenarios:
  - "Compare my portfolio to this job description — where are the gaps?"
  - "I want to apply to this JD — how well does my portfolio match and what should I fix?"
  - "Score my portfolio against this job posting across tech stack, scale, and role scope"
  - "이 공고에 내 포트폴리오가 맞는지 갭 분석해줘"
  - "이 JD랑 포트폴리오 비교해서 서류 통과 가능성 알려줘"
compatibility:
  recommended:
    - think-tool
    - mcp-reasoner
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 JD 파싱(Stage 1)과 포트폴리오 파싱(Stage 2)에서 필수 체크포인트로 사용됩니다.
    mcp-reasoner는 갭 심각도 분류(치명/보완 가능/마이너)와 서류 통과 가능성 판단에 사용됩니다 — 이 두 가지가 이 스킬의 가장 중요한 판단입니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio × JD Gap Analyzer

## Standing Mandates

- ALWAYS build the JD profile before opening the portfolio, and the candidate profile without the JD in view. Comparing while parsing bends the JD toward whatever the portfolio happens to contain — the two profiles must be able to disagree.
- ALWAYS split must-have from nice-to-have before scoring anything, and say which line of the JD put each one on which side. A missing nice-to-have never moves the verdict, and a missing must-have is never averaged away by four strong dimensions.
- ALWAYS read a requirement against the company's size and stage. "Kubernetes experience preferred" at a 10-person startup and at a 200-person platform team are different requirements; the same phrase gets a different weight and the analysis says why.
- ALWAYS quote both sides — the JD line and the portfolio line — for every match and every gap. A gap with a citation on only one side is a guess, and it is not reported.
- ALWAYS classify each gap 치명적 / 보완 가능 / 마이너 with what closing it actually takes and how long. An unclassified gap is not advice the candidate can act on before the deadline.
- NEVER count a technology named in a Skills list as a match. Evidence is a bullet that uses it in context; a listed-but-unused technology is a gap the interviewer will find first.
- NEVER let adjacent experience pass as an exact match. Label it adjacent, and name the one piece of evidence that would upgrade it.
- NEVER supply the candidate's missing fact. When a number, scale, or context is not in the portfolio, write `[확인 필요: ○○]` and stop — no 역산, no plausible value.
- NEVER round a weak match up to "apply anyway". 서류 통과 / 경계 / 스크린아웃 is stated plainly with what it hinges on, and 스크린아웃 is a legitimate output of this skill.
- Goal: every analysis ends with one line the candidate can re-check against the JD — `판정 <통과|경계|스크린아웃> · 5개 차원 n/10 · 치명적 n · 보완 가능 n · 마이너 n · must-have 미충족 n/m`.

## When to Use / When Not to Use

**Use when:**
- You have both a portfolio and a specific JD and want an honest match assessment
- You need to understand which gaps are critical vs. recoverable before applying
- You want concrete advice on how to position your portfolio for this specific role

**Not for:**
- Company type matching without a specific JD (use portfolio-company)
- Resume keyword tailoring (use resume-tailorer)
- General portfolio improvement not tied to a specific role (use portfolio-feedback)

## Process

1. **Parse the JD** — real requirements vs. aspirational; must-haves; actual role behind the title; team pain point
2. **Parse the portfolio** — 3 clearest strengths; 2-3 significant gaps; what it communicates well vs. fails to communicate
3. **Structured comparison** — map portfolio signals to JD requirements; weight must-haves vs. nice-to-haves
4. **Score 5 fit dimensions** — tech stack, experience scale, role scope, domain, soft signals
5. **Gap analysis** — each gap classified: critical / recoverable / minor + how to address
6. **Positioning advice** — what to emphasize, downplay, or add before applying to this specific role
7. **Pass/borderline/screen-out assessment** — honest probability judgment with what it hinges on

## Standalone Inputs

Provide:
1. Your portfolio (paste, upload, or describe key sections)
2. The full JD text (the more complete, the better)
3. Optionally: company name/stage and target role level

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Decodes JD: real requirements vs. aspirational nice-to-haves | Provides the actual portfolio content |
| Scores fit across 5 dimensions with evidence | Validates gap assessment with network contacts if possible |
| Classifies each gap: critical / recoverable / minor | Decides whether to apply and what to change |
| Gives concrete portfolio positioning advice for this specific role | Makes actual application decision |
| Gives honest pass/borderline/screen-out assessment | Does the relationship building to get referrals |

## Related Skills

- `../portfolio-rewrite/SKILL.md` — act on specific gap areas identified here
- `../resume-tailorer/SKILL.md` — keyword-align the resume after positioning advice
- `../portfolio-company/SKILL.md` — company type fit analysis if no specific JD yet

---

## Stage 1 — Parse the JD (Think Tool — Required)

Call `think` before reading the portfolio. Build the JD profile independently first — comparing too early biases the analysis toward the portfolio's framing.

Required questions:
- What are the **real** requirements vs. aspirational? (JDs inflate nice-to-haves into requirements constantly)
- What are the **must-haves** — what would cause immediate rejection?
- What is the **actual role** behind the title? ("Senior backend engineer" at a 15-person Series A ≠ the same at a 500-person platform team)
- What signals is this team encoding that aren't stated explicitly? ("Strong communicator" usually means they've been burned by someone who wasn't)
- What pain point is this hire meant to solve?

> 🧠 **JD note**: Record decoded profile here. "The role is actually looking for X, not just Y as stated."

---

## Stage 2 — Parse the Portfolio (Think Tool — Required)

Call `think` to build the candidate profile independently of the JD. Do not reference the JD yet.

Required questions:
- What are the candidate's 3 clearest strengths?
- What are the 2–3 most significant gaps or weaknesses?
- What does this portfolio communicate well — and what does it fail to communicate?
- What level and type of role does this portfolio naturally speak to?

> 🧠 **Portfolio note**: Record candidate profile here. This is your independent read before the comparison.

---

## Stage 3 — Structured Comparison (Sequential Thinking)

Call `sequentialthinking` to plan how to map portfolio signals to JD requirements systematically:
- How will you handle requirements that the portfolio addresses partially?
- How will you weight must-haves vs. nice-to-haves?
- What is the overall fit narrative — does this portfolio tell the story this JD is looking for?

---

## Fit Dimensions

Evaluate across these dimensions:

**기술 스택 매칭**
Does the candidate's tech experience overlap with what the JD requires? Note exact matches, adjacent experience (transferable), and gaps.

**경험 연차 / 스케일 매칭**
Does the candidate's scale of experience match what the role implies? A JD saying "large-scale systems experience preferred" is telling you something.

**역할 범위 매칭**
Does the JD expect an IC who executes, or a senior who leads and influences? Does the portfolio show the right kind of contribution?

**도메인 매칭**
Is there relevant domain experience (fintech, e-commerce, infra, data platforms, etc.)? Domain mismatch is often recoverable, but it should be acknowledged.

**소프트 시그널 매칭**
JDs often encode cultural expectations. "Proactive", "ownership", "self-directed" are different from "collaborative", "process-oriented", "strong communicator." Does the portfolio's writing style match the cultural signal?

---

## Output Structure

Write in Korean. Use this structure:

---

**[역할 해석]**
What is this role actually looking for, beyond what the JD literally says? 3–5 sentences.

---

**[종합 매칭 점수]**
**X / 10** — one sentence explanation of the score.

Break down as:
- 기술 스택: X/10
- 경험 스케일: X/10
- 역할 범위: X/10
- 도메인: X/10
- 소프트 시그널: X/10

Insert `🧠 JD note` where any score required a non-obvious judgment.

---

**[강한 매칭 포인트]**
What in the portfolio directly speaks to this JD. Quote or reference specific portfolio content and the specific JD requirement it addresses.

---

**[갭 분석]**
Where the portfolio falls short for this specific role.

For each gap, call `mcp-reasoner` (beam_search, beamWidth=3) before assigning severity:
- Beam A: 치명적 — missing a must-have; rejection likely regardless of other strengths
- Beam B: 보완 가능 — real gap but addressable in the cover letter, portfolio framing, or interview
- Beam C: 마이너 — nice-to-have miss; unlikely to affect screening

For each gap:
- 갭: [what's missing or underrepresented]
- 심각도: 치명적 / 보완 가능 / 마이너
- 근거: [why this severity — what makes it critical vs. recoverable]
- 대응 방법: [how to address in the portfolio, cover letter, or interview]

---

**[포트폴리오 포지셔닝 조정]**
If the candidate applies, how should they frame their experience for *this specific role*? What to emphasize, what to downplay, what to add to the portfolio or cover letter before applying.

Concrete: "이 JD는 데이터 파이프라인 경험을 중요하게 보는데, 포트폴리오에서 [프로젝트명]의 ETL 작업을 현재보다 더 앞에 배치하고, 처리한 데이터 볼륨을 명시하세요."

---

**[서류 통과 가능성 평가]**

Call `mcp-reasoner` (mcts, numSimulations=50) for this judgment — it is the highest-stakes single output of this skill and the one most likely to have competing evidence.

Honest assessment: likely pass / borderline / likely screen out — and what that hinges on.

State the one factor that, if changed, would most shift this assessment in either direction.

---

**[지원 여부 조언]**
Should they apply? If yes, with what changes? If borderline, what's the one thing that would tip it?

---

## Rules

- Decode the JD honestly — don't just match keywords. A JD that says "Kubernetes experience preferred" at a 10-person startup is very different from the same phrase at a platform team of 200.
- Distinguish must-haves from nice-to-haves. Missing a must-have is different from missing a nice-to-have.
- Be specific: reference actual text from both the JD and the portfolio in your analysis.
- Use `think` whenever a match or gap is ambiguous — adjacent experience, partial domain overlap, or transferable skills all need careful judgment.
- Don't sugarcoat poor fits. "You should still apply" when the match is weak is not helpful advice.
