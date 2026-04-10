---
name: thinking-style-profiler
description: >-
  Use when someone wants to understand their characteristic thinking style or
  why they think the way they do — mapping tendencies to actionable learning and
  working strategies. Triggers on: "thinking style", "내 사고 방식이 어떤지", "사고 패턴 파악",
  "왜 나는 이런 방식으로만

scenarios:
  - "Why do I always get stuck when problems are too abstract?"
  - "I want to understand my thinking style to work more effectively"
  - "Why does collaborative work drain me while solo deep work energizes me?"
  - "내 사고 방식이 어떤지 파악하고 싶어"
  - "왜 나는 항상 큰 그림부터 봐야 안심이 될까?"
  - "내 학습 패턴의 약점이 뭔지 알고 싶어"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
  remote_mcp_note: >-
    think-tool이 있으면 다섯 가지 차원에서 사고 패턴을 분석하고
    맥락별 스타일 차이를 정확하게 포착할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Thinking Style Profiler

## When to Use / When Not to Use

**Use when:**
- Someone wants to understand their characteristic thinking tendencies
- Someone is stuck in a pattern they can't identify or name
- Learning or working strategies feel chronically mismatched

**Not for:**
- Simple study tips (give the tip directly)
- Diagnosing cognitive biases (use bias-auditor)

## Process

**First check:** Is this about characteristic style (run profile) or a quick learning tip (answer directly)?

**Do not administer all five diagnostic questions at once.** Ask one or two most relevant to the current struggle, then reflect back and invite correction.

### The Five Dimensions

| Dimension | Spectrum |
|-----------|---------|
| **1. Systems vs Detail** | Start from structure and fill in later vs build from specifics upward |
| **2. Convergent vs Divergent** | Move to one best answer quickly vs generate many options first |
| **3. Abstract vs Concrete** | Reason in principles and patterns vs need real examples to understand |
| **4. Intuitive vs Analytical** | Know the answer before explaining it vs build to conclusion from steps |
| **5. Sequential vs Non-linear** | Need step A before step B vs jump between levels and build a web |

Note: people occupy different positions per context (e.g., systems-oriented at work, concrete interpersonally). This is normal and useful.

### Strategy Matching (sample)

| Style | Key strategy |
|-------|-------------|
| Systems thinker | Build a rough map early; beware spending too long on it |
| Detail thinker | Zoom out weekly: "one-sentence summary of what I learned" |
| Convergent | Force 5 options before evaluating any |
| Divergent | Time-box: 20 min generation, then commit to one |
| Abstract | For every principle, find or create one concrete example |
| Concrete | After mastering an example, force the generalization |
| Intuitive | Keep a decision journal — calibrates intuition over time |
| Analytical | Practice provisional conclusions before complete information |
| Sequential | Create your own artificial sequence for non-linear problems |
| Non-linear | Use a "parking lot" — externalize unfinished threads |

## Output Template

1. **Profile summary** — 2–3 sentences on dominant tendencies and contexts where they shift
2. **Strengths** — what this profile is naturally good at
3. **Risk zones** — characteristic errors this profile makes
4. **Top 3 learning strategies** — matched to the profile, specific and actionable
5. **Developmental focus** — one thing to actively practice to expand range

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Asks focused diagnostic questions (not all at once) | Describe concrete situations where your thinking felt effortful or natural |
| Identifies the dominant tendencies across dimensions | Confirm whether the profile feels accurate |
| Maps tendencies to evidence-based learning strategies | Try the strategies and note which fit |
| Names the characteristic risk zones | Watch for those patterns when they arise |

**Key constraint:** Acknowledge style is contextual and developable — no style is better than another in the abstract.

## Related Skills

- `bias-auditor` — for cognitive biases rather than style tendencies
- `strength-growth-mapper` — for capability patterns and development edges
- `identity-explorer` — when thinking style feels like a core identity question
