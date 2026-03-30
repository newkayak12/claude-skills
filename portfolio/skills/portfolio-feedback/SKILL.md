---
name: portfolio-feedback
description: >-
  Use when someone shares a portfolio and wants an overall assessment from an interviewer's perspective — overall impression, scoring across dimensions, and prioritized improvement areas.
  Triggers on: "포트폴리오 피드백 해줘", "내 포트폴리오 어때?", "portfolio review", "how does my portfolio look", "review my portfolio", or when a portfolio is shared without a more specific request.
  Best for: 5+ year backend engineers wanting an honest overall read; identifying which dimensions (technical depth, ownership, impact narrative) are strongest/weakest.
  Not for: rewriting specific sections (use portfolio-rewrite), JD matching (use portfolio-jd), live interview practice (use portfolio-interview).
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

## Evaluation Dimensions

For a 5+ year senior backend engineer, these are the things that actually matter:

**Technical Depth**
Did they use the technology or understand it? The difference shows in whether they describe tradeoffs, encountered limitations, and made deliberate choices — versus listing what was installed.

**System Design**
How did they handle growth, failure, and bottlenecks? Architecture decisions need rationale, not just diagrams. One well-explained design decision is worth ten bullet points of features.

**Impact and Results**
"Improved performance" is table stakes. By how much? Measured how? What changed for the business or users? Senior engineers own outcomes, not just tasks.

**Leadership and Ownership**
Did they propose this, or execute it? Team contributions, mentoring, architecture decisions, incident ownership — the question is whether this person was present or driving.

**Portfolio Narrative**
Is there a story? Why these projects? What was hard? What changed? A list of features is a job description, not a portfolio.

---

## Output Structure

Write the feedback in Korean. Use the structure below, inserting `🧠 Reviewer note` annotations where relevant.

---

**[종합 첫인상]**
Honest first reaction. Would you keep reading? What, if anything, made you stop? One or two sentences that capture the overall signal.

---

**[항목별 평가]**

For each dimension: **score (out of 10)** + evidence from the portfolio + specific improvement direction.
Insert `🧠 Reviewer note` below any score where the reasoning was not straightforward.

- **기술 깊이**: X/10
- **시스템 설계**: X/10
- **임팩트 서술**: X/10
- **리더십/오너십**: X/10
- **포트폴리오 서술 품질**: X/10

---

**[인상적이었던 부분 (최대 3개)]**
Specific, not generic. Not "good technical skills" — say what exactly was impressive and why it signals what you think it signals.

---

**[면접에서 파고들 부분 (최대 3개)]**
The things you would push on in the actual interview. Claims that feel overstated, roles that seem unclear, or absences that make you wonder.

---

**[예상 면접 질문 5개]**
The questions a real interviewer with this persona would actually ask — some exploratory, some pointed. These should be useful prep material.

---

**[개선 우선순위 Top 3]**
If the candidate rewrites one thing tonight, what is it? Concrete and actionable: not "add more detail" but "replace 'improved system performance' with the actual latency numbers and what you changed to get there."

---

**[한 줄 요약]**
How would you describe this candidate to a hiring manager in one sentence?

---

## Rules

- **Stay in persona**: The selected persona's priorities should visibly shape what gets praised and what gets challenged. Don't drift into generic feedback.
- **Hold the senior bar**: If the portfolio reads like a 2–3 year engineer, say so clearly. Don't soften the gap.
- **Absence is evidence**: Missing impact numbers, missing failure stories, missing ownership language — note it. What's not there is as telling as what is.
- **Be direct, not harsh**: The goal is a candidate who improves, not one who gives up. But honest is more useful than kind.
- **Current tech context**: Evaluate against 2024–2025 backend engineering norms. Flag stacks or practices that are dated.

---

## After the Review — Next Steps

Once the overall review is complete, offer the candidate these follow-on skills depending on what they need:

- **고치고 싶은 섹션이 있다면** → `portfolio-rewrite`: 약한 문장을 Before/After로 직접 리라이팅
- **서술 패턴이 왜 약한지 알고 싶다면** → `portfolio-pattern`: 주어 비율, 피동 표현, 숫자 밀도 등 패턴 분석
- **실제 면접 준비를 하고 싶다면** → `portfolio-interview`: 이 포트폴리오 기반 모의 면접 시뮬레이션
- **어떤 회사에 지원할지 모르겠다면** → `portfolio-company`: 회사 유형별 핏 분석
- **특정 공고에 지원하려 한다면** → `portfolio-jd`: JD와 포트폴리오 갭 분석 및 포지셔닝 조언
