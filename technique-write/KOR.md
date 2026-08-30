# technique-write — 한국어

[English](README.md) · **한국어**

기술 의사결정을 남기는 두 가지 글쓰기 기법입니다. 둘 다 고정 템플릿으로 움직입니다. Design
Review는 아직 선택지가 열려 있을 때 탐색 과정을 담고, ADR은 결정이 끝난 뒤 그 결론을 단정형으로
박아서 결정한 사람들이 팀을 떠난 뒤에도 근거가 남게 합니다. 두 스킬 모두 구조를 즉흥으로 만들지
않습니다 — 섹션 이름과 순서는 고정이고, Claude는 정해진 순서대로 채웁니다.

## 설치 / 제거

```bash
/plugin install technique-write@newkayak12-claude-skills
/plugin uninstall technique-write@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 대안과 trade-off를 펼쳐 리뷰어가 물고 늘어질 문서 쓰기 | `design-review-writer` |
| 이미 내린 결정을 근거와 감수 비용까지 붙여 못 박기 | `adr-writer` |

## 스킬

### `design-review-writer`

섹션별로 질문을 몰아가며 8섹션 고정 템플릿으로 문서를 조립합니다. 한 번에 전 섹션을 쓰지 않고,
§6에 대안을 최소 2개 요구하고, §7 trade-off를 쓰기 전에 제안 설계에 `devils-advocate`를 돌리고,
§1 Summary는 맨 마지막에 씁니다. 한 줄짜리 수정에는 쓰지 마세요. 결정이 이미 끝났다면 이 스킬은
멈추고 `adr-writer`로 넘깁니다.

```
결제 모듈을 새로 만들려고 해. PG 연동이랑 정산 분리가 쟁점인데
design review 문서 같이 잡아줘.
```

고정 섹션 순서 (optional 섹션은 해당된다고 확인해줄 때만 채웁니다):

```text
Metadata → 1. Summary → 2. Background & Context → 3. Goals & Non-Goals
→ 4. Requirements (Functional / Non-Functional) → 5. Proposed Design
→ 6. Alternatives Considered → 7. Trade-offs → 8. Impact Analysis
→ Optional: Migration/Rollout · Rollback · Observability · Testing Strategy
           · Security & Compliance · Operational Concerns · Open Questions
           · Timeline & Milestones
→ Review Comments
```

저장 위치는 `docs/design-reviews/YYYY-MM-DD-<short-slug>.md`. Status가 Approved가 되면
`adr-writer`를 불러 두 문서를 서로 링크합니다.

### `adr-writer`

승인된 Design Review — 또는 맨 컨텍스트 — 를 번호 붙은 ADR로 만듭니다. Decision은 반드시 단정형
(`~를 채택한다`, `~로 한다`)이어야 하고 `~를 고려한다` 같은 헤지는 거부합니다. Consequences는 항상
세 칸을 다 채우며, Negative가 비면 그냥 두지 않고 `bias-auditor`를 부릅니다. Accepted된 ADR은
수정도 삭제도 하지 않습니다 — 새 ADR로 뒤집고 옛 문서에 `Superseded by ADR-XXXX`를 답니다.

```
Postgres 대신 Aurora로 가기로 결정했어. docs/design-reviews/2026-03-11-storage.md
기반으로 ADR 써줘. 기존 ADR-0001을 대체하는 거야.
```

고정 섹션 순서:

```text
# ADR-NNNN: [결정 제목]
Metadata (Status / Date / Deciders / Related)
→ Context → Decision → Rationale
→ Consequences (Positive / Negative / Neutral) → References
```

`docs/adr/NNNN-<slug>.md`에 순차 번호로 저장합니다:

```text
docs/adr/
  0001-use-postgresql-as-primary-store.md
  0002-adopt-kafka-for-inter-service-events.md
  0007-supersede-0001-migrate-to-aurora.md
```

## 대표 흐름

```
brainstorming → design-review-writer → (devils-advocate, bias-auditor) → adr-writer
```

## 마켓플레이스 내부 의존성

두 스킬 모두 다른 마켓플레이스 스킬을 협업자로 호출합니다:

- `think:brainstorming`, `think:devils-advocate`, `think:problem-reframer`
- `develop:architecture-designer`, `develop:domain-driven-design`, `develop:microservices-architect`
- `cognition:bias-auditor`, `cognition:assumption-extractor`, `cognition:tradeoff-articulator`,
  `cognition:second-order-thinker`
- `write:doc-coauthoring`, `write:writer-verification`

참조된 스킬이 설치되어 있지 않으면 Claude가 알려주고 설치할지 그냥 진행할지 물어봅니다. 대체
경로는 각 스킬의 `references/process-detail.md`에 있습니다.

## MCP

두 스킬 모두 `think-tool`과 `sequential-thinking`을 recommended로 둡니다. `sequential-thinking`은
고정 순서를 한 칸씩 강제하고, `think-tool`은 Consequences 항목이 어느 칸에 속하는지 판정하거나
Design Review 각 섹션 전에 핵심 질문을 정리할 때 씁니다. Claude 설정 → MCP Servers에서 remote SSE
엔드포인트를 추가하세요.
