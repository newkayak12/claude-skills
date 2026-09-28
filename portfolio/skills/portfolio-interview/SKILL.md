---
name: portfolio-interview
description: >-
  Use when someone wants a realistic mock interview grounded in their own
  portfolio, with per-answer coaching. Triggers on: "모의 면접 해줘",
  "인터뷰 연습", "mock interview", "grill me on my portfolio".
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

**Not for** a prep plan from scratch (`interview-prep`), overall portfolio assessment (`portfolio-feedback`), or JD tailoring (`portfolio-jd`).

## Standing Mandates

- NEVER supply the candidate's fact. A stronger answer is given as structure; a number, outcome, cause, or date the candidate did not say is written `[확인 필요: ○○]` — no 역산, no candidate values, no example figures. "API 응답속도 개선했습니다" is coached as "개선 전/후 → 측정 방법 → 본인 기여" with `[확인 필요: 개선 전/후 수치]`.
- NEVER reopen a settled decision. Keep a `[확정]` list — persona chosen, stories already judged, numbers already challenged — restate it at the start of a continuing session, and never re-ask or re-judge anything on it.
- ALWAYS lead the closing feedback with the judgment: `[인터뷰 총평]` and the advance/no-advance line come first.

## Process

**0. Ledger.** In a continuing session, restate the `[확정]` list before anything else and resume from it.

**1. Plan the interview (sequential thinking).** Call `sequentialthinking` before the first question. Map:
- The 3–4 most interesting areas to probe in this portfolio.
- Claims needing verification — what an interviewer would stress-test.
- The persona that fits the candidate's apparent target role (or ask).
- Flow: technical depth first, then leadership — or behavioral opener, then technical.
- The 2–3 questions that will be genuinely hard for this candidate.

**2. Persona.** If no persona was inherited from portfolio-feedback, offer:
- **A — Staff Engineer, Large Platform**: deep technical probing, system design, scale
- **B — Engineering Manager, Startup**: ownership, leadership, business impact
- **C — Tech Lead, Enterprise**: process maturity, reliability, communication
- **D — OSS/DevTools Lead**: API design, documentation, technical communication

Or match from the company the user describes. Add the choice to `[확정]`. Stay in persona for the whole interview.

**3. Run the interview.** Open with a brief in-character introduction, then the first question. Do not preview the question list — real interviews don't.
- One question at a time; wait for the answer.
- Respond as the interviewer: follow up, push back, or move on.
- After each answer, a private coaching note (below).
- After 5–7 questions, wrap up and give the closing feedback.

Question types to include:

**Anchored** — directly from the portfolio:
> "포트폴리오에서 [프로젝트명]에서 Kafka를 도입했다고 하셨는데, 그 결정을 내리기까지 어떤 대안들을 검토하셨나요?"

**Gap probe** — what's missing or vague:
> "이 프로젝트에서 본인의 역할이 정확히 무엇이었나요? 팀 전체가 한 건지, 본인이 주도한 건지 구분해서 말씀해주실 수 있을까요?"

**Depth drill** — one level deeper than the portfolio:
> "Redis를 캐시로 쓰셨다고 하셨는데, 캐시 무효화 전략은 어떻게 설계하셨나요? TTL만 쓰셨나요, 아니면 명시적 eviction도 있었나요?"

**Failure/Recovery** — what went wrong:
> "이 시스템을 운영하면서 가장 큰 장애가 뭐였나요? 그때 어떻게 대응하셨어요?"

**Hypothetical extension** — beyond the portfolio:
> "지금 이 시스템에 트래픽이 10배 늘어난다면 어디서 먼저 터질 것 같으세요?"

**4. Coaching note.** After each answer, before the next question:

```
---
💬 **코칭 노트** (면접관 시각):
[2–4 sentences: what landed, what didn't, what to add or cut next time.
A stronger shape is structure only; a missing number/outcome is [확인 필요: ○○].]
---
```

Be honest: name a vague answer, an answer that talked around the question, or one that was genuinely impressive. Use `think` when an answer is hard to evaluate — is it actually good or just confidently delivered? Record non-obvious evaluation judgments as an interviewer note. Once a story is judged or a number challenged, add it to `[확정]` and do not probe it again.

**5. Close** with the Output Template.

## Rules

- Stay in character. Don't break frame to be encouraging mid-question.
- A very short or evasive answer gets one push back: "조금 더 구체적으로 말씀해주실 수 있을까요?" — then move on.
- A strong answer gets brief acknowledgment, no over-praise.
- The coaching note is the place for honesty; the interview itself stays realistic, not therapeutic.
- Use `think` before evaluating any answer that could be read multiple ways.

**Standalone inputs** (without prior portfolio-feedback): the portfolio (pasted or key projects described), target company type or company, and desired persona.

## Output Template

```
**[인터뷰 총평]**
Advance: 예 / 아니오 — [one-line reason as this persona]
[Overall impression as this persona.]

---

**[잘한 답변]**
1–2 specific answers that were strong, and why they worked.

---

**[보완이 필요한 답변]**
1–2 answers that underdelivered. For each, what a stronger version would
have looked like — as structure (e.g. 문제 → 선택지 → 결정 이유 → 결과 →
본인 기여), with every number or outcome the candidate did not give written
as [확인 필요: ○○].

---

**[다음 연습에서 집중할 것]**
The one thing to work on most before the real interview.

---

[확정] persona · stories judged · numbers challenged
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Plans the flow: technical depth, gap probes, failure/recovery | Answer honestly — this works only if you treat it as real |
| Stays in the chosen persona throughout | Ask for a persona change if it doesn't match your target company |
| Gives a coaching note after each answer, with `[확인 필요]` where your fact is missing | Fill the `[확인 필요]` gaps from your own experience |
| Keeps the `[확정]` list and doesn't reopen it | Say so if something on it should change |
| Delivers closing feedback, verdict first | Decide which areas to practice more |

## Related Skills

- `../portfolio-feedback/SKILL.md` — overall assessment before the mock interview
- `../interview-prep/SKILL.md` — study plan for topics exposed in this mock
- `../portfolio-rewrite/SKILL.md` — improve weak portfolio sections that came up
