---
name: portfolio-interview
description: >-
  Use when someone wants to practice defending their work in a realistic mock
  interview — the interviewer asks questions grounded in the actual portfolio,
  evaluates answers, and gives coaching feedback. Triggers on: "모의 면접 해줘", "인터뷰
  연습", "면접 준비 같이
scenarios:
  - "Run a mock interview with me based on my portfolio — use a staff engineer persona"
  - "Ask me tough questions about my system design experience from my portfolio"
  - "I want to practice answering interview questions about my work"
  - "포트폴리오 기반으로 모의 면접 해줘"
  - "내 포트폴리오 보고 어려운 질문 던져줘"
compatibility:
  recommended: []
  optional:
    - think-tool
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 애매한 답변의 품질 판단 정확도가 높아지고,
    sequential-thinking이 있으면 인터뷰 흐름(기술 → 리더십 → 행동)의 구조를 유지합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Portfolio-Based Mock Interview

## When to Use / When Not to Use

**Use when:**
- Practicing how to defend your work under a realistic interview format
- Wanting questions grounded in your actual portfolio (anchored, gap-probe, depth-drill)
- After receiving portfolio-feedback and wanting to rehearse difficult questions

**Not for:**
- Building a prep plan from scratch (use interview-prep)
- Overall portfolio quality assessment (use portfolio-feedback)
- Resume tailoring to a JD (use resume-tailorer)

## Process

1. **Prepare interview plan** — identify 3-4 areas to probe; locate claims needing verification; plan question flow
2. **Select persona** — Staff Engineer / EM Startup / Enterprise Tech Lead / OSS DevTools Lead
3. **Run interview** — one question at a time; anchored questions, gap probes, depth drills, failure/recovery, hypotheticals
4. **Give coaching notes** — after each answer: what landed, what didn't, what to add or cut
5. **Closing feedback** — overall impression, strongest/weakest answers, one thing to work on most

## Standalone Inputs

If arriving here without prior portfolio-feedback, provide:
- Your portfolio (paste or describe key projects)
- Target company type or specific company
- Desired interviewer persona (staff engineer / EM startup / enterprise tech lead / OSS/devtools)

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Plans interview flow: technical depth, gap probes, failure/recovery | Provides honest answers — this works only if you treat it as real |
| Stays in chosen interviewer persona throughout | Requests persona change if it doesn't match your target company |
| Gives coaching notes after each answer | Reflects on coaching notes and adjusts for the real interview |
| Delivers closing feedback: overall impression, strongest/weakest answers | Decides which areas to practice more |

## Related Skills

- `../portfolio-feedback/SKILL.md` — get overall assessment before mock interview
- `../interview-prep/SKILL.md` — build study plan covering topics exposed in this mock
- `../portfolio-rewrite/SKILL.md` — improve weak portfolio sections that came up in the interview

---

## Stage 1 — Prepare the Interview (Sequential Thinking)

Before the interview begins, call `sequentialthinking` to plan it.

Map out:
- What are the 3–4 most interesting areas to probe based on this portfolio?
- Where are the claims that need verification? (things the candidate said that an interviewer would want to stress-test)
- What persona is most appropriate for this candidate's apparent target role? (or ask the user)
- How should the interview flow — technical depth first, then leadership? or behavioral opener, then technical?
- What are the 2–3 questions that will be genuinely hard for this candidate to answer well?

---

## Stage 2 — Persona Selection

If the user hasn't already selected a persona from portfolio-feedback, present options:

- **A — Staff Engineer, Large Platform**: Deep technical probing, system design, scale
- **B — Engineering Manager, Startup**: Ownership, leadership, business impact
- **C — Tech Lead, Enterprise**: Process maturity, reliability, communication
- **D — OSS/DevTools Lead**: API design, documentation, technical communication

Or let the user describe the company they're targeting and match accordingly.

Stay in persona for the entire interview.

---

## Stage 3 — Run the Interview

### Opening

Start with a brief interviewer introduction in character, then ask the first question. Do not preview the full question list — real interviews don't do that.

**Interview format:**
- Ask one question at a time
- Wait for the user's answer
- Respond as the interviewer: follow up, push back, or move on
- After each answer, add a private coaching note (see below)
- After 5–7 questions, wrap up and give overall feedback

### Question Types to Include

**Anchored questions** — directly from the portfolio:
> "포트폴리오에서 [프로젝트명]에서 Kafka를 도입했다고 하셨는데, 그 결정을 내리기까지 어떤 대안들을 검토하셨나요?"

**Gap probes** — targeting what's missing or vague:
> "이 프로젝트에서 본인의 역할이 정확히 무엇이었나요? 팀 전체가 한 건지, 본인이 주도한 건지 구분해서 말씀해주실 수 있을까요?"

**Depth drills** — going one level deeper than the portfolio:
> "Redis를 캐시로 쓰셨다고 하셨는데, 캐시 무효화 전략은 어떻게 설계하셨나요? TTL만 쓰셨나요, 아니면 명시적 eviction도 있었나요?"

**Failure/Recovery** — what went wrong:
> "이 시스템을 운영하면서 가장 큰 장애가 뭐였나요? 그때 어떻게 대응하셨어요?"

**Hypothetical extension** — beyond the portfolio:
> "지금 이 시스템에 트래픽이 10배 늘어난다면 어디서 먼저 터질 것 같으세요?"

---

### Coaching Notes

After each user answer, before asking the next question, add:

```
---
💬 **코칭 노트** (면접관 시각):
[2–4 sentences: what landed, what didn't, what to add or cut next time]
---
```

Be honest. If the answer was vague, say so. If the candidate talked around the question, name it. If something was genuinely impressive, note that too. Use `think` when an answer is hard to evaluate — is it actually good or just confidently delivered?

> 🧠 **Interviewer note**: Record non-obvious evaluation judgments here.

---

## Stage 4 — Closing Feedback

After the interview, deliver:

---

**[인터뷰 총평]**
Overall impression as this persona. Would you advance this candidate? Why or why not?

---

**[잘한 답변]**
1–2 specific answers that were strong, and why they worked.

---

**[보완이 필요한 답변]**
1–2 answers that underdelivered, and what a stronger version would have looked like.

---

**[다음 연습에서 집중할 것]**
The one thing the candidate should work on most before their real interview.

---

## Rules

- Stay in character as the interviewer. Don't break frame to be encouraging mid-question.
- If the user gives a very short or evasive answer, push back once: "조금 더 구체적으로 말씀해주실 수 있을까요?"
- If the user's answer is strong, acknowledge it briefly and move on — don't over-praise.
- The coaching note is the place for honesty; the interview itself should feel realistic, not therapeutic.
- Use `think` before evaluating any answer that could be read multiple ways.
