# 02. Tech Track — 기술 트랙

목적: **"어떻게 만들 것인가"**를 코드 짜기 전에 명세한다. 산출물은 *현재의 결정*이 아니라 *왜 이 결정을 했고 무엇이 바뀌면 뒤집을 것인가*를 함께 기록해야 한다.

## 2.1 Architecture 설계

### 무엇을 산출하는가

세 가지 산출물이 한 묶음:
1. **Design Doc** — 시스템 전체의 핵심 결정 묶음
2. **ADR 시리즈** — 결정 단위로 한 장씩, *왜·언제·대안*을 기록
3. **다이어그램** — 텍스트로만 적힌 아키텍처는 그릴 수 없으면 모순이 있다는 신호

→ 템플릿: [`templates/design-doc.md`](./templates/design-doc.md), [`templates/adr.md`](./templates/adr.md)

### 다이어그램은 *어느 수준*까지 그려야 하는가 — C4 Model

Simon Brown의 C4 모델은 다이어그램을 **4단계 zoom level**로 명시한다:

| Level | 이름 | 보여주는 것 | 청중 |
|---|---|---|---|
| 1 | **Context** | 시스템 한 덩이 + 외부 사용자·외부 시스템 | 비기술자 포함 모두 |
| 2 | **Container** | 시스템 내부의 *배포 단위* (웹앱, API, DB, 큐, 워커) | 기술자 |
| 3 | **Component** | 컨테이너 내부의 *논리적 모듈* | 개발자 |
| 4 | **Code** | 클래스/함수 다이어그램 | 보통 생성. 손으로 안 그림 |

**1인 개발자라면 Level 1 + 2가 필수**, Level 3은 복잡한 컨테이너에만. Level 4는 생략.

### arc42 — 아키텍처 문서 템플릿

Gernot Starke의 arc42는 12개 섹션으로 아키텍처를 기술한다. 풀버전은 무겁지만 *항목 목록*은 체크리스트로 유용:

1. Introduction and Goals
2. Architecture Constraints
3. Context and Scope
4. Solution Strategy
5. Building Block View
6. Runtime View
7. Deployment View
8. Cross-cutting Concepts (logging, security, error handling…)
9. Architectural Decisions (ADR로 분리)
10. Quality Requirements
11. Risks and Technical Debt
12. Glossary

→ 1인 개발자용 슬림 버전은 Design Doc 템플릿 한 장에 압축. arc42는 *빠뜨린 게 없는지* 점검용으로 사용.

### 아키텍처 *스타일* 선택 — 1차 분기

| 스타일 | 적합 | 부적합 |
|---|---|---|
| Monolith (Modular) | 1인/초기, 트래픽 작음, 도메인 경계 미확정 | 큰 팀, 명확히 분리된 도메인, 다언어 |
| Microservices | 큰 팀, 독립 배포 필요, 도메인 분리 명확 | 1인 개발자 (운영 부담 폭발) |
| Serverless (FaaS) | 비균등 트래픽, 백그라운드 job, 빠른 prototype | 긴 실행, latency 민감, 로컬 개발 친화성 낮음 |
| Event-driven | 비동기 처리 우세, 다수 consumer | 단순 CRUD, 강한 일관성 필요 |
| Hexagonal / Clean | 비즈니스 로직 보호 필수, 어댑터 교체 가능성 | trivial CRUD |

**1인 개발자의 기본 선택**: *Modular Monolith*. 잘게 쪼개기 전에 모듈 경계가 옳은지부터 확인.

### Cross-cutting Concerns — 처음부터 결정해야 할 것

아키텍처 단계에서 미리 결정해두지 않으면 나중에 *모든 모듈을 다시 건드려야* 하는 항목:

- **Logging** (포맷: JSON/structured / 레벨 / correlation ID 전파)
- **Error handling** (예외 분류 / retry / circuit breaker 위치)
- **Authentication / Authorization** (세션 vs 토큰 / 권한 모델)
- **Configuration** (env vs config server / secret 관리)
- **Observability** (메트릭, 로그, 트레이스 — three pillars)
- **Idempotency** (외부에서 들어오는 요청의 재시도 대응)
- **Timezone & i18n** (UTC 저장 / locale 처리 지점)

이걸 한 번씩 짚어 *답을 적어두면* 나중에 일관성을 유지할 수 있다.

## 2.2 Tech Stack 선정

### 결정 매트릭스

기준을 *명시한 뒤* 가중치를 부여하고 후보를 점수로 비교. 직감으로 고르면 나중에 변호 못 함.

| 기준 | 가중치 | 후보 A | 후보 B | 후보 C |
|---|---|---|---|---|
| 친숙도 (1인 개발자 핵심) | 30% | | | |
| 생산성 (생태계·도구) | 20% | | | |
| 운영 비용 (호스팅·관리) | 15% | | | |
| 성능 적합성 (NFR과 매치) | 15% | | | |
| 채용/커뮤니티 (이직·도움 받기) | 10% | | | |
| 락인 위험 | 10% | | | |

### 락인(lock-in) 분석

기술 선택은 *되돌리는 비용*도 같이 본다.

| 락인 유형 | 예시 | 되돌리는 비용 |
|---|---|---|
| Vendor lock-in | AWS DynamoDB, Firebase RTDB | 매우 높음 (스키마·쿼리·관리도 바뀜) |
| Framework lock-in | Spring, Rails | 중간 (라이브러리는 추상화 가능) |
| Language lock-in | Kotlin, Go | 중간-높음 |
| Library lock-in | 특정 ORM, 특정 클라이언트 | 낮음-중간 |
| Data lock-in | proprietary 포맷 저장 | 매우 높음 |

