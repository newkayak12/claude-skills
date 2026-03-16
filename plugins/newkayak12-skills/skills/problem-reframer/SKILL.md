---
name: problem-reframer
description: Use when stuck on a problem and need a different angle — not more solutions, but a better question. Triggers on "why can't I solve this", "am I solving the wrong problem", needing to challenge assumptions, reframe constraints, or shift perspective. Works for any domain: software, career, product, life decisions.
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
2. **Surface hidden assumptions** — Use think-tool to privately enumerate candidate assumptions before committing to the final list. This prevents anchoring to the user's own framing. Then list every assumption embedded in the problem statement.
3. **Apply reframing techniques** — Select 2–3 techniques most applicable to the stated problem. Techniques are independent and can be applied in parallel. Do NOT run all 7 sequentially — that produces redundant output.
4. **Generate reframed problem statements** — Produce 2–4 alternative ways to state the problem.
5. **Test the reframes** — For each: "If this were the real problem, what would change about how I'd approach it?"
6. **Select or synthesize** — Choose the framing that unlocks the most forward movement, or synthesize a sharper version.

## Reframing Techniques

### 1. Assumption Reversal
List the assumptions baked into the problem, then flip each one.

Example: "Users aren't adopting our feature."
- Assumption: users know the feature exists → Reverse: what if they never discovered it?
- Assumption: the feature solves a real need → Reverse: what if there is no actual need?
- Assumption: adoption is the right metric → Reverse: what if low adoption means users solved it another way and are fine?

### 2. 5 Whys for Problem Framing
Ask "why is this a problem?" five times, not to find a root cause, but to find the level at which it is worth solving.

Example: "Our deployment takes 45 minutes."
- Why is that a problem? → It slows down iteration.
- Why is slow iteration a problem? → We can't respond to user feedback quickly.
- Why does that matter? → Competitors ship fixes faster.
- Why does that matter? → We lose users to competitors.
- Why does that matter? → Revenue is threatened.

Result: The real problem is competitive response time, not deployment duration. The solution space expands.

### 3. Constraint Removal Experiment
Ask: "If the constraint that makes this hard simply did not exist, what would you do?" Then work backward from that answer.

Example: "We can't refactor this legacy codebase — there's no time."
- Remove the constraint: if you had unlimited time, what would you do? → Rewrite the auth module cleanly.
- Work backward: is there a scope small enough to do that rewrite in one week? → Maybe just the token validation logic.
- Reframe: "How do we incrementally replace the auth module without a big-bang refactor?"

### 4. Perspective Shift
Examine the problem through the eyes of a different stakeholder, role, or expert.

Perspectives to try:
- The end user who never complains (silent sufferer)
- A competitor who solved this already
- Someone from a completely different industry (what would a logistics company do?)
- Your future self one year from now looking back
- The person who would be happiest if this problem never got solved (who benefits from the status quo?)

### 5. Problem Inversion
Instead of asking "how do I achieve X?", ask "how would I guarantee X never happens / always fails?"

Then invert the answers to find what you must do or avoid.

Example: "How do we improve team communication?"
- Inversion: "How would we guarantee communication breaks down completely?"
  - Never write decisions down
  - Have no shared vocabulary
  - Reward people for hoarding information
- Invert: document decisions, build shared vocabulary, make information sharing visible and rewarded.

### 6. Level Shifting
Zoom out (abstract) or zoom in (concrete) from where you are currently working.

- Zooming out: "We're fixing a bug in the payment flow" → "We're reducing failed transactions" → "We're making revenue reliable."
- Zooming in: "User engagement is low" → "Which specific screen has the highest drop-off?" → "What happens in the 10 seconds after the user lands on that screen?"

The right level to solve a problem is rarely the level at which it first appears.

### 7. Reframe the Goal
Ask whether the stated goal is actually the goal, or a proxy for it.

Example: "We need to write more tests."
- Is test count the goal? No.
- Underlying goal: confidence that code behaves correctly.
- Reframe: "How do we gain confidence that critical paths behave correctly?" (Answer might include tests, but also monitoring, types, or formal review.)

## Concrete Examples

See `references/examples.md` for worked examples across software and non-software domains.

## Output Format

When reframing a problem, deliver:

1. **Stated problem** (verbatim or lightly cleaned up)
2. **Hidden assumptions** (bullet list, 3–6 items)
3. **Reframed versions** (2–4 alternatives, each one sentence)
4. **Most promising reframe** with brief rationale
5. **One unlocking question** — the single question that, if answered, would most change how you approach this

Keep the output conversational, not academic. Reframes should feel like insight, not jargon.

## Constraints

### MUST DO
- Start by listening and restating the problem before reframing it
- Offer multiple reframes — one is not enough
- Distinguish between reframing the problem and proposing a solution
- Ask at least one question that challenges whether the problem should be solved at all
- Stay domain-agnostic: apply the same rigor to personal, organizational, and technical problems

### MUST NOT DO
- Jump to solutions before completing the reframing
- Dismiss the original problem statement — acknowledge why it felt like the right frame
- Produce reframes that are just the same problem with different words
- Treat constraints as fixed until they have been explicitly questioned
- Conflate "more ideas" with "better problem definition"
