# MCP Catalog

Available MCP tools for use in skills. Reference this when advising on MCP usage.

---

## `mcp__claude_ai_sequential-thinking__sequentialthinking`

**What it does:** Structures multi-step reasoning by forcing explicit, sequential thought progression. Each step builds on the previous. Can revise earlier steps if new information changes the picture.

**Best for:**
- Multi-factor decisions where intermediate conclusions must be tracked
- Problems where jumping to an answer too quickly causes errors
- Tasks with 5+ reasoning steps where losing track of earlier conclusions is a real risk
- Generating output that must be logically derived step-by-step (e.g., architectural decisions, debugging chain)

**Not worth it for:**
- Tasks with fewer than 3 reasoning steps
- Lookup/retrieval tasks (the answer is in the input, not derived)
- High-speed tasks where latency matters more than reasoning depth
- Creative tasks where structured progression kills spontaneity

**Usage pattern:**
```
Use sequential-thinking when the skill needs to reason through [X] before producing [Y].
The model should call sequentialthinking with the problem statement, then use the structured output to inform the next step.
```

---

## `mcp__claude_ai_think-tool__think`

**What it does:** Provides an explicit "pause and think" space before acting. The model writes out its reasoning without it counting as output — similar to scratchpad thinking. Useful before tool calls, before making decisions, or before producing final output.

**Best for:**
- Before consequential tool calls (prevents acting on incomplete analysis)
- Evaluating tradeoffs between options (when the skill asks "choose the best approach")
- Working through ambiguous inputs before committing to an interpretation
- Any step in the skill where "think first, act second" would reduce errors

**Not worth it for:**
- Mechanical steps with no judgment involved
- Steps where the action is fully determined by the input (no interpretation needed)
- After sequential-thinking has already structured the reasoning

**Usage pattern:**
```
Before [decision step], use think-tool to reason through the options.
This prevents the model from defaulting to the first option that comes to mind.
```

---

## `mcp__claude_ai_reasoner__mcp-reasoner`

**What it does:** Implements advanced reasoning strategies (beam search, MCTS) to explore a problem space. Generates and evaluates multiple candidate solutions before selecting the best. Most powerful for open-ended problems where the solution space is large.

**Best for:**
- Architecture and design decisions where multiple valid approaches exist
- Complex debugging where the root cause isn't obvious
- Problems where backtracking is needed (a path that seemed promising turns out wrong)
- Generating rigorously argued outputs (e.g., security reviews, design critiques)
- Any task where the skill explicitly asks for the "best" solution across a solution space

**Not worth it for:**
- Problems with a single correct answer (use regular reasoning)
- Time-sensitive tasks (mcp-reasoner is slower)
- Tasks where the solution space is well-bounded and small

**Usage pattern:**
```
For the [design/analysis] step, use mcp-reasoner to explore multiple approaches
before committing to one. This is especially important because [reason: the solution
space is large / errors here are hard to recover from / etc.].
```

---

## Choosing between them

| Situation | Best tool |
|-----------|-----------|
| Need to build up reasoning step by step | `sequential-thinking` |
| Need to pause and think before acting | `think-tool` |
| Need to explore multiple solution paths | `mcp-reasoner` |
| Need structured progression + scratchpad | Both `sequential-thinking` + `think-tool` |
| Complex open-ended decision | `mcp-reasoner` alone |
| Simple task, no real reasoning needed | None |

---

## When to recommend MCPs in skills

MCPs add latency and tokens. Only recommend them when:
1. The skill asks the model to make a non-trivial judgment call
2. The skill's output quality is sensitive to reasoning quality
3. The cost of a wrong answer is high (hard to undo, visible to users, etc.)

Don't recommend MCPs for:
- Steps that are deterministic (given input X, always do Y)
- Steps that are already well-specified (the skill tells the model exactly what to do)
- The full skill — recommend MCPs for specific steps, not the whole workflow
