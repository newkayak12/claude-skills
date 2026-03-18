---
name: executing-plans
description: Use when you have a written implementation plan to execute in a separate session with review checkpoints
---

# Executing Plans

## Overview

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the executing-plans skill to implement this plan."

## The Process

### Step 0: Pre-condition Check

Before reading the plan, check two things:

1. **Subagent availability:** If subagents are available, stop and direct the user to `superpowers:subagent-driven-development` — it produces significantly higher quality results. If subagents are not available, continue with this skill.

2. **Workspace isolation:** Announce: "I'm setting up an isolated workspace using the using-git-worktrees skill."
   - **REQUIRED:** Use superpowers:using-git-worktrees before any plan file is read or any task is executed
   - This prevents work from landing accidentally on main/master

### Step 1: Load and Review Plan
1. Read plan file
2. Optionally invoke `sequential-thinking` to reason through plan coherence, dependency gaps, and ambiguous verification criteria before proceeding
3. Review critically - identify any questions or concerns about the plan
4. If concerns: Raise them with your human partner before starting
5. If no concerns: Create TodoWrite and proceed

### Step 2: Execute Tasks

For each task:
1. Mark as in_progress
2. Optionally use think-tool to confirm the step's intent and verification criteria before touching any files
3. Follow each step exactly (plan has bite-sized steps)
4. Run verifications as specified
5. Mark as completed

### Step 3: Complete Development

After all tasks complete and verified:
- Announce: "I'm using the finishing-a-development-branch skill to complete this work."
- **REQUIRED SUB-SKILL:** Use superpowers:finishing-a-development-branch
- Follow that skill to verify tests, present options, execute choice
- **If `finishing-a-development-branch` cannot be loaded:** Stop and notify the user with a summary of completed tasks and remaining steps.

## When to Stop and Ask for Help

**STOP executing immediately when:**
- Hit a blocker (missing dependency, test fails, instruction unclear)
- Plan has critical gaps preventing starting
- You don't understand an instruction
- Verification fails repeatedly

**Ask for clarification rather than guessing.**

## When to Revisit Earlier Steps

**Return to Review (Step 1) when:**
- Partner updates the plan based on your feedback
- Fundamental approach needs rethinking

**Don't force through blockers** - stop and ask.

## Remember
- Review plan critically first
- Follow plan steps exactly
- Don't skip verifications
- Reference skills when plan says to
- Stop when blocked, don't guess
- Never start implementation on main/master branch without explicit user consent

## Integration

**Required workflow skills:**
- **superpowers:using-git-worktrees** - REQUIRED: Invoked in Step 0 to set up isolated workspace
- **superpowers:writing-plans** - Creates the plan this skill executes
- **superpowers:finishing-a-development-branch** - REQUIRED: Complete development after all tasks
