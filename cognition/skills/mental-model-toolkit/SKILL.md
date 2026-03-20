---
name: mental-model-toolkit
description: 'Use when someone is stuck on a problem and needs a different frame entirely, suspects they have blind spots, or has exhausted obvious solutions. Three instruments: choose the right mental model (first principles, inversion, Occam''s razor), systematically surface unknown unknowns, and break out of conventional solution gravity with lateral thinking. Distinct from second-order-thinker (consequence chains) and assumption-extractor (what''s being taken for granted).'
---

# Mental Model Toolkit

Thinking tools are leverage. The same problem looks different through different lenses — and some lenses reveal what others completely miss. This skill gives you three instruments: a curated mental model library, a systematic method for finding blind spots, and techniques for breaking out of obvious-solution gravity.

---

## Selecting the Right Instrument

| Situation | Instrument |
|---|---|
| Standard problem, want rigorous framing | Mental model library — pick the most relevant 1–2 models |
| Confident in a plan but want to stress-test it | Unknown unknowns — pre-mortem + assumption audit |
| Stuck, all obvious solutions tried | Lateral thinking — random entry or provocation |
| Surprised by an outcome, diagnosing what happened | Map vs territory + perspective expansion grid |
| Need to generate options before deciding | Lateral thinking — reversal + analogical thinking |
| Problem involves second-order effects | Second-order thinking + unknown unknowns |

---

## Instrument 1: Mental Model Library

A mental model is a simplified representation of how something works. The most powerful ones are cross-domain: they apply anywhere, not just in their origin field.

Full catalog: see `references/mental-models-catalog.md`

Key models at a glance: First Principles Thinking, Inversion, Map vs Territory, Occam's Razor, Second-Order Thinking, Pareto Principle (80/20), Regret Minimization, Chesterton's Fence.

Apply the model that fits the problem, not the one you already know best.

---

## Instrument 2: Unknown Unknowns Mapper

Known unknowns are the things you know you don't know. Unknown unknowns are what you don't know you don't know — and they are the source of the most expensive surprises.

You cannot directly observe blind spots. You have to create conditions where they become visible.

### Method 1: Pre-mortem

Before starting a project or making a decision, imagine it has already failed spectacularly. Ask: "It is 12 months from now. This failed completely. What happened?"

Generate at least 5 failure modes. For each, ask:
- Is this currently being accounted for?
- If not, what would it take to account for it?

This technique (Gary Klein) consistently surfaces risks that forward-looking planning misses, because it bypasses optimism bias.

### Method 2: Red Teaming

Assign someone — or yourself, explicitly — the role of adversary. Their job: find every way this plan fails, this assumption is wrong, or this approach is exploitable.

Rules for effective red teaming:
- The red team must argue positions they might not personally hold.
- No defending the plan during red team — just listen and note.
- A red team that only agrees is not a red team.

Mini red team prompt: "Steelman the case against this. If you were trying to kill this idea, what would you say?"

### Method 3: Outsider Perspective

Find someone unfamiliar with your domain and explain the situation. Note what they find confusing, obvious, or strange. Their confusion often points to assumptions you are not examining.

The Feynman test: if you cannot explain it clearly to a newcomer, you have not fully understood it — or there are gaps you have been papering over.

### Method 4: Assumption Audit

List every assumption your plan or model relies on. For each:
1. How confident are you in this assumption (0–100%)?
2. What happens to the plan if this assumption is wrong?
3. What evidence would change your confidence?

Assumptions with high impact and low confidence are your priority unknown unknowns.

### Method 5: Perspective Expansion Grid

Force yourself to inhabit each perspective systematically:

| Perspective | What do they see that I'm missing? |
|---|---|
| User / customer | |
| Skeptic / critic | |
| Future self (5 years out) | |
| Someone with the opposite worldview | |
| The person most harmed if this fails | |

Fill each cell honestly. Empty cells are not "not applicable" — they are cells you haven't thought hard enough about.

---

## Instrument 3: Lateral Thinking Prompter

Lateral thinking (Edward de Bono) generates solutions that are not reachable by straightforward logical extension of the current frame. It breaks the "gravity" of the obvious.

Full technique reference: see `references/lateral-thinking-techniques.md`

Techniques: Random Entry, Provocation (Po), Reversal, Analogical Thinking, Constraint Removal.

**MCP instruction:** If `mcp-reasoner` is available, use it for the lateral thinking step — lateral thinking explicitly requires multi-path exploration before selecting the best creative approach. This is mcp-reasoner's core use case.

---

## Output Format

1. **Diagnosis** (which instrument fits and why)
2. **Application** (work through the chosen technique with the user's specific problem)
3. **Outputs** (new frames, blind spots surfaced, lateral options generated)
4. **Most valuable insight** (the one thing that was not visible before this analysis)
5. **Next move** (one concrete action this unlocks)

---

## Constraints

**MUST DO**
- Select instruments based on the actual problem, not personal preference
- Apply techniques to the specific situation — do not just describe them abstractly
- Name the blind spot or new perspective explicitly; do not leave it implicit
- Challenge the user's framing if the instruments reveal it is limited

**MUST NOT DO**
- Do not apply all instruments to every problem — that is noise, not signal
- Do not use mental model names as decoration ("as Occam's Razor suggests...") without actually deriving something from the model
- Do not treat lateral thinking outputs as conclusions — they are starting points for evaluation
- Do not skip the "next move" — insights without action are just interesting
