# Design Doc — `<프로젝트/기능 이름 — 명사구>`

## 0. Rules — 작성·운용 규칙 (보존 절)

이 절은 *지우지 말 것*. Design Doc이 Design Doc답기 위한 최소 규율.

- **제목은 명사구**: "주문 동시성 제어", "결제 정산 파이프라인" — *동작·대상 중심*. 의문형은 RFC, 단정형은 ADR.
- **Non-Goals 명시 필수**: *안 할 것*을 적어야 scope creep 방지. Non-Goals 없는 Design Doc은 미완성.
- **Overview는 마지막에 작성**: 본문 완성 후 요약해야 정확. 먼저 쓰면 본문이 Overview에 맞춰 왜곡됨.
- **Alternatives Considered 필수**: "*왜* 이 설계인가"가 문서의 핵심 가치. 대안이 없으면 design이 아니라 implementation note.
- **Risks엔 롤백 전략 포함**: 실패 시나리오 + 롤백이 없는 설계는 미완성. Forward-only design은 두 번 실패한다.
- **헤더 깊이 3단계 이내**: 가독성 우선. 4단계 이상이면 절을 쪼개거나 하위 문서로 분리.
- **시제**: 미래형/조건형으로 *설계 서술* — "X는 Y를 수행한다", "Z를 처리할 것이다".



| Field | Value |
|---|---|
| Author | <이름> |
| Status | Draft / Review / Approved / Implemented / Superseded |
| Created | YYYY-MM-DD |
| Last Updated | YYYY-MM-DD |
| Related ADRs | ADR-0001, ADR-0002 |
| Related SRS | <링크> |

---

## 1. Summary (TL;DR)

3-5문장. *왜* 이 변경이 필요한가, *무엇*을 바꾸는가, *어떤 trade-off*가 있는가. 읽는 사람이 이 절만 읽고 "더 읽을지" 결정할 수 있어야 한다.

## 2. Goals / Non-Goals

### Goals
- 이 변경이 *반드시 달성해야* 하는 것 (3-5개)
- 측정 가능한 형태로 (예: "P95 응답 200ms 이하", "동시 사용자 1k 지원")

### Non-Goals
- *명시적으로 다루지 않는* 것 (3-5개)
- "Non-goal"이 없는 design doc은 scope creep 위험.

## 3. Context / Background

이 변경의 *배경*. 다음 질문에 답한다:
- 현재 시스템은 어떻게 동작하는가?
- 왜 지금 이걸 바꿔야 하는가? (어떤 신호/사건이 트리거가 됐나)
- 비즈니스/제품 측 동기는? (PRD 또는 SRS 링크)
- 누가 영향을 받는가? (사용자, 다른 팀, 외부 시스템)

## 4. Requirements

### Functional
- FR-1: ...
- FR-2: ...

### Non-Functional (FURPS+ 점검)
- **Performance**: P95 응답 < ___ms, 처리량 ___ rps
- **Availability**: 가용성 ___%, MTTR < ___분
- **Security**: 인증 ___, 권한 ___, PII 처리 ___
- **Scalability**: 동시 사용자 ___, 데이터 증가율 ___
- **Observability**: 로그/메트릭/트레이스 표준
- **Maintainability**: 테스트 커버리지 목표, 코드 표준
- **Compatibility**: 지원 브라우저/OS, 데이터 마이그레이션 호환
- **Compliance**: GDPR, PCI-DSS, ...

## 5. Proposed Solution

### High-level Approach

선택한 접근의 *개요*. 1-2 문단. 핵심 결정은 ADR로 분리하고 여기서는 *링크*.

### Architecture

C4 Context 다이어그램 (시스템 + 외부 actor/system):

```
[다이어그램 또는 ASCII art]
```

C4 Container 다이어그램 (배포 단위):

```
[다이어그램 또는 ASCII art]
```

(복잡한 컨테이너만 Component 다이어그램 추가)

### Data Model

핵심 엔티티와 관계. 정규화된 ER:

```
[ER 다이어그램 또는 표]
```

주요 엔티티 명세 (필드, 타입, 제약):

| Entity | Field | Type | Constraint | Note |
|---|---|---|---|---|
| User | id | UUID | PK | |
| User | email | varchar(255) | UNIQUE, NOT NULL | |
| ... | ... | ... | ... | |

### Key Flows

핵심 시나리오의 시퀀스 (글 또는 다이어그램):

**Flow: 사용자 로그인**
1. 클라이언트가 `/auth/login`에 이메일·비밀번호 POST
2. Auth 서비스가 자격증명 검증
3. 성공 시 JWT 발급, 쿠키로 전달
4. 실패 시 rate limit counter 증가, 5회 후 잠금

(에러 경로도 명시)

### API / Interface

외부에 노출되는 인터페이스 — endpoint, 메시지 포맷, 이벤트 스키마.

```
POST /auth/login
Request:  { email, password }
Response: 200 { token, user } | 401 { code, message }
```

### Cross-cutting Concerns

- **Logging**: 포맷 / 레벨 / correlation ID
- **Error handling**: 분류 / retry / circuit breaker
- **Authentication / Authorization**: 흐름 / 토큰 / 권한 모델
- **Configuration**: env vs config / secret 관리
- **Observability**: 핵심 메트릭, 알람 임계값
- **Idempotency**: 재시도 안전성
- **Timezone & i18n**: 저장 단위, locale 처리

## 6. Alternatives Considered

각 대안마다 *간단히 +/- 정리*. 깊은 분석이 필요한 결정은 ADR로 분리하고 여기서는 *요약*만.

### Alt 1: <대안 이름>
- 장점:
- 단점:
- 기각 사유:

### Alt 2: <대안 이름>
- 장점:
- 단점:
- 기각 사유:

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation | Trigger |
|---|---|---|---|---|
| 외부 API 장애 시 로그인 불가 | M | H | 캐시 + graceful degradation | API 5xx > 1% |
| DB 마이그레이션 중 다운타임 | L | H | 무중단 마이그레이션 (expand/contract) | 변경 적용 시 |

## 8. Rollout Plan

- **Phase 0**: Spike / POC 결과 검토 (Loop 2 통과 확인)
- **Phase 1**: Feature flag 뒤 배포, 내부 사용자 only
- **Phase 2**: 10% 점진 rollout, 메트릭 모니터링
- **Phase 3**: 100%, feature flag 제거
- **Rollback**: 트리거 / 절차 / 책임자

## 9. Test Strategy

- Unit tests: 어떤 모듈
- Integration tests: 어떤 경로
- E2E tests: 핵심 시나리오 (Loop 1에서 정의한 acceptance)
- Performance tests: NFR과 매칭되는 부하 시나리오
- Chaos tests: (해당 시) 장애 주입 시나리오

## 10. Open Questions

- [ ] 미해결 결정 1
- [ ] 미해결 결정 2

(답이 나오면 ADR로 옮기거나 본문 업데이트)

## 11. References

- 관련 ADR
- 관련 SRS / PRD
- 외부 참고 자료
- 선행 사례 / prior art
