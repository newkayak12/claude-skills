---
name: portfolio-feedback
effort: high
description: >-
  Use when someone shares a portfolio and wants an overall assessment from an
  interviewer's perspective — overall impression, scoring across dimensions, and
  prioritized improvement areas. Triggers on: "포트폴리오 피드백 해줘", "내 포트폴리오 어때?",
  "portfolio review",
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
    think-tool은 각 차원 채점 전 필수 체크포인트로 사용됩니다.
    mcp-reasoner는 devil's advocate 패스 후 경쟁 근거가 남을 때 점수 최종 확정과 Top 3 우선순위 순서 결정에 사용됩니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---
## Standing Mandates

- ALWAYS read the portfolio as an interviewer would, not as the candidate wrote it.
- ALWAYS score each dimension before synthesizing overall feedback.
- NEVER give vague improvement advice — every suggestion must be specific and rewritable.
- NEVER score technical depth high based solely on technologies listed without evidence of depth.


# Backend Developer Portfolio Feedback

## When to Use / When Not to Use

**Use when:**
- Sharing a portfolio and wanting an overall honest read from an interviewer perspective
- Getting a score across technical depth, system design, impact narrative, ownership, and storytelling
- Understanding which areas to prioritize for improvement

**Not for:**
- Rewriting specific weak sentences (use portfolio-rewrite)
- Comparing against a specific JD (use portfolio-jd)
- Live interview simulation (use portfolio-interview)

## Process

1. **Plan the analysis** — overall shape of portfolio; what 2-3 things most determine senior bar; visible gaps at first glance
2. **Select interviewer persona** — Staff Engineer / EM Startup / Enterprise Tech Lead / OSS DevTools Lead
3. **Score 5 dimensions** — Technical Depth, System Design, Impact and Results, Leadership/Ownership, Portfolio Narrative
4. **Write feedback** — first impression, dimension scores with evidence, impressive points, probe areas, 5 expected questions
5. **Prioritize improvements** — Top 3 specific, actionable rewrites (not "add more detail" — name exactly what to change)

## Standalone Inputs

Provide: your portfolio (paste or upload). Optionally specify the target role level and company type for a calibrated review.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Reviews portfolio as selected interviewer persona | Chooses which interviewer persona fits your target company |
| Scores 5 dimensions with specific evidence | Provides missing facts (numbers, your actual role) when requested |
| Lists top 3 improvement priorities — concrete, not generic | Decides which improvements to make before applying |
| Generates 5 expected interview questions from this portfolio | Does the actual interviews and relationship building |

## Related Skills

- `../portfolio-rewrite/SKILL.md` — act on specific improvement areas after receiving feedback
- `../portfolio-pattern/SKILL.md` — understand writing patterns (passive voice, subject audit) that affect perception
- `../portfolio-interview/SKILL.md` — practice answering the expected interview questions
- `../portfolio-company/SKILL.md` — identify which companies to target after improvement

---

## Stage 1 — Plan the Analysis (Sequential Thinking)

Call `sequentialthinking` before reading anything deeply.

Use it to map out:
- What is the overall shape of this portfolio? (project-heavy, resume-style, GitHub-linked, narrative-driven?)
- What are the 2–3 things that will most determine whether this candidate clears the bar for a senior role?
- Are there already visible gaps or red flags at first glance?
- What order should the sections be reviewed in to build the most coherent picture?

This step exists because rushed reviews tend to latch onto the first interesting detail and miss the overall pattern. Sequential thinking forces a deliberate read.

---

## Stage 2 — Choose an Interviewer Persona

Present the 4 personas to the user and ask them to pick one (or choose if the user says "you decide"). Full persona descriptions: [`references/personas.md`](references/personas.md)

| Persona | Focus | Skeptical of |
|---------|-------|--------------|
| A — Staff Engineer (Large Platform) | Depth, scale, first-principles | Vague impact, "participated in" |
| B — EM (Growth Startup) | Ownership, cross-functional impact, outcomes | Deep specialist with no breadth |
| C — Tech Lead (Enterprise/Fintech) | Reliability, process maturity, docs | Hype stacks, no ops context |
| D — OSS / DevTools Lead | API design, DX, public communication | Closed-source only, no external writing |

