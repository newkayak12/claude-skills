# RFC-NNN: `<제안 한 줄 — 의문/제안형으로>`

> **RFC (Request for Comments).** 합의 *전* 단계의 문서. 결정 선언이 아니라 *제안*이다.
> 파일명 예: `0003-introduce-event-driven-order-flow.md`. 번호는 3-4자리 zero-padded.

| Field | Value |
|---|---|
| Status | Proposed / Under Review / Accepted / Rejected / Superseded |
| Date | YYYY-MM-DD |
| Author | <이름> |
| Reviewers | <이름들> |
| Related Design Doc | <링크 — Accepted 이후 생성> |
| Related ADRs | <링크 — 결정 후 생성> |

---

## 0. Rules — 작성·운용 규칙 (보존 절)

이 절은 *지우지 말 것*. RFC가 RFC답기 위한 최소 규율.

- **제목은 의문/제안형**: "주문 동시성을 이벤트 큐로 풀까", "분산 락 도입 제안" — 아직 합의 전이므로 *단정 금지*.
- **Motivation 먼저, 해결책 나중**: 문제 공감 없이는 합의 안 됨. Detailed Design을 먼저 읽혀도 안 됨.
- **Alternatives는 공정하게 서술**: 미채택안도 *진지하게* — 합의 도출이 목적. Strawman 금지 ([`C-07`](../situational-rules/cognitive.md)).
- **Unresolved Questions를 비우지 말 것**: 열린 질문이 리뷰어 참여를 유도. 비어 있으면 *합의된 척*에 가깝다.
- **Status는 가변**: Proposed → Under Review → Accepted/Rejected로 *반드시* 갱신. 갱신 없는 RFC는 죽은 문서.
- **Decision은 논의 종료 후 기입**: 작성 시점엔 *비워둠*. 채워서 시작하면 RFC가 아니라 통보문.

## 1. Summary

3-5 문장. *무엇*을 제안하는가, *왜* 지금인가, *어떤 변화*가 일어나는가.

## 2. Motivation

*해결책을 적기 전*에 *문제*를 먼저.

- 현재 어떤 상태인가? 어떤 신호·사건이 트리거인가?
- 왜 *지금* 다뤄야 하는가? 미루면 어떤 비용이 누적되는가?
- *누가* 영향을 받는가? (사용자, 다른 모듈, 운영)
- 측정 가능한 형태로 문제를 명시 — 모호한 "성능 문제"는 RFC 시작 자격 미달.

## 3. Detailed Design

선택한 접근의 *구체적 형태*. 어디까지 디테일을 적을지는 *논의에 필요한 수준*까지.

- 핵심 동작 / 데이터 흐름 / 인터페이스
- 변경 범위 — *어디까지*가 영향권인가
- 단계적 도입 가능성

> 상세 설계가 Design Doc 수준으로 커지면 분리. RFC는 *합의를 얻기 위한 형태*까지만.

## 4. Drawbacks

이 제안의 *단점*. *없다*고 적으면 거의 항상 *못 본* 것.

- 새로 생기는 운영·인지 부하
- 트레이드오프 — 무엇과 무엇을 바꾸는가
- 기존 사용자/모듈에 미치는 비호환 가능성

## 5. Alternatives

기각된 옵션을 *공정하게* 서술. 본 제안에 유리한 비교만 적으면 합의 신뢰 상실.

### Alt 1: <이름>
- 핵심 차이:
- 장점:
- 단점:
- 기각 사유:

### Alt 2: <이름>
- (동일 구조)

### Alt 0: 아무것도 안 함 (status quo)
- 비용:
- 리스크:
- 언제까지 견딜 수 있는가:

## 6. Unresolved Questions

*비워두지 말 것*. 열린 질문이 리뷰의 입구.

- [ ] 미해결 1
- [ ] 미해결 2
- [ ] 미해결 3

## 7. Decision / Outcome

> 작성 시점엔 *비워둠*. 논의 종료 후 채운다.

**Accepted/Rejected 시 기입**:
- 결정 일자
- 핵심 논의 요약 (반대 의견의 강한 버전 포함)
- 후속 산출물 — Design Doc 또는 ADR 링크

## 관련 룰
- [`C-03 Steelman`](../situational-rules/cognitive.md#c-03-steelman-the-opposing-view) — 반대 의견 강하게 재구성
- [`C-07 Strawman vs Steelman`](../situational-rules/cognitive.md#c-07-strawman-vs-steelman-구분) — 본인이 양측을 다 쓸 때 위험
- [`R-PG02 Decision documentation`](../06-rules.md) — Process Gate
