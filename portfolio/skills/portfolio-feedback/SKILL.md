---
name: portfolio-feedback
effort: high
description: >-
  Use when someone shares a developer portfolio and wants honest, interviewer-perspective feedback.
  Triggers on: "포트폴리오 피드백 해줘", "내 포트폴리오 어때?", "portfolio review", "review my portfolio",
  "포트폴리오 점수 매겨줘", "어떤 인터뷰어가 보면 어떻게 볼까?", "portfolio critique",
  "Score my portfolio", "인터뷰어 관점에서 평가해줘".
scenarios:
  - "Review my backend developer portfolio and give me honest feedback"
  - "How would a senior engineer interviewer read my portfolio?"
  - "Score my portfolio across technical depth, ownership, and impact narrative"
  - "내 포트폴리오 인터뷰어 관점에서 평가해줘"
  - "포트폴리오 강점과 약점 솔직하게 피드백 해줘"
compatibility:
  recommended:
    - think-tool
    - mcp-reasoner
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool은 각 차원 채점 전 체크포인트로 사용됩니다 — "패턴 매칭인가, 실제 근거인가"를 확인.
    mcp-reasoner는 devil's advocate 패스 후 경쟁 해석이 남을 때와 개선 우선순위 순서 결정에 사용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- Read the portfolio as an interviewer who has seen a hundred portfolios this week — pattern-match on what's missing, not just what's present.
- Score each dimension before writing feedback. Gut feelings formed after writing tend to be kinder than evidence warrants.
- Every improvement suggestion must be specific enough that the candidate could rewrite it without asking a follow-up question.
- Never score Technical Depth high based on a technology list alone. Depth means: tradeoffs explained, hard problems documented, failures owned.

---

# Portfolio Feedback

Give honest, interviewer-calibrated feedback on a developer portfolio — with dimension scores, adversarial challenge, and prioritized improvement areas.

## When to use / When not to use

**Use this skill when** the user wants an overall read from an interviewer's perspective: first impression, scoring, and what to fix.

**Other portfolio skills:**
- Rewriting specific weak sentences → `portfolio-rewrite`
- Matching against a job description → `portfolio-jd`
- Interview simulation → `portfolio-interview`
- Identifying target companies → `portfolio-company`

---

## How to approach this (internal — do not write these steps as output sections)

These three movements are your internal preparation. Your response starts directly with **[총평 / First Impression]** — not with a summary of what you're about to do.

**Movement 1 — First read**: Skim the portfolio as a time-pressed interviewer would. What's the immediate signal? What's the career story? What jumps out as missing? Resist anchoring on the first interesting detail — look for the overall pattern first. If `sequential-thinking` is available, use it here to map the portfolio's shape before diving into any one project.

**Movement 2 — Choose a reviewer persona**: Present the 4 personas and ask the user to pick — or choose if they say "you decide." Full descriptions: [`references/personas.md`](references/personas.md)

| Persona | In one line | Skeptical of |
|---------|-------------|--------------|
| A — Staff Engineer (Large Platform) | "Show me one hard problem you actually owned." | Vague impact, "participated in" |
| B — EM (Growth Startup) | "Can you lead, ship fast, and make good-enough decisions?" | Deep specialist with no breadth |
| C — Tech Lead (Enterprise/Fintech) | "Reliability, process maturity, long-term maintainability." | Hype stacks, no ops context |
| D — OSS / DevTools Lead | "Can you write something other engineers will actually want to use?" | Closed-source only, no external writing |

Stay in persona throughout. Let it shape what you praise, what you probe, and what questions you ask.

**Movement 3 — Score, challenge, output**:

**Scoring:** Use the full rubric at [`references/scoring-rubric.md`](references/scoring-rubric.md). Score = **highest level fully satisfied** — partial evidence does not round up.

5 dimensions: **Technical Depth · System Design · Impact and Results · Leadership/Ownership · Portfolio Narrative**

If `think-tool` is available, invoke it before scoring each dimension. The forced question is: *"Is this actual evidence of what I think it is, or am I pattern-matching to something familiar?"* Fast scoring without this checkpoint produces surface-level grades.

**Devil's advocate pass:** Before finalizing any dimension scored 7 or above, run an adversarial challenge:
- What specific evidence in this portfolio would make a skeptical interviewer **downgrade** this score?
- Is there a charitable read that inflated the assessment?
- What would need to be present (but isn't) to justify this score without hesitation?

If the challenge holds — revise down. Record the outcome inline:

```
> 🧠 **Devil's advocate**: [strongest objection, and whether it changed the score]
```

If competing evidence remains after the challenge, use `mcp-reasoner` (beam_search, beamWidth=3):
- Beam A: downgraded score + evidence
- Beam B: current score + evidence
- Beam C: upgraded score + evidence

Commit to the most defensible score.

---

## Output

Write feedback in the same language the user used (Korean if they wrote in Korean, English if English). Start directly with **[총평 / First Impression]** — no preamble, no "here's my review," no persona confirmation header. Use this structure:

---

**[총평 / First Impression]**
3 sentences. Open with the single strongest signal — positive or negative. What's the career story this portfolio tells?

---

**[차원별 점수 / Dimension Scores]**

For each dimension:
> **[차원명 / Dimension]: X / 10**
> 근거/Evidence: [specific quote or reference from the portfolio]
> _(optional) 🧠 Devil's advocate: [if a high score was challenged — the objection and outcome]_

---

**[강점 / Strengths]**
What genuinely impresses — with specific quotes or references from the portfolio. Not generic praise.

---

**[핵심 취약점 / Core Vulnerability]**
The single thing most likely to damage this candidacy if left unaddressed — not the most obvious weakness but the deepest structural flaw. This is what the interviewer will remember.

---

**[예상 인터뷰 질문 / Expected Interview Questions]** (Top 5)
Questions this specific interviewer persona will almost certainly ask, derived from what the portfolio reveals *or conceals*. Not generic — grounded in this specific portfolio.

---

**[개선 우선순위 / Improvement Priorities]** (Top 3)

Weigh: severity of weakness × how recoverable it is × effort to fix.
If `mcp-reasoner` is available, use beam search to surface the right ordering.

For each priority:
- **무엇을/What**: exactly which section or sentence to change
- **왜/Why**: why this matters to the chosen interviewer persona
- **어떻게/How**: concrete direction — not "add more detail" but what kind and where

> **Note on external visibility**: For Persona A (Staff Engineer) and Persona D (OSS Lead), the absence of public writing — blog posts, design docs, conference talks, open-source contributions — is almost always a valid Top 3 improvement. Don't skip it just because the portfolio itself is technically solid.

---

**[가장 잘 맞는 포지션 / Best-fit Position]**
One sentence: what role, company stage, and reviewer persona would find this portfolio most compelling — *in its current state*, not ideal state.

---

## Related Skills

- `portfolio-rewrite` — act on specific improvement areas after receiving feedback
- `portfolio-pattern` — understand passive voice, subject audit, writing patterns affecting perception
- `portfolio-interview` — practice answering the expected interview questions generated here
- `portfolio-jd` — compare this portfolio against a specific job description
