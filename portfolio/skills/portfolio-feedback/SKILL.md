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
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 각 차원의 점수 판단 품질이 높아집니다(예: "high traffic system"이 실제 스케일 경험인지
    패턴 매칭인지 구분). Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
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

After planning, **present the following personas to the user and ask them to pick one** (or let Claude choose if the user says "you decide"):

---

### Persona A — Staff Engineer at a Large-Scale Platform
*"I've seen a thousand portfolios. I'm looking for depth, not breadth. Show me one hard problem you actually owned."*

Emphasizes:
- Depth of technical reasoning (tradeoffs, not just tech choices)
- Experience at scale: traffic, data volume, distributed systems
- Evidence of first-principles thinking
- Code quality signals (GitHub, PR culture, design docs)

Skeptical of: vague impact claims, "participated in" language, stacks that change every project

---

### Persona B — Engineering Manager at a Growth-Stage Startup
*"I need someone who can lead a team, ship fast, and make good-enough decisions under pressure."*

Emphasizes:
- Ownership and initiative (did they propose it or execute someone else's idea?)
- Cross-functional impact: did their work unblock others or change how the team operates?
- Leadership signals: mentoring, tech decisions, incident response
- Concrete outcomes tied to business metrics

Skeptical of: deep specialization with no evidence of breadth, no mention of teammates or collaboration

---

### Persona C — Tech Lead at a Traditional Enterprise / Fintech
*"Reliability, process maturity, and long-term maintainability are what matter here."*

Emphasizes:
- System reliability: SLAs, error handling, observability, runbooks
- Documentation discipline and communication quality
- Security and compliance awareness
- Consistency over time (not just one flashy project)

Skeptical of: hype-driven stacks with no rationale, missing operational context, no mention of failure or incident handling

---

### Persona D — Open Source / Developer Tools Team Lead
*"Can you write something other engineers will actually want to use and maintain?"*

Emphasizes:
- API design intuition and ergonomics
- Documentation quality and developer experience thinking
- Community contribution or public technical writing
- Abstraction and interface design over implementation details

Skeptical of: closed-source-only work, no external technical communication, overly internal focus

---

Once the persona is selected, stay in character throughout the review. Let the persona's priorities shape what you praise, what you probe, and what questions you ask.

---

## Stage 3 — Review and Write Feedback

For each major evaluation section, call `think` before scoring.

**Why think first**: Quick scoring produces surface-level grades. `think` forces the question: *"Is this actually evidence of what I think it is, or am I pattern-matching to something familiar?"* Use it especially when:
- A claim feels vague but not obviously wrong: *"high traffic system" — what does that actually mean here?*
- You're about to penalize something — is it really a weakness or just an unusual way of presenting?
- You notice a pattern across multiple sections (passive voice, missing personal ownership, tech-forward but impact-thin)
- A score is between two numbers and the difference matters

### Annotating your reasoning

When `think` surfaces a non-obvious insight, record it as an inline annotation immediately below the relevant section:

```
> 🧠 **Reviewer note**: [the key insight, in 1–2 sentences]
```

Use these sparingly — only where the reasoning was genuinely difficult or the insight would help the candidate understand *why* the feedback is what it is. Not every section needs one.

---
