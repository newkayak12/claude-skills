# ADR-XXXX: `<결정 한 줄 요약 — 단정형>`

> **MADR (Markdown Architecture Decision Record) format.**
> 한 결정 = 한 파일. 번호는 4자리 zero-padded. 파일명 예: `0007-use-postgres-as-primary-store.md`.

## 0. Rules — 작성·운용 규칙 (보존 절)

이 절은 *지우지 말 것*. ADR이 ADR답기 위한 최소 규율.

- **제목은 단정형/결정형**: "PostgreSQL을 사용한다", "분산 락에 Redisson을 채택한다" — *결정 자체를 선언*. 의문형/제안형은 RFC ([`rfc.md`](./rfc.md)).
- **Status는 단일 상태**: Proposed / Accepted / Deprecated / Superseded 중 하나. 중간 상태 만들지 말 것.
- **불변 (append-only)**: 결정이 바뀌면 *수정하지 말고 새 ADR로 대체* → 원본은 `Superseded by ADR-XXXX`로 표기. 히스토리 보존.
- **Context는 사실만**: 결정 시점의 *제약·배경*을 객관적으로. 여기서 해결책을 서술하면 ADR이 아니라 Design Doc.
- **Consequences는 양면 기술**: 긍정 + 부정 결과 *모두*. Trade-off를 정직하게 — *모두 긍정*이면 결정이 아니라 광고.
- **간결하게 (1-2p)**: 상세 설계는 Design Doc 몫. ADR은 *결정 압축*. 길어지면 Design Doc로 분리.
- **시제**: 현재형으로 결정 *선언* — "X를 사용한다", "Y를 도입한다".



| Field | Value |
|---|---|
| Status | Proposed / Accepted / Deprecated / Superseded by [ADR-XXXX](./XXXX-name.md) |
| Date | YYYY-MM-DD |
| Deciders | <이름들> |
| Related Design Doc | <링크> |
| Related ADRs | ADR-0003 (참조), ADR-0005 (대체) |

---

## Context and Problem Statement

*왜* 이 결정이 필요한가? 어떤 *문제·기회·제약*이 이 결정을 강제하는가?

이 절은 "현재 상태 + 결정해야 할 질문 한 문장"으로 끝난다. 예:

> 현재 시스템은 모놀리스 PostgreSQL에 모든 데이터를 저장한다. 신규 분석 기능에서 *분석 쿼리가 트랜잭션 부하에 영향을 미친다*. **분석 워크로드를 어떻게 분리할 것인가?**

## Decision Drivers

이 결정을 좌우하는 *기준* (가중치 표기 가능):

- 운영 복잡도 (1인 개발자 핵심) ★★★
- 비용
- 분석 쿼리 응답 시간 < 5초
- 트랜잭션 부하 무영향
- 데이터 신선도 (얼마나 실시간이어야 하나)

## Considered Options

### Option 1: <이름>

**설명**: 무엇을 하는가, 어떻게 동작하는가 (2-4문장).

**Pros**:
- 장점 1
- 장점 2

**Cons**:
- 단점 1
- 단점 2

### Option 2: <이름>

(동일 구조)

### Option 3: <이름>

(동일 구조)

> Option은 *최소 3개* 권장. 2개면 발산 부족, "분명히 안 될 옵션"을 포함시키면 *진짜 옵션의 윤곽*이 잘 보임.

## Decision Outcome

**Chosen option**: "Option N — <이름>"

**Rationale** (왜 이 옵션):
- Driver A를 가장 잘 충족
- Driver B는 차선이지만 trade-off 수용 가능
- 운영 복잡도가 가장 낮음 (1인 운영 가능)

### Positive Consequences

- 무엇이 좋아지는가
- 어떤 능력이 열리는가

### Negative Consequences

- 무엇을 포기하는가
- 어떤 부담이 새로 생기는가
- 어떤 *기술 부채*가 의도적으로 받아들여지는가

### Trade-offs (Sensitivity / Tipping Points)

이 결정이 *언제 잘못된 결정이 될 것인가*:
- 데이터 규모가 X TB를 넘으면 재검토
- 분석 쿼리가 Y개를 넘으면 별도 OLAP 도입 고려
- 비용이 월 $Z를 넘으면 self-hosted로 전환 검토

## Implementation Notes (선택)

- 마이그레이션 단계
- Feature flag 전략
- 모니터링 추가 항목
- 의존 ADR 또는 후속 ADR 후보

## References

- 외부 자료 (벤더 문서, 블로그, 비교 글)
- 선행 사례 (prior art) — 다른 팀/회사의 같은 결정
- 관련 측정/벤치마크 결과 링크

---

## 부록: Status 전이 규칙

- **Proposed**: 토론 단계. 변경 가능.
- **Accepted**: 시스템에 반영되거나 반영 예정. *수정 금지* — 바꾸려면 새 ADR로.
- **Deprecated**: 더 이상 권장 안 함. 아직 시스템에 잔존할 수 있음.
- **Superseded by ADR-XXXX**: 다른 ADR로 대체됨. *원본은 남겨둔다* (히스토리).
