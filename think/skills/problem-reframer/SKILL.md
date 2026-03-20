---
name: problem-reframer
description: Finds a better question when all solutions feel wrong. Use when someone has already tried multiple approaches and none of them feel right — the problem keeps resisting, solutions feel shallow, or there's a nagging sense that the wrong thing is being solved. Routing: use this when solutions have been tried; use brainstorming when none have been tried yet.
---

# Problem Reframer

A thinking partner that questions the problem itself before reaching for solutions. This skill challenges assumptions, inverts constraints, and reframes the problem space. It is distinct from brainstorming: brainstorming generates more solutions to an existing problem definition; this skill asks whether the problem is defined correctly in the first place.

## When to Use This vs. Brainstorming

| Situation | Use |
|-----------|-----|
| "I need more ideas for X" | Brainstorming |
| "I keep trying things but nothing works" | Problem Reframer |
| "What should I build?" | Brainstorming |
| "Why does this keep being a problem?" | Problem Reframer |
| "I have solutions but they all feel wrong" | Problem Reframer |
| "Maybe I'm solving the wrong thing" | Problem Reframer |

## Core Workflow

1. **Capture the stated problem** — Write it down exactly as presented. Do not editorialize yet.

2. **Surface hidden assumptions (Required gate — do not proceed until complete)**
   Use think-tool to privately enumerate candidate assumptions before any technique is selected or any output is drafted. Produce a structured list in this format:

   | Assumption | Why it might be false | Confidence |
   |---|---|---|
   | [assumption] | [reason it could be wrong] | high / medium / low |

   Do not begin the output phase until this table is complete.

3. **Apply reframing techniques** — Select 2–3 techniques most applicable to the stated problem. Techniques are independent and can be applied in parallel. Do NOT run all 7 sequentially — that produces redundant output. See `references/techniques.md` for definitions and examples.

   Techniques (summary):
   - **Assumption Reversal** — flip each embedded assumption
   - **5 Whys for Problem Framing** — find the level worth solving
   - **Constraint Removal** — remove the hard constraint, work backward
   - **Perspective Shift** — view through a different stakeholder's eyes
   - **Problem Inversion** — ask how to guarantee failure, then invert
   - **Level Shifting** — zoom out or zoom in from the current framing
   - **Reframe the Goal** — check whether the stated goal is a proxy for the real goal

4. **Generate reframed problem statements** — Produce 2–4 alternative ways to state the problem.
5. **Test the reframes** — For each: "If this were the real problem, what would change about how I'd approach it?"
6. **Select or synthesize** — Choose the framing that unlocks the most forward movement, or synthesize a sharper version.

## Concrete Examples

See `references/examples.md` for worked examples across software and non-software domains.

## Output Format

When reframing a problem, deliver:

1. **Stated problem** (verbatim or lightly cleaned up)
2. **Hidden assumptions** (structured table from Step 2)
3. **Reframed versions** (2–4 alternatives, each one sentence)
4. **Most promising reframe** with brief rationale
5. **One unlocking question** — the single question that, if answered, would most change how you approach this

Keep the output conversational, not academic. Reframes should feel like insight, not jargon.

## Constraints

### MUST DO
- Complete the think-tool assumption table (Step 2) before producing any output
- Start by listening and restating the problem before reframing it
- Offer multiple reframes — one is not enough
- Distinguish between reframing the problem and proposing a solution
- Ask at least one question that challenges whether the problem should be solved at all
- Stay domain-agnostic: apply the same rigor to personal, organizational, and technical problems

### MUST NOT DO
- Skip or abbreviate the Step 2 assumption enumeration gate
- Jump to solutions before completing the reframing
- Dismiss the original problem statement — acknowledge why it felt like the right frame
- Produce reframes that are just the same problem with different words
- Treat constraints as fixed until they have been explicitly questioned
- Conflate "more ideas" with "better problem definition"
