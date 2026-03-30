---
name: mental-model-toolkit
description: >-
  Use when someone is stuck on a problem and needs a different frame entirely, suspects they
  have blind spots, or has exhausted obvious solutions. Three instruments: choose the right
  mental model, systematically surface unknown unknowns, and break out of conventional solution
  gravity with lateral thinking.
  Triggers on: "different perspective", "stuck on this", "blind spots", "creative solution",
  "다른 관점", "막혀 있어", "뭘 놓치고 있는 건지", "새로운 접근법", "창의적 해결책".
  Best for: reframing stuck problems, stress-testing plans via pre-mortem, generating non-obvious options.
  Not for: downstream consequence analysis (use second-order-thinker), assumption audits (use assumption-extractor).

scenarios:
  - "I've tried everything obvious — what am I missing?"
  - "Help me find blind spots in this plan"
  - "Give me a completely different frame for this problem"
  - "뻔한 해결책 말고 다른 관점으로 접근해줘"
  - "이 계획에서 내가 놓치고 있는 게 뭘까?"
  - "이 문제를 다른 방식으로 볼 수 있어?"

compatibility:
  recommended:
    - think-tool
  optional:
    - sequential-thinking
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool이 있으면 어떤 도구(mental model·unknown unknowns·lateral thinking)가 이 문제에 맞는지
    정확히 진단할 수 있습니다. mcp-reasoner는 lateral thinking 단계에서 다중 경로 탐색에 유용합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Mental Model Toolkit

## When to Use / When Not to Use

**Use when:**
- All obvious solutions have been tried and the problem persists
- A plan is being finalized and needs stress-testing for hidden risks
- A fresh frame would unlock options not visible from the current angle

**Not for:**
- Mapping downstream consequences (use second-order-thinker)
- Auditing specific assumptions (use assumption-extractor)

## Process

**Diagnose which instrument fits before applying:**

| Situation | Instrument |
|-----------|-----------|
| Standard problem, want rigorous framing | Mental model library |
| Confident in plan, want stress-test | Unknown unknowns mapper |
| Stuck, obvious solutions tried | Lateral thinking prompter |
| Surprised by outcome, diagnosing cause | Map vs territory + perspective grid |

---

### Instrument 1 — Mental Model Library

Key models: First Principles Thinking, Inversion, Map vs Territory, Occam's Razor, Second-Order Thinking, Pareto (80/20), Regret Minimization, Chesterton's Fence.

Full catalog: see `references/mental-models-catalog.md`

Apply the model that fits the problem — not the one you already know best. Use the model to actually derive something, not as decoration.

---

### Instrument 2 — Unknown Unknowns Mapper

You cannot observe blind spots directly. Create conditions where they become visible.

- **Pre-mortem:** Imagine it's 12 months out and this failed spectacularly. What happened? Generate 5+ failure modes.
- **Red teaming:** Argue the case against the plan without defending it.
- **Outsider perspective:** Explain to someone unfamiliar — their confusion points to unexamined assumptions.
- **Assumption audit:** List every assumption; rate confidence (0–100%) and impact if wrong.
- **Perspective expansion:** Inhabit each viewpoint (user, skeptic, future self, opposite worldview, most harmed).

---

### Instrument 3 — Lateral Thinking Prompter

Techniques: Random Entry, Provocation (Po), Reversal, Analogical Thinking, Constraint Removal.

Full reference: see `references/lateral-thinking-techniques.md`

**MCP note:** If `mcp-reasoner` is available, use it here — lateral thinking requires multi-path exploration before selecting the best creative approach.

## Output Template

1. **Diagnosis** — which instrument fits and why
2. **Application** — work through the chosen technique with the specific problem
3. **Outputs** — new frames, blind spots surfaced, lateral options generated
4. **Most valuable insight** — what was not visible before this analysis
5. **Next move** — one concrete action this unlocks

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Selects the right instrument based on the problem type | Provide the stuck problem or plan |
| Applies techniques to your specific situation (not abstractly) | Confirm whether the new frame resonates |
| Names blind spots and new perspectives explicitly | Decide which insight changes how you act |
| Generates lateral options as starting points for evaluation | Evaluate and build on those options |

## Related Skills

- `second-order-thinker` — for consequence chains once a new frame is chosen
- `assumption-extractor` — for systematic assumption auditing
- `tradeoff-articulator` — for mapping costs when multiple options emerge