Once the persona is selected, stay in character throughout the review. Let the persona's priorities shape what you praise, what you probe, and what questions you ask.

---

## Stage 3 — Score Each Dimension (Think Tool — Required)

Call `think` **before scoring each dimension** — not only when something feels ambiguous. Fast scoring produces surface-level grades. The forced question is: *"Is this actually evidence of what I think it is, or am I pattern-matching to something familiar?"*

For each of the 5 dimensions, use this think checkpoint before assigning a score:

```
think: "What concrete evidence in this portfolio supports a high score on [dimension]?
What would a skeptical interviewer say to challenge that assessment?
Am I seeing real depth, or a convincing surface signal?
What is the minimum evidence that would justify a 7+ here?"
```

### Annotating your reasoning

When `think` surfaces a non-obvious insight, record it as an inline annotation immediately below the relevant section:

```
> 🧠 **Reviewer note**: [the key insight, in 1–2 sentences]
```

Use sparingly — only where the reasoning was genuinely difficult or the insight would help the candidate understand *why* the feedback is what it is.

---

## Stage 3.5 — Devil's Advocate Pass

> 이 단계는 `think:devils-advocate` 스킬의 사고방식을 채점에 직접 적용합니다.

Before finalizing **any dimension scored 7 or above**, run an adversarial challenge. The goal is not to tear down the portfolio — it is to find the real weaknesses before the interviewer does.

For each high score, answer:
- What specific evidence in this portfolio would make a skeptical interviewer **downgrade** this score?
- Is there a charitable read of the portfolio that inflated this assessment?
- What would need to be present (but isn't) to justify this score **without hesitation**?

If the challenge reveals the high score rests on one strong signal surrounded by significant weakness — revise down. Record the challenge outcome:

```
> 🧠 **Devil's advocate**: [what the strongest objection is, and whether it changed the score]
```

**If competing evidence remains after the devil's advocate pass** — call `mcp-reasoner` (beam_search, beamWidth=3):
- Beam A: downgraded score + evidence for it
- Beam B: current score + evidence for it
- Beam C: upgraded score + evidence for it

Commit to the most defensible score. A score the candidate can understand and act on is worth more than a precise one they can't.

---

## Stage 4 — Scoring Rubric

Full rubric: [`references/scoring-rubric.md`](references/scoring-rubric.md)

Score = **highest level the portfolio fully satisfies** — partial evidence does not round up. 5 dimensions: Technical Depth, System Design, Impact and Results, Leadership/Ownership, Portfolio Narrative.

---

## Stage 5 — Output

Write the feedback in Korean. Use this structure:

---

**[총평]**
First impression in 3 sentences. Start with the single most important signal — positive or negative.

---

**[차원별 점수]**

For each dimension:
- **[차원명]: X / 10**
- 근거: [specific evidence from the portfolio — quote or describe]
- 🧠 Devil's advocate note (if a high score was challenged)

---

**[강점]**
What genuinely impresses — with specific quotes or references from the portfolio. Not generic praise.

---

**[핵심 취약점]**
The single thing most likely to damage this candidacy if left unaddressed. This is not the most obvious weakness — it is the one that hits the deepest structural flaw.

> This field applies the devil's advocate framework: not the easiest thing to criticize, but the hardest to defend.

---

**[예상 인터뷰 질문 Top 5]**
Questions this interviewer persona will almost certainly ask, grounded in what the portfolio reveals or conceals. Not generic questions — derived from this specific portfolio.

---

**[개선 우선순위 Top 3]**

Call `mcp-reasoner` (beam_search, beamWidth=3) before ordering these. Competing factors: severity of weakness, how recoverable it is, how much effort the fix requires.

For each priority:
- 무엇을: [exactly which section or sentence to change]
- 왜: [why this matters to the reviewer persona]
- 어떻게: [concrete direction — not "add more detail" but what kind of detail and where]

---

**[이 포트폴리오가 가장 잘 맞는 포지션]**
One sentence. What kind of role, company stage, and persona would find this portfolio most compelling — given its current state, not its ideal state.

---
