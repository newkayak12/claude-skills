---
name: dispatching-parallel-agents
description: >-
  Use when facing 2+ independent tasks that can run concurrently without shared state.
  Triggers on: "병렬로 처리해줘", "동시에 여러 작업", "parallel agents", "여러 에이전트 동시 실행",
  "독립적인 작업들 한번에", "multiple independent failures", "파일이 서로 겹치지 않아".
  Best for: multiple failing test files with different root causes, parallel code reviews,
  independent module fixes, simultaneous report generation.
  Not for: related failures (fixing one may fix others), tasks with shared state or file overlap.
scenarios:
  - "세 개 테스트 파일이 각각 다른 이유로 실패해 — 병렬로 고쳐줘"
  - "두 서브시스템 각각 독립적으로 리팩토링해줘"
  - "Run code reviews on these three separate modules in parallel"
  - "독립적인 버그 세 개를 동시에 처리해줘"
  - "Generate these two reports simultaneously"
  - "각 팀의 독립적인 작업 동시에 진행해줘"
compatibility:
  recommended:
    - sequential-thinking  # pre-dispatch independence check — confirms no shared files or causal links
  optional:
    - think-tool           # verify true independence before dispatching
  remote_mcp_note: >-
    think-tool이 있으면 병렬 실행 전 에이전트 간 파일 충돌이나 인과 관계가 없는지 확인할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

# Dispatching Parallel Agents

## Overview

When you have multiple independent work streams — different failing test files, separate code reviews, independent reports to generate, isolated module refactors — working on them sequentially wastes time. Each task is independent and can happen in parallel.

**Core principle:** Dispatch one agent per independent problem domain. Let them work concurrently.

## When to Use

```
Multiple tasks or failures?
  No  → Single agent handles it
  Yes → Are they independent? (no shared files, no causal relationship)
          No  → Single agent investigates all (related — fix one may fix others)
          Yes → Can they work in parallel? (no shared state)
                  No  → Sequential agents
                  Yes → Parallel dispatch
```

**Use when:**
- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Parallel code reviews across separate modules
- Generating multiple independent reports simultaneously
- Running independent linters or audits on separate subsystems
- Each problem can be understood without context from others
- No shared state between investigations

**Don't use when:**
- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other

## The Pattern

### 1. Identify Independent Domains

Group failures by what's broken:
- File A tests: Tool approval flow
- File B tests: Batch completion behavior
- File C tests: Abort functionality

Each domain is independent - fixing tool approval doesn't affect abort tests.

### 2. Create Focused Agent Tasks

Each agent gets:
- **Specific scope:** One test file or subsystem
- **Clear goal:** Make these tests pass
- **Constraints:** Don't change other code
- **Expected output:** Summary of what you found and fixed

### 2.5. Verify Independence (think-tool)

Before dispatching, use think-tool to confirm true independence. Check:
1. No two agents will edit the same files
2. Failures have no causal relationship (fixing one won't fix others)
3. Each domain can be fully understood without context from the others

Only proceed to parallel dispatch after this check passes. A bad parallelism decision — dispatching agents that turn out to be coupled — wastes more time than sequential investigation would have.

### 3. Dispatch in Parallel

```typescript
// In Claude Code / AI environment
Task("Fix agent-tool-abort.test.ts failures")
Task("Fix batch-completion-behavior.test.ts failures")
Task("Fix tool-approval-race-conditions.test.ts failures")
// All three run concurrently
```

### 4. Review and Integrate

When agents return:
- Read each summary
- Verify fixes don't conflict
- Run full test suite
- Integrate all changes

## Agent Prompt Structure

Good agent prompts are:
1. **Focused** - One clear problem domain
2. **Self-contained** - All context needed to understand the problem
3. **Specific about output** - What should the agent return?

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:

1. Read the test file and understand what each test verifies
2. Identify root cause - timing issues or actual bugs?
3. Fix by:
   - Replacing arbitrary timeouts with event-based waiting
   - Fixing bugs in abort implementation if found
   - Adjusting test expectations if testing changed behavior

Do NOT just increase timeouts - find the real issue.

Return: Summary of what you found and what you fixed.
```

## Common Mistakes

**❌ Too broad:** "Fix all the tests" - agent gets lost
**✅ Specific:** "Fix agent-tool-abort.test.ts" - focused scope

**❌ No context:** "Fix the race condition" - agent doesn't know where
**✅ Context:** Paste the error messages and test names

**❌ No constraints:** Agent might refactor everything
**✅ Constraints:** "Do NOT change production code" or "Fix tests only"

**❌ Vague output:** "Fix it" - you don't know what changed
**✅ Specific:** "Return summary of root cause and changes"

## When NOT to Use

**Related failures:** Fixing one might fix others - investigate together first
**Need full context:** Understanding requires seeing entire system
**Exploratory debugging:** You don't know what's broken yet
**Shared state:** Agents would interfere (editing same files, using same resources)

## Real Example from Session

**Scenario:** 6 test failures across 3 files after major refactoring

**Failures:**
- agent-tool-abort.test.ts: 3 failures (timing issues)
- batch-completion-behavior.test.ts: 2 failures (tools not executing)
- tool-approval-race-conditions.test.ts: 1 failure (execution count = 0)

**Decision:** Independent domains - abort logic separate from batch completion separate from race conditions

**Dispatch:**
```
Agent 1 → Fix agent-tool-abort.test.ts
Agent 2 → Fix batch-completion-behavior.test.ts
Agent 3 → Fix tool-approval-race-conditions.test.ts
```

**Results:**
- Agent 1: Replaced timeouts with event-based waiting
- Agent 2: Fixed event structure bug (threadId in wrong place)
- Agent 3: Added wait for async tool execution to complete

**Integration:** All fixes independent, no conflicts, full suite green

**Time saved:** 3 problems solved in parallel vs sequentially

## Key Benefits

1. **Parallelization** - Multiple investigations happen simultaneously
2. **Focus** - Each agent has narrow scope, less context to track
3. **Independence** - Agents don't interfere with each other
4. **Speed** - 3 problems solved in time of 1

## Verification

After agents return:
1. **Review each summary** - Understand what changed
2. **Check for conflicts** - Did agents edit same code?
3. **Run full suite** - Verify all fixes work together
4. **Spot check** - Agents can make systematic errors

