# Templates — 문서 템플릿 인덱스

Harness 사이클에서 *사용자와의 interaction*이 필요한 문서들의 템플릿. 각 템플릿의 0번 절은 *작성·운용 규칙*이며 *지우지 말 것*.

## 핵심 원칙: 이 문서들은 *Interaction-required*

> **Harness가 자동 생성으로 끝낼 수 없는 산출물.** 사용자(개발자 본인 또는 stakeholder)와의 *대화·합의·검토*를 거쳐야 의미를 갖는다.

이유:
- **RFC**는 *합의 도출* 자체가 목적. 작성자가 혼자 채우면 RFC가 아니라 자기 합리화.
- **Design Doc**은 *대안 비교*가 핵심. AI/하네스가 옵션을 채워줄 수 있어도 *trade-off 수용*은 사람이 한다.
- **ADR**은 *결정 선언*. 누가 책임지는지가 명시되어야 ADR의 무게가 생긴다.

→ Harness 흐름은 이 문서들의 *초안*을 준비할 수 있지만, *최종 합의*는 사용자 input 없이 종료되지 않는다.

## 문서 매트릭스

| 단계 | 의문 (논의 중) | 설계 (방향 정해짐) | 결정 (선언) |
|---|---|---|---|
| 형식 | [RFC](./rfc.md) | [Design Doc](./design-doc.md) | [ADR](./adr.md) |
| 제목 톤 | 의문형/제안형 ("~할까") | 명사구 ("주문 동시성 제어") | 단정형 ("X를 사용한다") |
| 시제 | 가정형 ("~이면 ~할 것이다") | 미래형/조건형 ("~할 것이다") | 현재형 ("~한다") |
| 가변성 | 갱신 가능 | 갱신 가능 | 불변 (append-only) |
| 길이 | 짧게 — 합의 도구 | 중간 — 구현 청사진 | 1-2p — 결정 압축 |
| 주 사용자 | 리뷰어 | 구현자 | 미래의 본인/팀 |

## 문서 라이프사이클

```
아이디어
   ↓
[RFC] ──Proposed → Under Review → Accepted / Rejected
   ↓ (Accepted)
[Design Doc] ──Draft → Review → Approved → Implemented
   ↓ (구현 중 핵심 결정 발생)
[ADR] ──Proposed → Accepted (불변)
   ↓ (수년 후 결정이 더 이상 유효하지 않을 때)
[ADR-new] Supersedes [ADR-old]
```

- RFC → Design Doc: *합의*가 *설계*로 구체화.
- Design Doc → ADR: 설계 *내부의 큰 결정*을 압축 보존.
- ADR 갱신: *수정 금지*. 새 ADR로 대체 + Superseded-by 링크.

## 공통 원칙

이 세 문서를 *함께* 운용할 때의 규칙.

### SSOT (Single Source of Truth) 준수
- 같은 내용을 여러 문서에 중복 서술하지 말 것 → 문서 간 *링크*로 연결.
- 예: ADR의 Context에 Design Doc 배경을 복사하지 말고 Design Doc 링크.
- 변경 시 *한 곳만* 갱신하면 되도록 구조화.

### 시제 일관성
- ADR: 결정 *선언* (현재형) — "PostgreSQL을 사용한다"
- RFC: *제안* (가정형) — "PostgreSQL을 사용하면 ~할 것이다"
- Design Doc: *설계* (미래형/조건형) — "주문 처리기는 ~을 호출한다"

시제가 섞이면 문서 타입이 흐려진다.

### 번호 규칙
- RFC: `RFC-NNN` (3자리), 파일 `NNN-name.md`
- ADR: `ADR-XXXX` (4자리), 파일 `XXXX-name.md`
- Design Doc: 번호 없이 *명사 제목*, 파일 `<topic>-design.md`

### 상호 참조
- ADR은 그 결정을 *유발한* RFC/Design Doc을 *반드시* 링크.
- Design Doc은 *내부의 큰 결정*을 ADR로 분리하고 *링크*.
- RFC가 Accepted → Design Doc 생성 시 RFC를 *Background로 참조*.

## Harness 흐름에서의 위치

| 단계 | 사용되는 문서 |
|---|---|
| [01 Product Track](../01-product-track.md) — Persona/SRS | (SRS template 사용, RFC는 큰 방향 전환 시) |
| [02 Tech Track](../02-tech-track.md) — Architecture/Stack/DB | RFC → Design Doc → ADR (스택·아키텍처 결정마다) |
| [03 Validation Loops](../03-validation-loops.md) Loop 2 | Design Doc의 Risks/Rollout이 검증 기준 |
| [07 Looping Mechanics](../07-looping-mechanics.md) Pivot 시 | 새 RFC로 시작, 이전 ADR은 Superseded |
| [10 Post-launch](../10-post-launch.md) | 운영 결정마다 ADR 추가 |

→ **이 문서들이 *없는* 사이클은 위험이 *암묵*에 묻혀 있는 사이클**.

## 템플릿 파일

- [rfc.md](./rfc.md) — 합의 전 제안
- [design-doc.md](./design-doc.md) — 설계 청사진
- [adr.md](./adr.md) — 결정 선언
- [srs.md](./srs.md) — Software Requirements Specification (슬림판)

## 관련 룰
- [`R-PG02`](../06-rules.md) — Decision documentation gate
- [`C-04`](../situational-rules/cognitive.md#c-04-devils-advocate-on-irreversible-decisions) — ADR + Devil's Advocate on irreversible
- [`C-09`](../situational-rules/cognitive.md#c-09-decision의-reversibility-등급) — Reversibility 등급별 문서화 깊이
