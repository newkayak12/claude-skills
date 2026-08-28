---
name: decision
description: >-
  Use when someone wants help reaching, reviewing, or documenting a consequential
  decision across technical, product, work, career, leadership, or personal contexts.
  Not for a simple factual lookup or a choice the user has already asked to execute.
type: workflow
effort: high
scenarios:
  - "이 선택 같이 결정해줘. 근거와 반론까지 보고 추천해줘"
  - "지금 제안대로 가도 되는지 우리 knowledge까지 찾아서 검토해줘"
  - "A와 B 중 무엇을 선택할지 포괄적으로 판단을 도와줘"
  - "Stress-test this decision, recommend a direction, and capture what remains uncertain"
  - "Review this architecture decision and tell me whether to approve it"
compatibility:
  recommended:
    - think-tool
  optional:
    - mcp-reasoner
    - sequential-thinking
  remote_mcp_note: >-
    Reasoning MCPs may help with high-stakes or multi-criteria decisions, but the
    workflow must remain usable through its declared plugin dependencies alone.
---

# Decision Assist

Help the user make a better decision. Compose existing marketplace skills instead of
reimplementing their methods, but invoke only the skills that close a real gap in the
current decision state.

## Standing Mandates

- Optimize for decision quality, not dependency count. Never run the full dependency graph by default.
- Give a recommendation when the user asks what to choose. A tradeoff matrix alone is not decision assistance.
- Keep the user as decision owner. Do not turn advice into permission for execution, publication, purchase, contact, or other external action.
- Separate evidence, inference, preference, and uncertainty. Never smooth conflicting skill outputs into false consensus.
- Match rigor to stakes and reversibility. A reversible choice should not receive one-way-door ceremony.
- Preserve the user's constraints and values; challenge them only when they appear assumed, contradictory, or load-bearing.
- End with the smallest useful next step or verification, not an unsolicited implementation plan.

## Start With a Decision Contract

Capture what is already known without forcing a long intake:

```yaml
decision: the choice or approval being considered
owner: who makes the call
deadline: when the call is needed, if relevant
options: known candidates, including status quo when real
constraints: hard boundaries
success: what a good outcome changes
stakes: low | medium | high
reversibility: reversible | costly-to-reverse | one-way-door
domain: technical | product | work | career | leadership | personal | mixed
```

Infer low-risk missing fields when context supports it. Ask only for a missing fact that
would materially change the route or recommendation. If there is no real choice yet,
clarify the decision before analyzing it.

Maintain the fuller working state in [references/decision-state.md](references/decision-state.md).

## Select a Mode

| Mode | Use when | Default depth |
|---|---|---|
| `quick` | Low/medium stakes, reversible, enough context | frame only if needed; compare; recommend |
| `deliberate` | High stakes, costly-to-reverse, uncertain evidence, or cross-functional impact | retrieve; frame; expand; stress-test; calibrate; recommend |
| `review` | A proposal or preferred option already exists | reconstruct rationale; seek disconfirmation; verdict |

Escalate `quick` to `deliberate` when a supposedly simple decision contains legal,
security, production, material financial, employment, health, or identity consequences.
Downgrade ceremony when a small experiment can cheaply resolve the uncertainty.

## Compose the Route

Read [references/skill-routing.md](references/skill-routing.md) after selecting the mode
and domain. Route by missing state rather than calling skills in a fixed procession.

### 1. Ground the context

- Use `knowledge:knowledge-query` only when an existing vault, graph, RAG corpus, or source inventory can materially inform this decision. Ask it for candidate evidence and provenance; do not adopt its answer as the decision verdict.
- Inspect user-provided and repository evidence before relying on general memory.
- Use the relevant domain skill when specialist constraints can change the option set or feasibility.

### 2. Repair the frame

- Use `think:problem-reframer` when the stated problem may be a symptom or repeated solutions feel wrong.
- Use `cognition:question-upgrader` when the question embeds a weak proxy, false binary, or unclear success criterion.
- Use `think:first-principles` when inherited constraints or conventional wisdom dominate the choice.

Skip reframing when the decision and success condition are already crisp.

### 3. Make the option set real

- Include the status quo when it is feasible; do not manufacture it when delay is impossible.
- Use `think:brainstorming` when fewer than two viable alternatives remain or the current options share the same hidden assumption.
- Use domain skills to reject infeasible options before spending time comparing them.

### 4. Challenge what carries the decision

- Use `cognition:assumption-extractor` for load-bearing premises.
- Use `cognition:epistemic-reasoner` when confidence exceeds evidence or forecasts drive the choice.
- Use `think:devils-advocate` for `deliberate` and `review` modes, or whenever one option became preferred before meaningful disconfirmation.
- Use `cognition:bias-auditor` or `cognition:fallacy-detector` only when judgment distortion or an explicit reasoning chain is actually present.
- Use `cognition:second-order-thinker` when consequences propagate to other people, systems, incentives, or future choices.

For a broad high-stakes review, `cognition:critical-thinking-workflow` may replace its
component calls. Do not run both the full workflow and the same component skills unless a
specific unresolved finding justifies the repeat.

### 5. Compare and recommend

- Use `cognition:tradeoff-articulator` to expose real cost axes and opportunity costs.
- Weight the comparison using the user's success condition, constraints, values, risk tolerance, deadline, and reversibility. Do not invent numeric precision.
- State one of: `choose`, `run a bounded experiment`, `defer pending named evidence`, or `reject the current option set`.
- Give the strongest reason the recommendation could still be wrong and assign a calibrated confidence.

### 6. Commit only as far as requested

- Use `technique-write:design-review-writer` when a technical proposal still needs review.
- Use `technique-write:adr-writer` when a technical decision has been accepted and needs a durable record.
- Use `write:writing-plans` or `planning:roadmap-planning` only when the user asks to turn the decision into action.
- Do not implement the decision unless the user separately authorizes implementation.

## Resolve Skill Disagreement

When dependency outputs conflict:

1. Prefer direct, current, source-grounded evidence over analogy or generic practice.
2. Prefer hard constraints over scored preference.
3. Treat disagreement about facts as an evidence gap, not a tradeoff.
4. Treat disagreement about values as a decision-owner choice, not something the model can prove.
5. Surface the conflict and explain whether resolving it would change the recommendation.

## Output

Adapt length to the decision, but preserve these elements:

```markdown
Recommendation: [choose / experiment / defer / reject]
Confidence: [high / moderate / low] — [why]

Why this direction:
- Decision-specific reasons tied to evidence and success criteria.

What it costs:
- Opportunity costs, risks, and who bears them.

Strongest objection:
- The best case against the recommendation and whether it was resolved.

What would change the recommendation:
- Named evidence, threshold, or changed constraint.

Next step:
- One bounded action, check, or decision record.

Evidence:
- Stable paths, source references, records, or explicitly labeled general knowledge.
```

For `review` mode, lead with `approve`, `approve with conditions`, `revise`, or `reject`.
For `quick` mode, compress the body rather than omitting uncertainty or the next step.

## Quality Bar

- The decision is explicit and has an owner, success condition, and realistic options.
- The route used only skills that changed or tested a material part of the decision.
- Important claims are source-grounded or labeled as inference/general knowledge.
- At least one meaningful disconfirmation attempt was made for a consequential recommendation.
- The recommendation accounts for tradeoffs, confidence, reversibility, and what could change it.
- The handoff stops at advice, documentation, or planning unless broader action was authorized.
