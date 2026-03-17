# Why Subagent-Driven Development

## Advantages

**vs. Manual execution:**
- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)
- Subagent can ask questions (before AND during work)

**vs. Executing Plans:**
- Same session (no handoff)
- Continuous progress (no waiting)
- Review checkpoints automatic

**Efficiency gains:**
- No file reading overhead (controller provides full text)
- Controller curates exactly what context is needed
- Subagent gets complete information upfront
- Questions surfaced before work begins (not after)

**Quality gates:**
- Self-review catches issues before handoff
- Two-stage review: spec compliance, then code quality
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
2. The tasks are mostly independent (not tightly coupled with forced ordering)
3. You want to stay in the current session (not open parallel worktrees)

Use `executing-plans` instead when tasks need isolated sessions or parallel worktrees. Use manual execution or brainstorm first when you don't yet have a plan or tasks are tightly coupled.
