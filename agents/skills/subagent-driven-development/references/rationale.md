# Why Subagent-Driven Development

## Advantages

**vs. Manual execution:**
- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Isolation (one subagent per task, no shared context)
- Subagent can ask questions (before AND during work)

**Efficiency gains:**
- No file reading overhead (controller provides full text)
- Controller curates exactly what context is needed
- Subagent gets complete information upfront
- Questions surfaced before work begins (not after)

**Quality gates:**
- Self-review catches issues before handoff
- Spec and code-quality reviewers dispatched in parallel; both must pass
- Review loops ensure fixes actually work
- Spec compliance prevents over/under-building
- Code quality ensures implementation is well-built

**Cost:**
- More subagent invocations (implementer + 2 reviewers per task)
- Controller does more prep work (extracting all tasks upfront)
- Review loops add iterations
- But catches issues early (cheaper than debugging later)

## When to Use: Decision Guide

Use this skill when all three conditions are met:

1. You have an implementation plan with defined tasks
2. The tasks are sequential or dependent and run one at a time in plan order
3. You want to stay in the current session

`planning:executing-plans` gates the plan and routes its sequential/dependent steps here. Use manual execution or brainstorm first when you don't yet have a plan.
