---
name: retrospective
description: Use when conducting a personal or project retrospective — sprint end, project close, weekly/monthly review, or when asked to "회고", "돌아보기", "스프린트 리뷰", "이번 주 회고", or "프로젝트 마무리". Guides structured reflection using KPT, 5 Whys, or timeline formats and produces concrete action items.
---

# Retrospective

Structured retrospective facilitator that turns reflection into actionable improvement.

## Core Workflow

> **Important:** Do NOT generate the full KPT output until Phase 2. In Phase 1, ask structured questions section by section and wait for user responses before moving on.

### Phase 1: Facilitation (interactive)

Steps 1–3 require user input. Claude asks questions and waits for answers at each step before proceeding.

1. **Identify scope** — Clarify the retrospective type: sprint, project, weekly, monthly, or personal
   - Ask: time period, team or solo, any specific focus area (quality, velocity, communication)
   - *Wait for user response before continuing.*
2. **Select format** — Choose the best framework for context (see formats below)
   - Sprint/team → KPT
   - Root-cause investigation → 5 Whys
   - Long project or complex timeline → Timeline retrospective
   - *Confirm the chosen format with the user if there is ambiguity.*
3. **Collect data** — Gather events, outcomes, and feelings for the period
   - For KPT: ask about Keep items first, then Problem, then Try — one section at a time
   - *Wait for the user to finish each section before asking about the next.*

### Phase 2: Synthesis & Action (generative)

Steps 4–6 are independent work. Claude synthesizes gathered data and produces output without interrupting the user.

4. **Synthesize insights** — Group patterns, identify systemic issues, highlight wins
   - *Checkpoint:* Every Problem/issue must connect to at least one Try/action item before proceeding
5. **Define action items** — Produce SMART actions (Specific, Measurable, Assignable, Time-bound)
6. **Close the loop** — Summarize and link to next retrospective

## Retrospective Formats

### KPT (Keep / Problem / Try)

Best for: regular sprints, team retrospectives, quick reviews.

| Section | Question | Goal |
|---------|----------|------|
| **Keep** | What worked well and should continue? | Preserve strengths |
| **Problem** | What caused friction, delays, or quality issues? | Surface pain points |
| **Try** | What concrete experiments can address Problems? | Drive improvement |

Rules:
- Each Try must map to a Problem (write the mapping explicitly)
- Keep items can also generate Tries (amplify what works)
- Limit to 3–5 items per section to stay actionable

### 5 Whys

Best for: recurring problems, unexpected failures, root-cause analysis.

Process:
1. State the problem in one sentence
2. Ask "왜?" (Why?) and write the immediate cause
3. Repeat 5 times (stop earlier if root cause is clear)
4. Identify the root cause (usually the last "why")
5. Define a countermeasure targeting the root cause

Guard rails:
- Use sequential-thinking for the 5 Whys chain — each "why" must explicitly build on the previous answer, making the causal chain auditable and allowing backtracking if a step turns out to be wrong
- Stop early only if the root cause is already clear and evidence-based; do not stop just because a cause feels plausible
- Follow evidence, not assumptions — each step must be verifiable
- If a "why" branches into multiple causes, analyze each branch separately
- The countermeasure must address the root cause, not a symptom

### Timeline Retrospective

Best for: long projects (>4 weeks), complex releases, post-mortems.

Steps:
1. Draw a horizontal timeline with key milestones
2. Plot events as positive (above line) or negative (below line)
3. Annotate emotions/energy level at each event
4. Identify patterns: where did energy drop? what preceded failures?
5. Extract 2–3 systemic insights from the patterns
6. Derive action items from the insights

## 개인 회고 (Solo Retrospective)

When the retrospective is personal (no team), the facilitator and participant are the same person. Apply these adjustments:

- **Time-box each section** — spend no more than 5 minutes per KPT section or per "why" step to prevent rumination
- **Use neutral prompts** — ask "무슨 일이 있었나?" (What happened?) rather than "잘 못한 게 뭐야?" (What did I do wrong?) to reduce self-criticism and surface facts first
- **Write in private-format** — action items can use first-person ("내가 …한다") and omit the Owner field since there is only one person
- **Be the honest observer** — treat yourself as you would a colleague: acknowledge what went well with the same weight as what needs improvement
- **One key action is enough** — a solo retro with one well-defined next step beats a list of five that never get reviewed

## Action Item Format

Every action item must follow this structure:

```
[ACTION] <verb + specific outcome>
- Owner: <person or role>
- Due: <date or next sprint>
- Success metric: <how we know it's done>
- Maps to: <Problem/issue it addresses>
```

## Output Template

At the end of every retrospective, produce:

```markdown
## 회고 요약 — [기간 또는 프로젝트명]

### Keep (잘한 점)
- ...

### Problem (개선할 점)
- ...

### Try (실험할 것)
- [ ] [ACTION] ...  |  Owner: ...  |  Due: ...  |  Metric: ...

### 핵심 인사이트
> 한두 문장으로 이번 회고에서 발견한 가장 중요한 패턴 또는 교훈.

### 다음 회고
- 날짜: ...
- 확인할 항목: [이번 Try 항목들이 완료되었는지]
```

## Concrete Example

**Context:** 2-week sprint, 3-person team, late delivery of API integration feature.

```markdown
## 회고 요약 — Sprint 12 (2026-03-03 ~ 2026-03-14)

### Keep
- 매일 15분 스탠드업으로 블로커가 당일 해결됨
- PR 리뷰 SLA(24h) 준수율 90% 달성

### Problem
- API 스펙이 스프린트 중반에 변경되어 3일 재작업 발생
- 테스트 커버리지 부족으로 QA 단계에서 회귀 버그 4건 발견

### Try
- [ ] [ACTION] API 변경 사항을 스프린트 플래닝에 포함하는 체크리스트 작성
      Owner: 김민준  |  Due: 다음 플래닝 전  |  Metric: 체크리스트 문서 존재 + 플래닝 때 사용
      Maps to: API 스펙 변경 재작업
- [ ] [ACTION] 신규 엔드포인트에 통합 테스트 최소 1개 의무화 (PR 조건)
      Owner: 이서연  |  Due: Sprint 13 시작 전  |  Metric: PR 체크리스트에 항목 추가, 다음 스프린트 회귀 버그 0건
      Maps to: QA 단계 회귀 버그

### 핵심 인사이트
> 외부 의존성(API 스펙) 변경을 프로세스 안으로 끌어들이지 않으면 재작업 비용이 반복된다.

### 다음 회고
- 날짜: 2026-03-28
- 확인할 항목: 체크리스트 사용 여부, Sprint 13 회귀 버그 수
```

## Constraints

### MUST DO
- Always produce at least one concrete action item with owner and due date
- Map every Try/action to a specific Problem or opportunity
- End every retrospective with a "다음 회고" section to close the loop
- Keep the tone constructive — focus on systems, not blame
- For 5 Whys, verify each "why" is evidence-based before proceeding

### MUST NOT DO
- Stop at reflection without action items
- Accept vague actions ("더 잘하기", "커뮤니케이션 개선") — push for specificity
- Skip the insight synthesis step — patterns matter more than individual events
- Produce more than 5 action items per retrospective (focus beats volume)
