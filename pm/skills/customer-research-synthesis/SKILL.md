---
name: customer-research-synthesis
description: >-
  Use when raw qualitative research — interview notes, survey responses, session
  recordings — needs to become structured insights that drive decisions.
  Triggers on: "인터뷰 정리", "고객 인터뷰 분석", "리서치 결과 정리", "설문 분석", "VOC 정리",
  "UX research synthesis", "interview notes analysis", "what did users tell us".
  Best for: affinity mapping with n= counts; Jobs-to-be-Done extraction; insight
  cards that feed PRD or prioritization. Not for: quantitative survey stats (use
  metrics-interpretation); competitive research (use competitive-analysis).
license: MIT
metadata:
  author: wondelai
  version: "1.1.0"
scenarios:
  - "I have 10 interview transcripts — help me find the patterns."
  - "고객 인터뷰 결과를 정리해서 PRD에 넣을 인사이트로 만들어줘."
  - "Synthesize these survey verbatims into themes with evidence counts."
  - "인터뷰 노트에서 Jobs-to-be-Done을 뽑아줘."
  - "Which of these research findings are real patterns vs. one-off anecdotes?"
  - "VOC 데이터를 우선순위 결정에 쓸 수 있게 정리해줘."
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 패턴/일화 판정과 JTBD 추출의 논리를 검증하는 데 도움이 됩니다.
    sequential-thinking은 6단계 체인 전체 흐름 유지에 유효합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Customer Research Synthesis

Raw quotes are not insights. An insight requires an observation, supporting evidence, and an implication for what to build or change.

**Synthesis chain:** Raw data → affinity clusters → Jobs-to-be-Done → insight cards → hypotheses

For the full step-by-step process with examples, load `references/synthesis-process.md`.

## When to Use / When Not to Use

| Use | Do Not Use |
|-----|-----------|
| Raw interview notes needing thematic structure | Quantitative survey with closed-ended stats |
| Verbatim quotes needing n= pattern analysis | Competitive research (use competitive-analysis) |
| Discovery research feeding a PRD or roadmap | Product analytics / behavioral data (use metrics-interpretation) |
| Post-research readout that needs insight cards | Research planning or question design |

## Mode 1: Synthesize Raw Data

When the user provides raw interview notes, survey verbatims, or usability observations, produce:

1. **Affinity clusters** — grouped themes with n= counts (e.g., "Pain: slow onboarding — 6/10 participants")
2. **Pattern vs. anecdote verdict** for each cluster (see thresholds in `references/synthesis-process.md` Step 3)
3. **Top 3 Jobs-to-be-Done** extracted from the data
   > Run Step 3 (pattern judgment) and Step 4 (JTBD extraction) in parallel after affinity mapping — they are independent.
4. **Insight summary cards** — one per major finding (observation + evidence + implication)
5. **Recommended hypotheses** — feeds `../hypothesis-driven-dev/SKILL.md`

## Mode 2: Evaluate Synthesis Practice

When the user asks "how good is our research process?" or shares their existing synthesis output for review, rate 0–10:

| Score | State |
|-------|-------|
| 9–10 | Patterns documented with n= counts; JTBD extracted; insight cards connect to decisions; hypotheses written before building |
| 7–8 | Themes exist but evidence counts missing; insights stop at observation without implication |
| 5–6 | Research summarized as a quote list; no pattern analysis |
| 3–4 | "We talked to users" treated as sufficient; no structured output |
| 1–2 | No synthesis practice; decisions made without reference to research |

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Groups observations into affinity clusters with verb phrases | Conducts interviews and recordings |
| Counts n= occurrences and flags pattern vs. anecdote | Judges whether participants are representative |
| Extracts Jobs-to-be-Done using the JTBD template | Validates JTBD accuracy against live customer context |
| Writes insight cards (observation + evidence + implication) | Makes final decisions on what to build |
| Chains insights to testable hypotheses | Decides experiment priority and runs experiments |

## Related Skills

- `../feature-prioritization/SKILL.md` — insight cards as prioritization evidence
- `../prd-development/SKILL.md` — problem statement, personas, and Jobs-to-be-Done
- `../hypothesis-driven-dev/SKILL.md` — validated hypotheses ready for experiment design
- `../pricing-monetization-strategy/SKILL.md` — WTP signals from research
- `../product-discovery/SKILL.md` — triggered after customer research phase completes
