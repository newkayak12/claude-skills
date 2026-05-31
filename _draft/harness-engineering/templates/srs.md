# SRS — `<제품/시스템 이름>` (Lean version)

> ISO/IEC/IEEE 29148:2018 + IEEE 830의 슬림 버전.
> 1인 개발자 / 소규모 팀용. 풀버전이 필요해지면 항목을 확장한다.

| Field | Value |
|---|---|
| Version | 0.1 |
| Status | Draft / Approved / In Implementation / Released |
| Author | <이름> |
| Created | YYYY-MM-DD |
| Last Updated | YYYY-MM-DD |
| Related Design Doc | <링크> |

---

## 1. Introduction

### 1.1 Purpose

이 문서의 목적. 누가 읽는가, 무엇을 결정하기 위한가.

### 1.2 Scope

이 시스템이 *하는 일*과 *하지 않는 일*. 경계 명시.

### 1.3 Definitions, Acronyms, Abbreviations

| 용어 | 정의 |
|---|---|
| JTBD | Jobs-to-be-Done |
| ... | ... |

### 1.4 References

- 관련 문서 (PRD, Design Doc, ADR)
- 외부 표준 (KSC, ISO, 법령)

## 2. Overall Description

### 2.1 Product Perspective

이 시스템은 어떤 *생태계*에 속하는가? 다른 시스템과의 관계는?

### 2.2 User Characteristics (Persona 요약)

| Persona | 기술 수준 | 사용 빈도 | 주요 JTBD |
|---|---|---|---|
| <이름> | <수준> | <빈도> | <JTBD> |

(상세는 별도 Persona 문서 링크)

### 2.3 Operating Environment

- 클라이언트: 지원 브라우저 / OS / 디바이스
- 서버: 배포 환경, 의존 인프라
- 네트워크: 최소 대역폭 / latency 가정

### 2.4 Design and Implementation Constraints

- 기술적 제약 (예: 기존 시스템과 통합 필요)
- 법적/규제적 제약 (개인정보보호, PCI-DSS, GDPR …)
- 라이선스 / 호스팅 제약

### 2.5 Assumptions and Dependencies

- 가정: "사용자는 인증된 상태로 시작한다"
- 의존: 외부 API X, 결제 PG Y, ...
- 가정이 *깨지면* 어떻게 되는가?

## 3. Functional Requirements

각 FR은 *측정 가능*해야 하고 *acceptance criteria*가 있어야 한다.

### FR-001: <기능명>

**User Story**:
> As a [persona], I want [capability], so that [outcome].

**Description**: 1-3 문단.

**Acceptance Criteria** (Gherkin):
```gherkin
Scenario: <시나리오 이름>
  Given <전제>
  When <동작>
  Then <기대 결과>

Scenario: <에러 시나리오>
  Given ...
  When ...
  Then ...
```

**Priority**: Must / Should / Could / Won't (MoSCoW)

**Related**: UJM 단계 X.X, ADR-NNNN

---

### FR-002: <기능명>

(동일 구조)

---

## 4. Non-Functional Requirements

수치를 명시한다. "빠르다" 같은 표현 금지.

### 4.1 Performance
- 응답 시간: P95 < ___ms, P99 < ___ms (핵심 경로별)
- 처리량: ___ rps (특정 시나리오)
- 자원: 메모리 < ___ MB, CPU < ___ % (단일 인스턴스)

### 4.2 Reliability / Availability
- 가용성: ___% (월간)
- MTTR: < ___ 분
- 데이터 손실: RPO ___ 분 / RTO ___ 분
- Fault tolerance: 어떤 장애를 견디는가?

### 4.3 Security
- 인증: 방식 (예: OAuth2 + PKCE)
- 권한: 모델 (RBAC / ABAC)
- PII: 분류 + 암호화 정책 (저장 시 / 전송 시)
- 비밀 관리: 어디에 어떻게
- 감사 로그: 무엇을 기록

### 4.4 Usability
- 학습 시간: 신규 사용자가 핵심 흐름 완료까지 ___ 분
- 접근성: WCAG ___ 수준

### 4.5 Scalability
- 동시 사용자: ___ 명 (현재) → ___ 명 (1년 후)
- 데이터 증가율: ___ GB/월

### 4.6 Supportability / Maintainability
- 테스트 커버리지: ___% (라인 / 브랜치)
- 코드 표준: 어떤 lint / formatter
- 모니터링: 핵심 메트릭 / 알람 임계값

### 4.7 Compatibility
- 지원 브라우저 / OS / 디바이스
- API 호환성: 이전 버전과의 관계 (deprecation 정책)

### 4.8 Compliance
- 적용 법규: K-개인정보보호법 / GDPR / PCI-DSS / ...
- 데이터 거주: 국가별 저장 위치 요구

## 5. External Interface Requirements

### 5.1 User Interface
- 디바이스: 데스크탑 / 모바일 / 태블릿
- 핵심 화면 윤곽 (와이어프레임 링크)

### 5.2 Hardware Interface
- (해당 시) 특수 디바이스, 센서, IoT

### 5.3 Software Interface
- 외부 API: 어떤 endpoint, 인증 방식, rate limit
- 데이터베이스: 종류, 접근 방식
- 메시지 큐 / 이벤트 버스: 토픽, 스키마

### 5.4 Communication Interface
- 프로토콜: HTTP/HTTPS, gRPC, WebSocket
- 메시지 포맷: JSON / Protobuf
- 인코딩: UTF-8 등

## 6. Data Requirements

### 6.1 Core Entities

| Entity | 설명 | 보유기간 | PII | 비고 |
|---|---|---|---|---|
| User | 가입 사용자 | 탈퇴 후 30일 | Y (이메일, 이름) | 암호화 저장 |
| ... | ... | ... | ... | ... |

### 6.2 Data Quality
- 정합성 요구
- 중복 방지
- 데이터 유효성 검증 지점

### 6.3 Backup / Recovery
- 백업 빈도: ___
- 보관: ___ 일
- 복구 테스트: 분기별 1회

## 7. Traceability

요구사항 ↔ 설계 ↔ 테스트의 매핑 (lightweight):

| Req ID | Design Section | Test Case |
|---|---|---|
| FR-001 | DD §5.2 | TC-001, TC-002 |
| NFR-Perf | DD §6.1 | LT-001 |

## 8. Open Items / Risks

- [ ] 미해결 요구사항
- [ ] 가정의 위험
- [ ] 후속 결정 필요 항목

## 9. Revision History

| Version | Date | Author | Changes |
|---|---|---|---|
| 0.1 | YYYY-MM-DD | <이름> | 초안 |
