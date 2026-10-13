---
name: architecture-workflow
description: >-
  Use when designing a system from scratch, evaluating a monolith-to-MSA
  migration, or needing a structured end-to-end architecture process from domain
  discovery to documentation. Triggers on: "system architecture from scratch".
type: workflow
theme: architecture
scenarios:
  - "Design a full architecture for our new e-commerce platform from domain events to ADRs"
  - "We need to evaluate whether to break our monolith into microservices — walk me through the process"
  - "Greenfield system design: take me from domain modeling through to architecture decisions"
  - "처음부터 아키텍처 전체 프로세스 진행해줘"
  - "모놀리스를 마이크로서비스로 전환할지 평가하고 설계까지 해줘"
  - "새 시스템 도메인 모델링부터 ADR 작성까지 단계별로 가보자"
estimated_time: "1-3 days (full), 2-6 hours per step"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 서비스 경계 결정, 아키텍처 트레이드오프 분석, ADR 작성에서 특히 유효합니다.
    sequential-thinking은 각 단계 간 컨텍스트를 유지하며 순서를 강제합니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER run a step on a missing input. A step's input absent (no domain description, no boundaries from Step 3) is
  `[확인 필요: ○○]` and the run stops there or the user says to skip. (Scar: a layer design drawn over boundaries nobody
  validated got redone when Step 3 moved them.)
- NEVER drift to microservices. Step 6 runs only if Step 3 or the user's constraints call for distribution; the default
  is a modular monolith.
- NEVER restate a step skill's method here; invoke it by name, relay its verdict, and never grade its output yourself.
- Goal: each step run or skipped with a reason, the ADR trail (Step 7) holds one ADR per decision, and the closing
  tally recounts to the step lines. One step per turn unless the user asks to continue.

# Architecture Workflow

7-step process: domain discovery, modeling, boundary validation, layering, system design, distribution, ADRs.

**Not for** a single-skill task (call that skill), iterating inside a stable architecture or one service's quick
refactor, or ranking refactor targets in an existing repo (`develop:architecture-review`).

## Steps

| # | Skill | Input | Output | Skip if |
|---|-------|-------|--------|---------|
| 1 | `event-storming` | Domain description, stakeholder knowledge | Bounded context map, event timeline, aggregate candidates, hotspots | Domain well-modeled, contexts documented |
| 2 | `domain-driven-design` | Contexts from 1 (or existing knowledge) | Context map, glossary, aggregates with invariants, event list | A validated DDD model exists |
| 3 | `service-boundary-validator` | Domain model from 2 | Coupling report, data ownership map, split/merge/keep per boundary | New monolith, no decomposition within 12 months |
| 4 | `clean-architecture` | Validated boundaries from 3 | Layer diagram, dependency score, interface contracts, refactoring plan | Stateless functions needing 2 layers or fewer |
| 5 | `architecture-designer` | Steps 2–4 | System diagram, technology picks, NFR coverage, risks | Stack and topology already approved |
| 6 | `architecture-designer` (Distributed Topology), optional | Steps 3 and 5 | Service inventory, sync/async map, data-per-service, observability | Staying on a monolith or modular monolith |
| 7 | `write:plans` (ADR format) | Decisions from 1–6 | One ADR per decision in `docs/adr/`, numbered, status set | Never skipped |

Start prompts: "Step N 시작" or name the skill. Say where you are and the run joins there ("도메인은 정리됨, Step 3부터";
"모놀리스 유지" → Steps 4–5–7; "이미 MSA, ADR만" → Step 7).

## Output Template

```
## Architecture workflow — <system>

| Step | Skill | Status (done / skipped: <reason> / blocked: [확인 필요: ○○]) | Artifact |
|------|-------|-----|----------|

Next: <step N, or "complete">
<d> done · <s> skipped · <b> blocked · <a> ADRs written
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Runs each step skill and carries its output to the next | Provide domain experts, team ownership, SLAs; confirm invariants and language |
| Flags a missing input before the step runs | Make the technology and topology decisions |
| Writes ADRs with alternatives and consequences | Approve wording, store ADRs in the repo |

## Related Skills

- Before: `think:redefine-problem` — early-stage decision framing before Step 1
- After: `teams:develop` — run the implementation through the graph once architecture is set
- After: `develop:spring-boot-engineer` or `develop:kotlin-specialist` — implementation after Step 7
