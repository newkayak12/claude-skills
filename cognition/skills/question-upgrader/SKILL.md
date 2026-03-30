---
name: question-upgrader
description: >-
  Use when someone is asking a question that is too narrow, too closed, or based on a hidden
  assumption that may be wrong. Upgrades weak questions and generates meta-questions to check
  whether the right question is even being asked.
  Triggers on: "better question", "좋은 질문", "질문 개선", "더 나은 질문", "어떤 질문을 해야",
  "질문이 맞는지 모르겠어", "뭘 물어봐야 할지". Also triggers on yes/no questions about
  complex topics, or solution-embedded questions.
  Best for: reframing stuck problems, improving research or interview questions, finding the real question.
  Not for: answering questions directly — this skill upgrades the question first.

scenarios:
  - "Is this even the right question to be asking?"
  - "Should I use microservices? (upgrade this)"
  - "How do I get my team to work harder?"
  - "이 질문이 맞는지 모르겠어, 더 좋은 질문으로 바꿔줘"
  - "어떤 질문을 해야 할지 모르겠어"
  - "이 문제에 어떻게 접근해야 할지 질문 자체가 불명확해"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 메타 질문 분석(질문이 올바른가?)을 먼저 실행하고
    그 다음 질문 업그레이드를 진행하는 순서를 지킬 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Question Upgrader

## When to Use / When Not to Use

**Use when:**
- Someone asks a yes/no question about a complex topic
- The question has a solution embedded in it ("should I use X?")
- The framing of the question seems to be the obstacle, not the answer
- You suspect the question is answering the wrong level of problem

**Not for:**
- Questions that are already well-formed — confirm they're good and proceed
- Simple factual queries that don't have embedded assumptions

## Process

**Run Part 2 (meta-questions) first, then Part 1 (upgrade moves).**

**MCP note:** If `sequential-thinking` is available, enforce this order: meta-question analysis → surface-form upgrade. Skipping meta-questions polishes the wrong question.

### Part 2 — Meta-Question Check (run first)

Before upgrading, ask:
1. **Is this the right question?** Does answering it perfectly solve the underlying problem?
2. **What assumption is embedded?** Every question assumes something. Surface it.
3. **What would a more useful question be?** Generate 3 alternatives at a different level or angle.
4. **Who is best positioned to answer this?** Right person, data source, or part of yourself?
5. **What would change if you had the answer?** If nothing — the question is academic, not urgent.
6. **What question are you afraid to ask?** Usually the most useful one.

### Part 1 — Upgrade Moves

| Weak pattern | Move | Stronger form |
|-------------|------|---------------|
| "Should I do X?" | Conditional | "What would need to be true for X to be right?" |
| "How do I get X?" | Why/What first | "What is actually preventing X right now?" |
| "Is X good?" | Stakes + context | "Good for whom, by what measure, over what timeframe?" |
| "What is the best Y?" | Scope + constraints | "Best for [specific goal] given [specific constraints]?" |
| "How do I fix Z?" | Diagnosis | "Is Z actually the problem, or a symptom?" |

Additional moves: inversion ("What would guarantee I fail?"), adding time horizon, removing embedded solution.

## Output Template

1. **Original question** — restated for reference
2. **What makes it weak** — one sentence: closed/assumptive/embedded solution/wrong level
3. **Hidden assumption** — what is being taken for granted
4. **Upgraded question(s)** — 1–3 stronger formulations
5. **Why each upgrade unlocks better thinking** — one sentence per
6. **The question you might be avoiding** — always include, not optional

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Runs meta-question check to verify it's worth upgrading | Provide the question or problem framing |
| Names the specific weakness before upgrading | Confirm whether the hidden assumption resonates |
| Produces 1–3 upgraded questions maximum | Choose which upgraded question to actually pursue |
| Surfaces the question being avoided | Decide whether to confront that question |

## Related Skills

- `assumption-extractor` — for digging into the hidden premises a question rests on
- `clarity-toolkit` — when the problem is vague goals rather than weak questions
- `mental-model-toolkit` — for reframing the problem itself when the question reveals a stuck frame