원칙:
- **Vendor lock-in은 큰 비용/이점 차이**가 정당화할 때만 받아들인다 (예: BigQuery의 분석 성능).
- **Data 락인은 가장 위험하다**. 표준 포맷(SQL, S3-호환 객체 스토리지)으로 데이터를 잡아두면 다른 락인은 비교적 견딜만함.

### Build vs Buy vs Borrow

| 결정 | 적합한 경우 |
|---|---|
| Build (직접) | 차별화 핵심 / 외부에 없음 / 라이선스 부담 |
| Buy (SaaS·라이브러리 결제) | 비차별 영역 / 시간 절약이 가치보다 큼 |
| Borrow (OSS) | 검증된 OSS가 있고 유지보수 활발 / 라이선스 호환 |

차별화의 핵심이 아니면 직접 짓지 않는다 — auth, payment, email, search 등은 SaaS가 거의 항상 옳다.

### ADR로 결정 기록

각 주요 결정은 ADR 한 장. 형식 (Michael Nygard 원형):
- **Title** (번호 포함)
- **Status** (Proposed / Accepted / Deprecated / Superseded by ADR-XXX)
- **Context** (왜 결정이 필요한가)
- **Decision** (무엇을 결정했나)
- **Consequences** (긍정/부정 결과, trade-off)

MADR (Markdown ADR) 형식은 위에 **Considered Options**와 **Decision Drivers**를 추가해 더 풍부함. → 템플릿: [`templates/adr.md`](./templates/adr.md)

## 2.3 DB 설계

### 3단계 모델링

| 단계 | 산출물 | 누가 보는가 |
|---|---|---|
| Conceptual | ER 다이어그램 (개념 엔티티) | 도메인 전문가 + 개발자 |
| Logical | 정규화된 스키마 (PK, FK, 타입, 제약) | 개발자 |
| Physical | DDL (인덱스, 파티셔닝, 스토리지) | 개발자 + DBA |

→ 이 세 단계를 건너뛰고 바로 Physical로 가면 **도메인 모델이 DB 구현 detail에 종속**된다. Conceptual을 글로 적는 과정 자체가 도메인 이해를 강제한다.

### 정규화 vs 비정규화

| | 정규화 (3NF 이상) | 비정규화 |
|---|---|---|
| 장점 | 데이터 정합성, 갱신 용이 | 읽기 성능, 단순 쿼리 |
| 단점 | 조인 복잡, 쓰기·읽기 양쪽 추적 어려움 | 갱신 비용, 정합성 위험 |
| 기본값 | **OLTP는 정규화로 시작** | OLAP, 읽기 헤비, 보고서 |

**원칙**: 정규화로 시작 → 측정으로 병목 확인 → *증거가 있을 때만* 의도적으로 비정규화.

### Query-driven Design (NoSQL/KV 계열)

관계형이 아닌 KV/Document/Wide-column DB는 **쿼리 패턴이 스키마를 결정한다**. 미리 *어떤 쿼리를 던질 것인지*를 나열한 뒤 모델을 짠다 (single-table design 같은 패턴).

- DynamoDB single-table design: 모든 entity를 한 테이블에 PK/SK 조합으로. 쿼리 패턴이 *고정*되어야 가능.
- MongoDB: embedding vs referencing 결정 — *함께 읽히는 데이터는 embed*, *독립 갱신·큰 데이터는 reference*.

### 인덱스 — Physical 단계

- **모든 FK는 인덱스 후보** (조인 성능)
- **WHERE / ORDER BY / GROUP BY에 자주 등장하는 컬럼**
- **selectivity가 낮은 컬럼은 단독 인덱스 무의미** (예: boolean) — composite index 또는 partial index 고려
- **인덱스는 쓰기 비용을 더한다** — 인덱스 5개면 INSERT가 5배 느려질 수 있음

### 트랜잭션 경계

- 트랜잭션 경계는 *서비스의 일관성 경계*와 일치해야 함. 도메인 경계를 넘는 트랜잭션은 분산 트랜잭션이 되거나 saga로 분리.
- ACID vs BASE: 모놀리스 + 관계형 DB는 ACID 무료. 분산되면 결국 *eventual consistency*에 대한 합의가 필요.

### 데이터 거버넌스 — 처음에 정해야 할 것

- **PII / 민감정보 식별**: 어떤 컬럼이 개인정보인가? 암호화·해싱·접근통제 규칙.
- **보유기간 (retention)**: 얼마나 오래 보관하는가? 자동 삭제 정책.
- **감사 로그 (audit trail)**: 누가·언제·무엇을 바꿨는가의 추적 필요성.
- **백업·복구**: RPO(얼마까지 잃어도 되나) / RTO(얼마 만에 복구하나).
- **국가별 데이터 거주 (data residency)**: GDPR, K-개인정보보호법, …

## 2.4 트랙 산출물 체크리스트

- [ ] Design Doc 1장 (시스템 전체 결정)
- [ ] ADR 시리즈 (주요 결정마다 1장씩, 최소 5장 권장)
- [ ] C4 Context + Container 다이어그램
- [ ] (선택) Component 다이어그램 — 복잡한 컨테이너만
- [ ] Tech Stack 결정 매트릭스 + 락인 분석
- [ ] Cross-cutting concerns 항목별 결정 노트 (logging/error/auth/config/observability/idempotency/timezone)
- [ ] NFR 수치 (응답시간 P95/P99, 가용성 %, 동시접속, …)
- [ ] Conceptual ER → Logical 스키마 → Physical DDL
- [ ] 데이터 거버넌스 노트 (PII, retention, audit, backup, residency)
- [ ] 검증 게이트 2로 넘길 *기술 가설 목록* (3-5개)
