---
name: assumption-extractor
description: >-
  Use when someone presents a plan, argument, or belief with confidence and its
  hidden dependencies have not been examined — surfacing factual, causal, value,
  and definitional assumptions, then ranking which ones would collapse
  everything if wrong.

scenarios:
  - "Walk me through the assumptions behind this strategy"
  - "What am I taking for granted in this plan?"
  - "Is there something I'm missing before I commit to this?"
  - "이 계획의 숨겨진 전제가 뭘까?"
  - "내가 당연히 여기고 있는 것들을 찾아줘"
  - "이 논리에서 틀릴 수 있는 게 뭐야?"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 네 가지 가정 유형(사실·인과·가치·정의)을 체계적으로 스캔하고
    가장 위험한 전제를 정확하게 식별할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Assumption Extractor

## When to Use / When Not to Use

**Use when:**
- A plan or argument sounds solid but hasn't been stress-tested
- Someone is about to commit resources to a decision
- You want a pre-mortem before launching something

**Not for:**
- Identifying logical errors in reasoning (use fallacy-detector)
- Diagnosing why someone is overconfident (use bias-auditor)

## Process

**Step 1 — State the claim.** Confirm the core argument/plan being examined.

**Step 2 — Scan all four categories in parallel:**

| Type | What to look for |
|------|-----------------|
| **Factual** | What facts are assumed true without being established? |
| **Causal** | What cause-effect chains are assumed (A therefore B)? |
| **Value** | What is assumed to matter most? What trade-offs are pre-decided? |
| **Definitional** | What terms are assumed to share meaning? |

**Step 3 — Classify by load.**

- **Load-bearing:** if wrong, the argument collapses entirely
- **Significant:** if wrong, requires substantial revision
- **Peripheral:** if wrong, details change but core survives

**Step 4 — Flag the most dangerous assumption.** The load-bearing one with the lowest current verification.

**MCP note:** If `sequential-thinking` is available, run all four category scans before classifying — stopping after finding one load-bearing assumption misses others.

## Output Template

```
가정 추출 결과 / Assumption Map:

사실적 가정 / Factual Assumptions:
- [Assumption]: [Load-bearing / Significant / Peripheral]

인과적 가정 / Causal Assumptions:
- [Assumption]: [Load-bearing / Significant / Peripheral]

가치 가정 / Value Assumptions:
- [Assumption]: [Load-bearing / Significant / Peripheral]

정의적 가정 / Definitional Assumptions:
- [Key term]: [What the argument seems to mean by it]

핵심 위험 전제 / Most Dangerous Assumption:
[The load-bearing assumption with lowest current verification]
If wrong: [Consequence for the argument/plan]
To verify: [What would need to be checked]
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Scans four assumption categories systematically | Provide the plan or argument to examine |
| Classifies each assumption by load-bearing weight | Confirm which assumptions are actually in play |
| Identifies the single most dangerous assumption | Decide which to test before committing |
| Names what would collapse if that assumption is wrong | Run the verification checks |

## Related Skills

- `fallacy-detector` — when the issue is logical structure, not hidden premises
- `bias-auditor` — when the issue is why someone is overconfident
- `second-order-thinker` — for downstream consequences once assumptions are surfaced
- `mental-model-toolkit` — for alternative frames when assumptions reveal a blind spot
