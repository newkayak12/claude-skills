---
name: design-review-writer
description: >-
  Use when someone wants to draft a Design Review document for a new feature or
  system — the kind that captures background, goals, alternatives, trade-offs,
  and impact before code is written. Triggers on: "design review 써줘",
  "디자인 리뷰 문서 작성", "RFC 초안", "이 기능 설계 같이 잡자", "write a design review",
  "draft a design doc for this feature", "we need a design doc before building".
  Always invoke this skill instead of free-form drafting when the user asks for
  a Design Review — improvising the structure breaks the team's review workflow.
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

- NEVER draft all 8 sections in one shot — finish and confirm a section before moving on. Top-down drafts hide unresolved questions.
- ALWAYS produce at least 2 Alternatives in §6. A Design Review with one option is a proposal, not a review.
- ALWAYS run a devil's-advocate pass on the Proposed Design before writing §7 (Trade-offs). Trade-offs written without adversarial review default to marketing.
- NEVER fill optional sections (Migration, Rollback, Observability, Testing, Security, Operational, Open Questions, Timeline) unless the user confirms they apply. Empty optional sections train reviewers to skim.

# Design Review Writer

Interactive guide for producing a Design Review document in the team's fixed template. The user brings the topic; this skill drives discovery and writes the artifact.

## When to Use / When Not to Use

| Use | Skip |
|-----|------|
| New feature/system, multiple reasonable designs exist | One-line bug fix or refactor — overkill |
| Cross-team impact or hard-to-reverse choices | Internal-only tweak with no reviewers |
| Reviewers will use the doc as the decision artifact | The decision is already made — use `adr-writer` directly |

If the user already knows the decision, **stop and invoke `adr-writer`**. Design Reviews are for exploration; ADRs are for capture.

## Process

### Step 1 — Frame the topic (5 min)
Ask the user:
1. 한 문장으로, 무엇을 만들/바꾸려고 하나요?
2. 왜 지금인가요? (트리거 이벤트, 데드라인, 장애)
3. 이 문서를 누가 읽고 무엇을 결정해야 하나요?

If the answer to (1) is vague or symptomatic (`"속도가 느려서…"`, `"확장이 안 되어서…"`), invoke `problem-reframer` before continuing. A blurry topic produces a blurry §2.

### Step 2 — Fill §2 Background & Context and §3 Goals/Non-Goals
Pull current state from the user: system state, prior attempts, business pressure, constraints. Then split:
- **Goals** — measurable outcomes for *this* scope
- **Non-Goals** — things reviewers will ask about that you are deliberately excluding

Non-Goals are the most-skipped section and the most-valuable. If the user can't name any, ask: "What would a reviewer probably assume is in scope that isn't?"

### Step 3 — Fill §4 Requirements
Split functional vs. non-functional. Quantify NFRs (latency p99, RPS, RPO/RTO, concurrent users). Replace adjectives with numbers — "fast" becomes "<200ms p99".

### Step 4 — Diverge on alternatives (§6 first, before §5)
**Invoke `brainstorming`** to produce 3-5 candidate designs. Capture each with:
- Name
- One-paragraph sketch
- Strongest reason to adopt
- Strongest reason to reject

Writing §6 before §5 prevents the most common failure: anchoring on the first design that came to mind and back-rationalizing.

If the design space touches domain modeling, invoke `domain-driven-design`. If it touches service decomposition, invoke `microservices-architect`. If it's a topology/database/infrastructure choice, invoke `architecture-designer`.

### Step 5 — Converge and write §5 Proposed Design
Pick one alternative as the proposal. Document:
- **High-Level Architecture** — Mermaid/ASCII diagram or component list
- **Sequence / Flow** — the 1-2 most important runtime scenarios

For diagrams, prefer Mermaid (`sequenceDiagram`, `flowchart LR`) so the doc renders in GitHub/Confluence. Plain ASCII is fine as fallback.

### Step 6 — Stress test, then write §7 Trade-offs and §8 Impact Analysis
**Invoke `devils-advocate`** against the Proposed Design. Then **invoke `bias-auditor`** to check for confirmation bias and `assumption-extractor` to surface hidden assumptions in §2-5. Write trade-offs from what survives.

For §7, use `tradeoff-articulator` framing: "We accept X cost in order to gain Y benefit." Avoid one-sided bullet lists.

For §8 (Impact Analysis), invoke `second-order-thinker` to push past first-order ("Service A calls Service B") to second-order ("On-call rotation for Team C now covers a critical path").

### Step 7 — Decide optional sections
Ask the user which apply. Suggest based on signals:
| Signal in §2-§5 | Suggest |
|-----------------|---------|
| Migration from existing system | Migration / Rollout, Rollback |
| SLO mentioned in §4 | Observability |
| Touches PII, auth, payments | Security & Compliance |
| Multiple teams, on-call change | Operational Concerns |
| Unresolved questions remain | Open Questions |
| Has a deadline | Timeline & Milestones |

Empty optional sections train reviewers to skim. Either fill it meaningfully or omit it.

### Step 8 — Assemble the document and set metadata
Set:
- **Author** — the user (ask if unknown)
- **Reviewers** — ask who must sign off
- **Status** — `Draft` initially; flip to `In Review` when shared
- **Created** — today's date (YYYY-MM-DD)
- **Last Updated** — same as Created on first write

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

Write §1 *last* — a Summary written before the body is a wish, not a summary.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Drives the section-by-section interview | Provide real context, constraints, and numbers |
| Invokes `brainstorming` / `devils-advocate` / `bias-auditor` at the right moment | Veto an invocation if you've already done that thinking |
| Quantifies vague requirements ("fast" → "<200ms p99") | Confirm the numbers reflect actual SLOs |
| Names Non-Goals reviewers might assume are in scope | Confirm what's excluded |
| Drafts at least 2 alternatives in §6 with rejection reasons | Add any alternative the team already discussed |
| Auto-fills Created/Last Updated with today's date | Set Author and Reviewers |
| Flags one-sided trade-offs and forces honest §7 | Approve only when costs are stated, not hidden |

## Storage Convention

```
docs/design-reviews/
  YYYY-MM-DD-<short-slug>.md
```

When a Design Review is Approved, **invoke `adr-writer`** to produce the matching ADR. Cross-link both documents in their `Related:` metadata.

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

- `brainstorming` — diverge on alternatives for §6
- `devils-advocate` — stress-test the Proposed Design before §7
- `problem-reframer` — when the topic is symptomatic in Step 1
- `architecture-designer` / `domain-driven-design` / `microservices-architect` — produce §5 diagrams
- `bias-auditor` — confirmation-bias check before §7
- `tradeoff-articulator` — frame §7 as "accept X to gain Y"
- `assumption-extractor` — surface hidden assumptions in §2-§5
- `second-order-thinker` — push §8 past first-order impact
- `doc-coauthoring` — section-by-section co-write mechanics
- `adr-writer` — once the Design Review is Approved, convert to ADR

## If a related skill is not installed

If a referenced skill above is not available in the user's marketplace install, tell the user:

> "이 단계는 `[skill-name]` 스킬과 함께 쓰면 품질이 올라갑니다. 두 가지 선택지가 있습니다:
> 1. 마켓플레이스(`https://github.com/newkayak12/claude-skills`)에서 해당 플러그인을 설치 → 다시 진행
> 2. 설치 없이 진행 — 제가 스킬 이름에서 유추해 유사한 흐름으로 대신 수행 (품질은 다소 낮을 수 있음)
> 어느 쪽으로 진행할까요?"

Default to option 2 if the user says "그냥 진행" or doesn't respond after one ask.
