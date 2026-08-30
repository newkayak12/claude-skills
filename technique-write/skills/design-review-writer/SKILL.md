---
name: design-review-writer
effort: high
description: >-
  Use when drafting a Design Review for a new feature or system. Triggers:
  "design review 써줘", "디자인 리뷰 문서", "RFC 초안", "write a design review", "이 기능 설계
  같이 잡자". Fixed 8-section template.
scenarios:
  - "결제 모듈 새로 만드는데 design review 같이 작성하자"
  - "알림 시스템 디자인 리뷰 초안 잡아줘"
  - "이 기능 리뷰 문서 어떻게 써야 할지 모르겠어, 같이 해줘"
  - "Help me draft a design review for our new search service"
  - "We're proposing to move to event sourcing — write the design doc"
  - "RFC 형식으로 이번 분기 인프라 변경 정리해줘"
compatibility:
  recommended:
    - think-tool
    - sequential-thinking
  optional:
    - mcp-reasoner
  remote_mcp_note: >-
    think-tool은 각 섹션 작성 전 핵심 질문을 정리하는 데 쓰입니다.
    sequential-thinking이 있으면 Background → Goals → Requirements → Design → Alternatives →
    Trade-offs → Impact 흐름을 강제로 한 칸씩 밟습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - brainstorming
  - devils-advocate
  - problem-reframer
  - architecture-designer
  - domain-driven-design
  - microservices-architect
  - bias-auditor
  - tradeoff-articulator
  - assumption-extractor
  - second-order-thinker
  - doc-coauthoring
  - adr-writer
---

## Standing Mandates

- NEVER draft all 8 sections in one shot — finish and confirm a section before moving on.
- ALWAYS produce at least 2 Alternatives in §6. One option is a proposal, not a review.
- ALWAYS run `devils-advocate` against the Proposed Design before writing §7.
- NEVER fill optional sections unless the user confirms they apply. Empty optional sections train reviewers to skim.

# Design Review Writer

Interactive guide that drives section-by-section discovery and writes the document in the team's fixed 8-section template. The user brings the topic; this skill drives questions, invokes the right collaborator skills, and assembles the artifact.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| New feature/system, multiple reasonable designs exist | One-line bug fix or refactor |
| Cross-team impact or hard-to-reverse choices | Internal-only tweak with no reviewers |
| Reviewers will use the doc as the decision artifact | Decision is already made — use `adr-writer` directly |

If the user already knows the decision, **stop and invoke `adr-writer`**. Design Reviews are for exploration; ADRs are for capture.

## Process

1. **Frame the topic** — get one-sentence intent, trigger, audience. If symptomatic, invoke `problem-reframer`.
2. **Fill §2 Background + §3 Goals/Non-Goals** — pull constraints; force Non-Goals.
3. **Fill §4 Requirements** — split functional/non-functional, quantify NFRs.
4. **Diverge** — invoke `brainstorming` for 3-5 alternatives; write §6 **before** §5 to avoid anchoring.
5. **Converge** — pick one as §5 Proposed Design (diagrams + flows; prefer Mermaid).
6. **Stress test** — `devils-advocate` → `bias-auditor` → `assumption-extractor`; then write §7 Trade-offs and §8 Impact Analysis.
7. **Decide optional sections** — only fill the ones the user confirms apply.
8. **Assemble + metadata** — Author, Reviewers, Status=Draft, Created today. Write **§1 Summary last**.

Full per-step playbook — including domain skill routing, optional-section signal table, and fallback when a related skill is missing — in `references/process-detail.md`. Read it when you reach the matching step.

## Output Template

Produce the document in this **exact** structure. Section numbering and headers are fixed.

```markdown
# Design Review: [기능/시스템명]

## Metadata
- **Author**: [이름]
- **Reviewers**: [이름 또는 팀]
- **Status**: Draft | In Review | Approved | Rejected
- **Created**: YYYY-MM-DD
- **Last Updated**: YYYY-MM-DD
- **Related**: [RFC #, ADR #, Ticket #]

## 1. Summary
- 무엇을, 왜 만드는지 3줄 이내 요약

## 2. Background & Context
- 현재 상황과 해결하려는 문제, 배경

## 3. Goals & Non-Goals
### Goals
- 이번에 달성할 것

### Non-Goals
- 이번 스코프에서 제외할 것

## 4. Requirements
### Functional
- 기능 요구사항

### Non-Functional
- 성능, 가용성, 보안, 확장성 등

## 5. Proposed Design
### High-Level Architecture
- 전체 구조 다이어그램

### Sequence / Flow
- 주요 시나리오 흐름

## 6. Alternatives Considered
- 검토한 옵션과 채택/탈락 사유

## 7. Trade-offs
- 채택안의 한계와 감수 비용

## 8. Impact Analysis
- 영향받는 서비스/팀/사용자 범위

---

## Optional Sections

### Migration / Rollout *(optional)*
- 배포 전략, 호환성, Feature Flag/Canary

### Rollback *(optional)*
- 롤백 조건과 절차

### Observability *(optional)*
- 메트릭, 로그/트레이싱, 알람

### Testing Strategy *(optional)*
- 테스트 레벨, 부하/장애 시나리오

### Security & Compliance *(optional)*
- 인증/인가, 민감 데이터, 규제

### Operational Concerns *(optional)*
- 장애 대응, 런북, 비용

### Open Questions *(optional)*
- 미결정 사항, 추가 검증 항목

### Timeline & Milestones *(optional)*
- 단계별 일정과 산출물

---

## Review Comments
- 리뷰어별 코멘트 / 결정 요약 형태로 정리
```

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drives the section-by-section interview | Provide real context, constraints, numbers |
| Invokes `brainstorming` / `devils-advocate` / `bias-auditor` at the right moment | Veto an invocation if you've already done that thinking |
| Quantifies vague requirements ("fast" → "<200ms p99") | Confirm numbers reflect actual SLOs |
| Names Non-Goals reviewers might assume are in scope | Confirm what's excluded |
| Drafts ≥ 2 alternatives in §6 with rejection reasons | Add any alternative the team already discussed |
| Auto-fills Created/Last Updated with today's date | Set Author and Reviewers |
| Flags one-sided trade-offs and forces honest §7 | Approve only when costs are stated, not hidden |

## Storage Convention

```
docs/design-reviews/
  YYYY-MM-DD-<short-slug>.md
```

When the Design Review is Approved, invoke `adr-writer` to produce the matching ADR. Cross-link both documents in their `Related:` metadata.

## Quick Checklist

- [ ] Topic stated in one sentence, not symptomatic
- [ ] Non-Goals section has at least 1 entry
- [ ] All NFRs are quantified
- [ ] §6 lists ≥ 2 alternatives with rejection reasons
- [ ] §7 trade-offs survived a devil's-advocate pass
- [ ] §8 includes at least one second-order impact
- [ ] Optional sections are either filled meaningfully or omitted
- [ ] §1 Summary written *after* §2-§8
- [ ] Reviewers named, Status set, Created date today

## Related Skills

- `brainstorming`, `devils-advocate`, `problem-reframer` — divergence and stress testing
- `architecture-designer` / `domain-driven-design` / `microservices-architect` — produce §5 diagrams
- `bias-auditor`, `tradeoff-articulator`, `assumption-extractor`, `second-order-thinker` — honest §7-§8
- `doc-coauthoring` — section-by-section co-write mechanics
- `adr-writer` — once Approved, convert to ADR

Fallback if any related skill is not installed: see `references/process-detail.md`.
