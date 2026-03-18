---
name: retrospective
description: Use when conducting a personal or project retrospective — sprint end, project close, weekly/monthly review, or when asked to "회고", "돌아보기", "스프린트 리뷰", "이번 주 회고", or "프로젝트 마무리". Guides structured reflection using KPT, 5 Whys, or timeline formats and produces concrete action items.
---

# Retrospective

Structured retrospective facilitator that turns reflection into actionable improvement.

## MCP Usage

- **When format = 5 Whys** → invoke `sequential-thinking` for the causal chain. Each "why" must explicitly build on the previous answer, making the chain auditable and allowing backtracking if a step turns out to be wrong.
- **Before generating the final output template** → invoke `think-tool` to verify every Problem has at least one mapped Try. This enforces the Problem→Try completeness check before output is produced.

---

## Core Workflow

> **Important:** Do NOT generate the full KPT output until Phase 2. In Phase 1, ask structured questions section by section and wait for user responses before moving on.
>
> **Data dump shortcut:** If the user has already provided retrospective data (e.g., pasted notes or a bullet list), skip Phase 1 and proceed directly to Phase 2, mapping the provided content to the chosen format.

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

---

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
- Invoke `sequential-thinking` for the causal chain (see MCP Usage above)
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

---

## Action Item Format

Every action item must follow this structure:

```
[ACTION] <verb + specific outcome>
- Owner: <person or role>
- Due: <date or next sprint>
- Success metric: <how we know it's done>
- Maps to: <Problem/issue it addresses>
```

---

## Output Template and Examples

See `references/output-templates.md` for the standard output template and a concrete sprint retrospective example.

For solo retrospective adjustments, see `references/solo-retro.md`.

---

## Constraints

### MUST DO
- Always produce at least one concrete action item with owner and due date
- Map every Try/action to a specific Problem or opportunity
- End every retrospective with a "다음 회고" section to close the loop
- Keep the tone constructive — focus on systems, not blame
- For 5 Whys, verify each "why" is evidence-based before proceeding
- Use think-tool before generating the final output to verify Problem→Try completeness

### MUST NOT DO
- Stop at reflection without action items
- Accept vague actions ("더 잘하기", "커뮤니케이션 개선") — push for specificity
- Skip the insight synthesis step — patterns matter more than individual events
- Produce more than 5 action items per retrospective (focus beats volume)
- Re-ask for data the user has already provided in their opening message
