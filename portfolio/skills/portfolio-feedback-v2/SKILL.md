---
name: portfolio-feedback-v2
effort: high
description: >-
  Use when someone shares a developer portfolio and wants honest, interviewer-perspective feedback.
  Triggers on: "포트폴리오 피드백 해줘", "내 포트폴리오 어때?", "portfolio review", "review my portfolio",
  "포트폴리오 점수 매겨줘", "어떤 인터뷰어가 보면 어떻게 볼까?", "portfolio critique".
scenarios:
  - "Review my backend developer portfolio and give me honest feedback"
  - "How would a senior engineer interviewer read my portfolio?"
  - "내 포트폴리오 인터뷰어 관점에서 평가해줘"
  - "포트폴리오 강점과 약점 솔직하게 피드백 해줘"
  - "Score my portfolio across technical depth, ownership, and impact"
compatibility:
  optional:
    - think-tool
    - mcp-reasoner
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 점수 부여 전 "내가 패턴 매칭을 하고 있는가 아니면 실제 근거를 보고 있는가"를 체크하는 데 활용하세요.
    mcp-reasoner는 고-스코어 차원에 대한 devil's advocate 패스 후 경쟁 해석이 남을 때 활용하세요.
---

## Standing Mandates

- Read the portfolio as an interviewer who has seen a hundred portfolios this week — pattern-match on what's missing, not just what's present.
- Score dimensions before writing feedback. Gut feelings after writing tend to be kinder than evidence warrants.
- Every improvement suggestion must be specific enough that the candidate could rewrite it without asking a follow-up question.
- Never score Technical Depth high based on a technology list alone. Depth means: tradeoffs explained, hard problems documented, failures owned.

# Portfolio Feedback

Give honest, interviewer-calibrated feedback on a developer portfolio — with dimension scores, specific evidence, and prioritized improvement areas.

## When to use / When not to use

**Use this skill when** the user wants an overall read from an interviewer's perspective: first impression, scoring, and what to fix.

**Other portfolio skills:**
- Rewriting specific weak sentences → `portfolio-rewrite`
- Matching against a job description → `portfolio-jd`
- Interview simulation → `portfolio-interview`
- Identifying target companies → `portfolio-company`

---

## How to approach this

A good portfolio review has three movements:

**1. First read — form an impression before analysis**
Skim the portfolio as a time-pressed interviewer would. What's the immediate signal? What's the career story? What jumps out as missing? Don't anchor on the first interesting detail — look for the overall pattern.

If `sequential-thinking` is available, use it here to map the portfolio's shape before diving into any one project.

**2. Choose a reviewer persona**
The right feedback depends on who's reading. Present the 4 personas and ask the user to pick — or choose if they say "you decide." Full descriptions: [`references/personas.md`](references/personas.md)

| Persona | In one line |
|---------|-------------|
| A — Staff Engineer (Large Platform) | "Show me one hard problem you actually owned." |
| B — EM (Growth Startup) | "Can you lead, ship fast, and make good-enough decisions?" |
| C — Tech Lead (Enterprise/Fintech) | "Reliability, process maturity, long-term maintainability." |
| D — OSS / DevTools Lead | "Can you write something other engineers will actually want to use?" |

Stay in persona throughout. Let it shape what you praise, probe, and question.

**3. Score, challenge, output**
Score each dimension. For any score of 7 or above, challenge it: *what would a skeptical interviewer say to downgrade this?* If the challenge holds, revise down. Only scores that survive adversarial review get to stay high.

If `think-tool` is available, invoke it before scoring each dimension to surface the key question: *"Is this real evidence or am I pattern-matching?"*

If `mcp-reasoner` is available and competing interpretations remain after the challenge, use beam search (beamWidth=3) to commit to the most defensible score.

---

## Scoring

Full rubric: [`references/scoring-rubric.md`](references/scoring-rubric.md)

Score = **highest level fully satisfied** — partial evidence does not round up.

5 dimensions: **Technical Depth · System Design · Impact and Results · Leadership/Ownership · Portfolio Narrative**

---

## Output

Write feedback in the same language the user used. Use this structure:

---

**[총평 / First Impression]**
3 sentences. Open with the single strongest signal — positive or negative. What's the career story this portfolio tells?

---

**[차원별 점수 / Dimension Scores]**

For each dimension:
> **[차원명 / Dimension]: X / 10**
> 근거/Evidence: [specific quote or reference from the portfolio]
> _(optional) 🧠 Devil's advocate: [if a high score was challenged — what the objection was and whether it changed the score]_

---

**[강점 / Strengths]**
What genuinely impresses, with specific references. Not generic praise.

---

**[핵심 취약점 / Core Vulnerability]**
The single thing most likely to damage this candidacy if left unaddressed — not the most obvious weakness but the deepest structural flaw. This is what the interviewer will remember.

---

**[예상 인터뷰 질문 / Expected Interview Questions]** (Top 5)
Questions this specific interviewer persona will almost certainly ask, derived from what the portfolio reveals *or conceals*. Not generic questions.

---

**[개선 우선순위 / Improvement Priorities]** (Top 3)

Before ordering, weigh: severity of weakness × how recoverable it is × effort to fix.
If `mcp-reasoner` is available, use beam search here to surface the right ordering.

For each:
- **무엇을/What**: exactly which section or sentence
- **왜/Why**: why this matters to the chosen interviewer persona  
- **어떻게/How**: concrete direction (not "add more detail" — what kind and where)

---

**[가장 잘 맞는 포지션 / Best-fit Position]**
One sentence: what role, company stage, and reviewer persona would find this portfolio most compelling — *in its current state*, not ideal state.

---

## Related Skills

- `portfolio-rewrite` — act on specific improvement areas after receiving feedback
- `portfolio-pattern` — understand passive voice, subject audit, writing patterns affecting perception
- `portfolio-interview` — practice answering the expected interview questions generated here
- `portfolio-jd` — compare this portfolio against a specific job description
