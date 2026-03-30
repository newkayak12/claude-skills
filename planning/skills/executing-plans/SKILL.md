---
name: executing-plans
description: >-
  Use when there is a written implementation plan to execute step by step with review checkpoints.
  Triggers on: "계획 실행해줘", "plan 따라 구현해줘", "execute this plan", "implementation plan 실행",
  "plan 파일 있는데 실행해줘", "서브에이전트 없이 계획 실행".
  Best for: executing plans in a separate session without subagents, with checkpoint reviews.
  Not for: creating plans (use writing-plans) or subagent-based execution (use subagent-driven-development).
scenarios:
  - "이 구현 계획 실행해줘"
  - "Plan 파일 있는데 그대로 따라 실행해줘"
  - "Execute this implementation plan step by step"
  - "서브에이전트 없이 계획 실행해야 해"
  - "Plan 있는데 단계별로 체크하면서 진행해줘"
  - "Walk through this plan and execute it"
compatibility:
  recommended:
    - sequential-thinking  # plan review and coherence check before execution
  optional:
    - think-tool           # confirming step intent and verification criteria before touching files
  remote_mcp_note: >-
    sequential-thinking이 있으면 계획의 일관성과 의존성 갭을 실행 전에 체계적으로 검토할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
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
