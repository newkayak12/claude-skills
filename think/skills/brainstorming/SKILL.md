---
name: brainstorming
description: >-
  Use when something needs to be designed or built and the shape of the solution
  isn't clear yet. Triggers on: "어떻게 만들지?", "기능 설계해줘", "아키텍처 잡아줘", "뭘 어떻게 구현해야
  해?", "design this feature", "how should we build X?", "새 서비스 어떻게 시작하지?".
  Always invoke before writing any code or scaffolding any project — even simple ones.
scenarios:
  - "OAuth 로그인 기능 어떻게 설계해?"
  - "알림 시스템 새로 만들어야 하는데 어떻게 접근해?"
  - "We need to design a rate limiting system"
  - "새 CLI 툴 어떻게 구조 잡으면 좋을까?"
  - "How should I architect this new microservice?"
  - "대시보드 기능 추가하려는데 어디서부터 시작해?"
compatibility:
  optional:
    - think-tool        # surfaces trade-offs before presenting approaches
    - sequential-thinking  # for multi-step design sequences
    - mcp-reasoner      # for evaluating complex architectural alternatives
  remote_mcp_note: >-
    think-tool이 있으면 설계 옵션을 제시하기 전에 trade-off를 체계적으로 검토할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - decision-maker
  - problem-reframer
  - thought-organizer
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs through focused dialogue — one question at a time, with alternatives and trade-offs before any implementation begins.

## The Gate

**Do not write code, scaffold files, or invoke any implementation skill until the user has approved a design.** This applies even to "simple" projects. The cost of designing first is low; the cost of implementing the wrong thing is high. The design can be short — a few sentences for a simple change — but it must exist and the user must confirm it.

Design artifacts are: architecture diagrams, component descriptions, data models as tables, trade-off comparisons, and natural-language flow descriptions. Not design artifacts: named API commands with signatures, specific library calls, executable pseudocode, or command-level schemas (e.g., Redis key formats with exact Lua logic). If you catch yourself writing `ZADD key score member` or equivalent, you've left design and entered implementation — stop.

If a request appears simple, it's still worth asking: *what problem exactly are we solving?* Unexamined assumptions cause the most wasted work on "simple" things.

## Flow

```
1. Explore context → 2. Clarify (one Q at a time) → 3. Propose 2-3 approaches
                                                              ↓
                                    5. Implement via writing-plans ← 4. Present design + get approval
```

### 1. Explore Context

Before asking questions, read the project: files, docs, recent commits. Understand what already exists. For existing codebases, look for patterns you should follow, and problems in the affected code worth addressing as part of this change.

If the request describes multiple independent subsystems ("build a platform with chat, billing, analytics, and file storage"), flag this immediately rather than spending questions refining details of a scope that needs decomposition first. Help the user break it into independent sub-projects, each with its own design cycle.

### 2. Clarify

Ask one question at a time. Prefer multiple choice when the options are clear. Focus on: purpose, constraints, success criteria, and what "done" looks like.

Wait for the answer before asking the next question.

### 3. Propose Approaches

Once you understand the problem, offer 2–3 approaches with trade-offs. Don't present just one solution — the value here is in making the design space visible. If `think-tool` is available, invoke it before presenting to surface trade-offs you might otherwise compress. Lead with your recommended option and explain why.

If only one approach is genuinely viable, say so and explain why the others don't fit.

### 4. Present Design

Once the user picks or modifies an approach, present the design. Scale each section to its complexity — a few sentences if straightforward, more detail if there's genuine nuance to work through. Cover: architecture, components, data flow, error handling, testing.

Ask after each major section whether it looks right. Be ready to revise.

### 5. After Approval

Once the user approves the design, invoke `writing-plans` to create the implementation plan. Do not invoke any other skill (frontend-developer, mcp-builder, etc.) — the output of brainstorming is a plan, not running code.

## Design Principles

**Isolation and clarity:** Break the system into units that each have one clear purpose, communicate through defined interfaces, and can be understood independently. For each unit: what does it do, how do you use it, what does it depend on? Smaller, well-bounded units are easier to reason about and modify.

**YAGNI:** Remove features not needed for the stated goal. Don't design for hypothetical future requirements.

**Working in existing code:** Follow existing patterns. Where the code has problems that affect this change (a file grown too large, tangled dependencies), include targeted improvements in the design — the way a good developer improves code they're working in. Don't propose unrelated refactoring.

## Visual Companion

A browser-based companion for showing mockups, diagrams, and visual options during brainstorming. When upcoming questions involve visual content (layouts, architecture diagrams, mockups), offer it once:

> "Some of what we're working on might be easier to show than describe — I can put together mockups and diagrams in a browser as we go. Still experimental and token-intensive. Want to try it? (Needs a local URL to be opened)"

**This offer must be its own message, nothing else.** Wait for a response before continuing. If declined, proceed text-only.

Even after accepting, decide per question: **would this be clearer as a visual than as text?** Use the browser for actual visual content (wireframes, layout comparisons, architecture diagrams). Use text for conceptual questions, trade-off lists, and scope decisions.

If they agree, read `skills/brainstorming/visual-companion.md` before proceeding.

## Related Skills

- `decision-maker` — 여러 설계 옵션이 나왔고 최종 선택이 필요할 때
- `problem-reframer` — 아이디어를 내려 해도 계속 막힐 때, 문제 정의 자체를 다시 점검할 때
- `thought-organizer` — 발산된 아이디어가 많아 구조화하고 우선순위를 잡아야 할 때
