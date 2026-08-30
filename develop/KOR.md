# develop — 한국어

[English](README.md) · **한국어**

소프트웨어 작업에서 조용히 잘못되는 부분들을 다루는 엔지니어링 스킬 모음입니다. 잘못 그은 서비스
경계, 엉뚱한 이유로 통과하는 테스트, 감으로 잡은 커넥션 풀 크기, 알림이 울리고 나서야 없다는 걸
아는 런북 같은 것들이죠. 각 스킬은 그중 하나를 맡아 프로세스를 부여합니다 — 바꾸기 전에 진단하고,
트레이드오프를 명시하고, 주장 대신 증거로 검증합니다.

32개 중 5개는 **워크플로 진입점**입니다. 직접 일하지 않고 전문 스킬들을 정해진 순서로 구동하며,
중간 단계부터 합류할 수 있습니다.

## Install & Uninstall

```bash
/plugin install develop@newkayak12-claude-skills
/plugin uninstall develop@newkayak12-claude-skills
```

## 어떤 스킬이 필요한가요?

**워크플로 (진입점)**

| 하고 싶은 일 | 스킬 |
|---|---|
| 설계 → 도메인 → 테스트 → 성능 → 문서 → 운영 전체 품질 사이클 | `dev-quality-workflow` |
| 도메인 발견부터 ADR까지 시스템 설계 전 과정 | `architecture-workflow` |
| 테스트 스위트를 처음부터 만들고 CI 안정화 | `testing-workflow` |
| DB 성능 저하를 모든 레이어에서 추적 | `database-workflow` |
| 출시 전 서비스 운영 준비 완료 | `operations-workflow` |

**테스트**

| 하고 싶은 일 | 스킬 |
|---|---|
| 실패하는 테스트를 먼저 쓰고, 진짜 실패할 수 있는지 증명 | `test-driven-development` |
| 테스트 없는 코드에 테스트 추가, 커버리지 감사, 테스트 계획 | `test-master` |
| 로컬은 통과, CI는 실패하는 테스트 고치기 | `flaky-test-analyzer` |

**데이터베이스**

| 하고 싶은 일 | 스킬 |
|---|---|
| 쿼리 작성·재작성, 스키마 설계, EXPLAIN 해석 | `sql-pro` |
| 서버 설정·VACUUM·락·파티셔닝이 원인인 DB 느림 | `database-optimizer` |
| "connection pool exhausted" 제거와 풀 사이징 | `connection-pool-tuner` |
| 부분 실패 후 데이터 정합성이 깨지는 문제 | `transaction-boundary-reviewer` |

**아키텍처 · 도메인**

| 하고 싶은 일 | 스킬 |
|---|---|
| 토폴로지 선택, 트레이드오프 평가, ADR 작성 | `architecture-designer` |
| 코드 쓰기 전에 이벤트로 도메인 발견 | `event-storming` |
| 바운디드 컨텍스트·애그리거트·유비쿼터스 언어 모델링 | `domain-driven-design` |
| 서비스 분리가 타당한지, 커플링만 늘리는지 판정 | `service-boundary-validator` |
| 비즈니스 로직을 컨트롤러·프레임워크에서 분리 | `clean-architecture` |
| 분산 시스템 설계 또는 재구조화 | `microservices-architect` |

**운영 · 신뢰성**

| 하고 싶은 일 | 스킬 |
|---|---|
| SLO, 에러 버짓, 알림, 온콜 체계 수립 | `sre-engineer` |
| 진행 중인 장애 대응과 비난 없는 RCA 작성 | `incident-response-playbook` |
| 최적화 전에 병목부터 찾기 | `performance-profiling-optimization` |
| 느린 의존성이 호출 측을 끌어내리지 않게 막기 | `circuit-breaker-tuner` |
| 블라스트 반경을 제한한 의도적 장애 내성 검증 | `chaos-engineer` |
| 이미지 크기 줄이고 빌드 캐시 무효화 막기 | `dockerfile-optimizer` |

**언어 · 프레임워크**

| 하고 싶은 일 | 스킬 |
|---|---|
| Spring Boot 3.x 백엔드 — REST, Security, JPA, WebFlux | `spring-boot-engineer` |
| 관용적인 Kotlin — 코루틴, Flow, KMP, Compose, Ktor | `kotlin-specialist` |
| TypeScript·Tailwind 기반 React / Next.js UI | `frontend-developer` |
| 서브커맨드·플래그·셸 컴플리션을 갖춘 CLI | `cli-developer` |

**코드 품질 · 문서화**

| 하고 싶은 일 | 스킬 |
|---|---|
| 가독성 리뷰와 구체적인 리팩토링 목록 | `clean-code` |
| 코드베이스 건강도 진단, 기술 부채 착수 지점 결정 | `pragmatic-programmer` |
| 기존 코드에 docstring·JSDoc·OpenAPI 스펙 생성 | `code-documenter` |
| 어떤 문서를, 누구를 위해, 누가 유지할지 설계 | `documentation-strategy` |

## Skills

### 워크플로

### `dev-quality-workflow`

엔지니어링 품질 전 과정을 6단계로 돌리며, 각 단계를 전문 스킬이 담당합니다:
`architecture-designer` → `domain-driven-design` → `test-driven-development` →
`performance-profiling-optimization` → `documentation-strategy` → `incident-response-playbook`.
단계마다 skip 조건이 정의되어 있어서, 이미 승인된 아키텍처나 유지보수자 1명짜리 내부 도구는
해당 단계를 건너뜁니다. 신규 기능이나 여러 레이어에 걸친 리팩토링용이며, 간단한 버그 수정이나
파일 하나 고치는 작업에는 쓰지 않습니다.

```
신규 정산 서비스를 처음부터 만듭니다. dev quality workflow 전체 돌려주세요.
아키텍처는 아직 미정이고 6주 뒤 프로덕션 배포입니다.
```

지금 어느 단계인지 말하면 그 지점부터 합류합니다. "DDD부터"면 Step 2, "구현은 끝났고 성능만"이면
Step 4로 바로 갑니다.

### `architecture-workflow`

도메인 발견부터 결정 문서화까지 7단계: `event-storming`(도메인이 이미 명확하면 생략) →
`domain-driven-design` → `service-boundary-validator` → `clean-architecture` →
`architecture-designer` → `microservices-architect`(모놀리스 유지면 생략) →
`technique-write:adr-writer`. 마지막 ADR 단계만은 절대 건너뛰지 않습니다. 신규 시스템이나
모놀리스 → MSA 검토용이고, 안정된 기존 아키텍처 안에서 반복 작업할 때는 개별 스킬을 쓰세요.

```
주문 모놀리스를 서비스로 쪼갤지 결정해야 합니다. architecture workflow로 진행해주세요.
도메인 모델링부터 시작하고, 어느 쪽으로 결론이 나든 ADR은 남겨주세요.
```

예상 소요: 전체 1~3일, 단계당 2~6시간.

### `testing-workflow`

3단계 — 먼저 쓰기 → 커버리지 전략 → CI 안정화. `test-driven-development` → `test-master` →
`flaky-test-analyzer` 순으로 구동합니다. 테스트 없는 기존 코드에 추가하는 상황이면 Step 1을
건너뛰고 Step 2부터, CI가 재실행 꼼수 없이 이미 녹색이면 Step 3을 건너뜁니다. 이미 커버된 코드에
테스트 하나 추가하는 작업이나, 항상 실패하는 테스트(그건 버그입니다)에는 쓰지 않습니다.

```
커버리지 20%에 CI가 하루 한 번은 빨간불입니다. testing workflow 돌려주세요.
새 결제 모듈부터 시작하고, 그다음 flaky한 통합 테스트를 정리해주세요.
```

예상 소요: 전체 2~8시간, 단계당 30~120분.

### `database-workflow`

스택을 따라 내려가는 4단계: `sql-pro`(쿼리·인덱스·EXPLAIN) → `database-optimizer`(서버 설정,
슬로우 쿼리 진단) → `connection-pool-tuner`(풀 사이징, 누수 탐지) →
`transaction-boundary-reviewer`(격리 수준, `@Transactional` 범위, Outbox/Saga). 프로덕션이
느린데 어느 레이어가 원인인지 모를 때 쓰세요. 쿼리 하나, 풀 하나, 트랜잭션 하나로 특정된다면
해당 스킬을 직접 부르는 게 낫습니다.

```
지난주 배포 이후 프로덕션 DB 레이턴시가 두 배가 됐는데 어느 레이어인지 모르겠습니다.
database workflow로 네 레이어 전부 점검해주세요.
```

예상 소요: 전체 2~6시간, 단계당 30~90분.

### `operations-workflow`

빌드 → 관측 → 강화 → 대응 4단계, 6개 스킬: `dockerfile-optimizer` → `sre-engineer` →
`performance-profiling-optimization` → `circuit-breaker-tuner` → `chaos-engineer` →
`incident-response-playbook`. 순서가 중요합니다. 카오스는 서킷 브레이커 설정 이후에만 돌리고,
모니터링 스택이 없으면 아예 건너뜁니다. 출시 전 운영 준비 점검이나 반복적으로 문제가 나는 서비스
안정화용이며, 지금 장애 중이라면 `incident-response-playbook`으로 바로 가세요.

```
새 알림 서비스가 다음 주 목요일 프로덕션에 나갑니다. operations workflow 돌려주세요.
컨테이너, SLO, 서킷 브레이커, 런북까지 출시 전에 끝내고 싶습니다.
```

예상 소요: 전체 4~16시간, 단계당 1~3시간.

### 테스트

### `test-driven-development`

증거 게이트가 달린 red-green-refactor입니다. RED 테스트를 실행하기 전에, 그 테스트를 실패로
뒤집을 정확한 프로덕션 변경을 먼저 적어야 합니다 — 희망이 아니라 **falsifiability probe**입니다.
그다음 예측한 이유로 실제 실패하는지 봅니다. 테스트가 바로 통과하면 이미 있는 코드를 검사하고
있다는 뜻이니 테스트를 다시 씁니다. 일회성 프로토타입, 생성된 코드, 설정 파일, 테스트 없는 레거시에
테스트를 붙이는 경우(`test-master` 사용)에는 건너뜁니다.

```
서킷 브레이커 open/close 로직을 TDD로 구현해주세요. 각 테스트마다 실행 전에
어떤 변경이 이걸 깨뜨리는지 먼저 말하고, 실패 출력을 보여주세요.
```

RED 사이클마다 기록 하나가 남습니다:

| 필드 | 예시 |
|---|---|
| Test name | `opens the circuit after 3 consecutive failures` |
| Breaking change named (pre-GREEN) | "실패 카운터 증가 로직을 제거하면" |
| Observed failure reason | `TypeError: breaker.isOpen is not a function` — 예측과 일치 |

두 가지 모드로 동작합니다. 단독 모드에서는 이 기록을 본인 작업 노트에 남기고 스스로 점검하고,
`harness:harness` 아래에서는 QualityGate가 읽는 지속 아티팩트가 됩니다. 기록이 없거나 조작되면
게이트에서 막힙니다.

### `test-master`

단위·통합·E2E·성능·보안 테스트를 작성·개선·감사하고, 커버리지 갭 분석과 테스트 계획, 결함
리포트를 만듭니다. 테스트가 아예 없는 코드에 추가할 때, 또는 커버리지는 있는데 뭘 덮고 있는지
아무도 모를 때 쓰세요. 이미 TDD 사이클을 돌고 있다면(`test-driven-development`), 특정 flaky
테스트 하나를 디버깅한다면(`flaky-test-analyzer`) 그쪽이 맞습니다.

```
이 레거시 정산 모듈에 테스트가 하나도 없습니다. 테스트 가능한 범위를 감사하고
리스크 기준 테스트 계획을 세운 뒤, 위험도 높은 경로부터 단위·통합 테스트를 붙여주세요.
```

### `flaky-test-analyzer`

어떤 실행에선 통과하고 어떤 실행에선 실패하는 테스트를 진단하고, 재시도를 덧붙이는 대신 원인을
고칩니다. 먼저 실패 유형을 분류하고, 실패 테스트만 20회 격리 실행으로 재현한 뒤, 실행 순서를
바꿔가며 테스트 간 오염을 잡아냅니다. 항상 실패하는 테스트(그건 버그)나 새 테스트 작성에는 쓰지
않습니다.

```
이 통합 테스트 3개가 CI에서 5번에 1번꼴로 실패하는데 로컬은 항상 녹색입니다.
진짜 원인을 찾아주세요 — 재시도 래퍼를 또 씌우고 싶지는 않습니다.
```

### 데이터베이스

### `sql-pro`

SQL을 쓰고 다시 씁니다. 조인, CTE, 윈도우 함수, 재귀 쿼리부터 스키마 설계, 정규화,
PostgreSQL·MySQL·SQL Server 간 방언 마이그레이션까지 다룹니다. 슬로우 쿼리의 EXPLAIN 계획을
해석하고, 최소 엔진 버전이 필요한 기능은 표시합니다. 서버 설정이 병목이면 `database-optimizer`,
풀 고갈이면 `connection-pool-tuner`가 맞습니다.

```
5천만 행 테이블에서 풀 스캔하는 리포트 쿼리가 5분 걸립니다. CTE와 윈도우 함수로
다시 써주고 필요한 인덱스도 알려주세요. Postgres 15입니다.
```

### `database-optimizer`

쿼리 작성이 아니라 그 바깥에서 오는 느림을 다룹니다. 서버 메모리·I/O 설정, 락 경합, VACUUM과
통계 관리, 파티셔닝 설계, 클라우드 관리형 DB 제약이 대상입니다. 어떤 변경보다 먼저
`EXPLAIN (ANALYZE, BUFFERS)` 베이스라인을 캡처합니다. 슬로우 쿼리 재작성은 `sql-pro`, 풀 고갈은
`connection-pool-tuner`로 보내세요.

```
RDS Postgres가 매일 오후만 되면 느려지는데 쿼리 하나씩 보면 멀쩡합니다.
서버 설정, autovacuum, 락 경합을 확인하고 변경 전에 베이스라인부터 잡아주세요.
```

### `connection-pool-tuner`

간헐적 연결 실패, 트래픽 몰릴 때의 레이턴시 급증, 풀 고갈을 진단하고 HikariCP·pgBouncer 등의
`maximumPoolSize`, `minimumIdle`, `connectionTimeout`, `maxLifetime`을 산정·설정하며 누수까지
탐지합니다. 증상을 진단 테이블에 매칭하는 방식으로 시작합니다. 근본 원인이 느린 SQL이면
`sql-pro`, 서버 메모리·IO 설정이면 `database-optimizer`입니다.

```
피크 때 Spring Boot 서비스에서 "connection pool exhausted"가 납니다. 동시 사용자
500명, Postgres max_connections는 200입니다. HikariCP 사이징과 누수 점검 부탁합니다.
```

### `transaction-boundary-reviewer`

부분 실패 후 데이터가 어긋나거나, 부하 상황에서 락 경합·타임아웃이 생길 때 격리 수준, 원자성
공백, 지나치게 넓은 트랜잭션을 검토합니다. 먼저 어떤 ACID 속성이 위험한지 특정하고,
`@Transactional` 안에서 실제로 무엇이 도는지 매핑합니다 — 트랜잭션 내부의 외부 I/O, N+1,
`rollbackFor` 누락, lost update. 슬로우 쿼리는 `sql-pro`, 풀 고갈은 `connection-pool-tuner`.

```
어젯밤 타임아웃 이후 주문은 생성됐는데 결제가 안 됐습니다. @Transactional 경계를
검토하고 Outbox가 필요한지 Saga가 필요한지 판단해주세요.
```

### 아키텍처 · 도메인

### `architecture-designer`

아키텍처 결정을 처음부터 내리고 문서로 남깁니다. 시스템 토폴로지(모놀리스, 모듈러 모놀리스,
마이크로서비스), 확장성 트레이드오프, DB·인프라 선택, 그리고 중요한 결정마다 ADR을 만듭니다.
장점 나열이 아니라 대안을 명시적으로 평가하고 실패 모드를 함께 설계합니다. 레이어 의존성 규칙은
`clean-architecture`, 바운디드 컨텍스트 모델링은 `domain-driven-design`, 구현 코드는 해당
언어 스킬입니다.

```
신규 분석 플랫폼, 피크 초당 5만 이벤트, 팀은 소규모입니다. 토폴로지를 비교하고
근거와 함께 스택을 추천한 뒤 DB와 큐 선택에 대한 ADR을 써주세요.
```

출력: 요구사항 요약(기능 + 비기능) → Mermaid 아키텍처 다이어그램 → 트레이드오프를 포함한 ADR
형식의 핵심 결정 → 근거가 붙은 기술 추천 → 리스크와 완화 전략.

### `event-storming`

이벤트를 통한 도메인 발견을 3단계로 진행합니다. Big Picture(도메인 전체, 바운디드 컨텍스트,
문제 지점) → Process Level → Design Level. 새 제품을 시작할 때, 레거시를 풀어헤칠 때, 도메인
모델링을 어디서 시작해야 할지 모를 때 쓰세요. 도메인이 이미 잘 모델링되어 안정적이면 필요 없고,
코드 산출물이 필요하면 먼저 이걸 돌린 뒤 `microservices-architect`나 `spring-boot-engineer`로
넘기세요.

```
창고 시스템을 재구축하는데 입고 프로세스가 실제로 어떻게 도는지 아무도 합의가 안 됩니다.
이벤트 스토밍 진행해주세요. Big Picture부터 시작해서 바운디드 컨텍스트까지 뽑아주세요.
```

### `domain-driven-design`

코드 구조를 비즈니스 개념에 맞춥니다. 유비쿼터스 언어, 바운디드 컨텍스트, 애그리거트, 엔티티 vs
값 객체, 도메인 이벤트, 컨텍스트 매핑을 다룹니다. 도메인 전문가와 개발자가 같은 단어를 다른 뜻으로
쓰고 있을 때, 또는 도메인 분석에서 서비스 경계를 뽑아야 할 때 쓰세요. 아키텍처 레이어링은
`clean-architecture`, 기존 서비스의 커플링 검증은 `service-boundary-validator`, 단순 CRUD 앱은
대상이 아닙니다.

```
"주문"이라는 단어가 팀마다 세 가지 의미로 쓰입니다. 유비쿼터스 언어를 정리하고
바운디드 컨텍스트를 정의한 뒤 통합 패턴까지 포함한 컨텍스트 맵을 그려주세요.
```

### `service-boundary-validator`

"이걸 별도 서비스로 빼야 하나?"를 감이 아니라 근거로 답합니다. 동기 호출 그래프, 공유 DB, 양방향
의존성을 매핑하고, 엔티티별로 어느 서비스가 생성·조회·수정·삭제하는지 감사하고, 서비스마다 팀이
하나씩 대응되는지 인지 부하 테스트로 확인한 뒤 병합·분리·비동기 전환·소유권 수정 중 하나를
권고합니다. 경계를 처음부터 설계하는 거라면 `event-storming` → `microservices-architect` 순서입니다.

```
재고를 주문 서비스에서 분리하려 합니다. 테이블 3개를 공유하고 양방향으로 동기 호출하는데,
이 분리가 타당한지 검증해주세요.
```

### `clean-architecture`

엔티티 → 유스케이스 → 인터페이스 어댑터 → 프레임워크/드라이버로 관심사를 분리하고, 비즈니스
로직이 HTTP 핸들러나 ORM으로 새어 나갔을 때 의존성 규칙을 강제합니다. 현재 아키텍처를 0~10점으로
채점하고 의존성 규칙 위반을 하나씩 지적한 뒤, 프레임워크 없이도 유스케이스를 테스트할 수 있도록
포트와 어댑터를 설계합니다. 코드 레벨 네이밍·함수 크기는 `clean-code`, 바운디드 컨텍스트 모델링은
`domain-driven-design`이며, 단순 스크립트에는 과합니다.

```
컨트롤러가 400줄이고 JPA 리포지토리를 직접 호출합니다. 현재 레이어링을 채점하고
의존성 위반을 나열한 뒤 포트-어댑터 리팩토링안을 보여주세요.
```

### `microservices-architect`

분산 시스템을 설계하고 평가합니다. 모놀리스 분해, DDD 기반 서비스 경계, 동기 vs 비동기 통신,
데이터 전략, 복원력, 관측성을 다룹니다. 첫 질문은 "마이크로서비스가 필요한가"입니다 — CI/CD도
컨테이너 오케스트레이션도 없고 독립 스쿼드가 2개 미만이면 모듈러 모놀리스를 먼저 권합니다.
구현 코드는 `spring-boot-engineer`입니다.

```
이커머스 모놀리스, 엔지니어 12명 3개 스쿼드, 쿠버네티스는 이미 있습니다.
분해 설계를 해주세요 — 서비스 경계, 통신 패턴, 데이터 소유권까지.
```

### 운영 · 신뢰성

### `sre-engineer`

프로덕션 신뢰성 체계를 세웁니다. SLI/SLO와 에러 버짓, 골든 시그널 알림과 대시보드, 장애 런북,
자동화를 통한 토일 감소, 용량 계획을 다룹니다. 설정을 생성하기 전에 관측 스택부터 확인합니다 —
레퍼런스 예제는 Prometheus/Kubernetes 기준입니다. 카오스 실험 설계는 `chaos-engineer`,
인프라 프로비저닝은 대상이 아닙니다.

```
사용자 대면 API 3개의 SLO와 에러 버짓을 정의하고 골든 시그널 알림과 온콜 로테이션까지
설계해주세요. 저희는 Prometheus가 아니라 Datadog을 씁니다.
```

### `incident-response-playbook`

개발자 관점의 장애 라이프사이클을 진행합니다. 탐지 → 트리아지 → 커뮤니케이션 → 완화 → 해소 →
학습. 다른 무엇보다 심각도를 먼저 분류하는데, 심각도가 에스컬레이션과 공지 주기를 결정하기
때문입니다. 완화(서비스 복구)와 조사(원인 규명)를 분리해 서로를 막지 않게 합니다. RCA는 개인을
비난하지 않고 항상 타임라인 재구성을 포함합니다. 진행 중인 장애에도, 사전에 플레이북을 만들 때도
씁니다.

```
체크아웃이 8분째 에러입니다. 심각도 분류하고, 지금 당장 올릴 Slack 공지 문구를 주고,
완화와 조사를 어떻게 나눌지 정리해주세요.
```

| 심각도 | 정의 | 대응 시간 |
|---|---|---|
| P0 | 서비스 전면 중단, 매출·데이터 위험 | 즉시 — 온콜 호출 |
| P1 | 주요 기능 장애, 상당수 사용자 영향 | 15분 이내 |
| P2 | 성능 저하 또는 부분 기능 실패 | 1시간 이내 |
| P3 | 우회 가능한 경미한 이슈 | 다음 영업일 |

Slack·상태 페이지 공지 템플릿과 RCA 포맷(요약, 타임라인, 근본 원인, 기여 요인, 잘된 점, 액션
아이템)도 함께 제공합니다.

### `performance-profiling-optimization`

먼저 측정, 다음 가설, 그다음 프로파일링, 그다음 수정, 검증은 항상. 베이스라인을 잡고, 증상을
유력 원인에 매칭하고, 구체적인 도구 가이드로 CPU/메모리/IO/네트워크를 프로파일링하고, 하나의
타깃 변경을 적용한 뒤 다시 측정합니다. 의심이 아니라 실제로 관측된 성능 문제가 있을 때 쓰세요.

```
화요일 배포 후 API P99가 120ms에서 900ms로 뛰었는데 CPU는 평탄합니다.
베이스라인 잡고 프로파일링해서, 손대기 전에 딱 하나 바꿀 것만 알려주세요.
```

시작점이 되는 증상-원인 테이블:

| 증상 | 유력 원인 |
|---|---|
| CPU 100%, 레이턴시 편차 작음 | 핫 루프, 직렬화 오버헤드, 정규식 |
| P99 높은데 CPU 낮음 | 락 경합, 스레드 기아, GC stop-the-world |
| 메모리 증가 후 크래시 | 누수, 무제한 캐시, 대량 결과셋 보유 |
| IO wait 높음 | 느린 쿼리, 인덱스 누락, 풀 테이블 스캔 |

발견된 병목은 바깥으로 넘깁니다. DB 쿼리는 `database-optimizer`, 풀 고갈은
`connection-pool-tuner`, 연쇄 레이턴시는 `circuit-breaker-tuner`, SLO·알림은 `sre-engineer`.

### `circuit-breaker-tuner`

느리거나 실패하는 다운스트림이 호출 측의 스레드와 커넥션을 고갈시키지 않도록 서킷 브레이커,
벌크헤드, 타임아웃, 폴백을 설정하고 튜닝합니다. `failureRateThreshold`,
`waitDurationInOpenState`, `minimumNumberOfCalls`를 잡고, COUNT_BASED와 TIME_BASED 슬라이딩
윈도우를 선택하며, 오탐으로 브레이커가 열릴 때 HALF_OPEN 프로브 동작을 수정합니다. 느린 SQL이나
인덱스 문제, 카오스 실험 설계(`chaos-engineer`)는 대상이 아닙니다.

```
결제 브레이커가 프로바이더는 멀쩡한데 하루에도 몇 번씩 열립니다. 거기 p99는 800ms입니다.
임계값, 윈도우, HALF_OPEN 프로브를 다시 잡아주세요.
```

### `chaos-engineer`

통제된 장애 실험을 설계합니다. 네트워크 지연, 파드 삭제, 존 장애 등을 가설·정상 상태 지표·제한된
블라스트 반경·안전 장치·스크립트 롤백과 함께 구성하고, 게임 데이 훈련도 계획합니다. 모니터링
스택이 없으면 진행하지 않습니다 — 지표 없이는 정상 상태를 확인할 수 없기 때문입니다. 진행 중인
장애 대응은 `incident-response-playbook` 또는 `sre-engineer`입니다.

```
쿠버네티스 체크아웃 경로로 게임 데이를 준비해주세요. 파드 킬 먼저, 그다음 AZ 장애.
블라스트 반경은 트래픽 5%로 제한하고 중단 기준도 정해주세요.
```

### `dockerfile-optimizer`

기존 Dockerfile을 분석해 레이어 캐싱, 이미지 크기, 빌드 속도, 보안에 대한 구체적인 before/after
수정안을 냅니다. 2패스 방식입니다. 먼저 8개 체크 전체를 훑어 모든 문제를 기록하고, 그다음 수정을
적용합니다 — 눈에 띄는 하나를 고치다가 서로 얽힌 다른 문제를 놓치지 않기 위해서입니다. 쿠버네티스
매니페스트, docker-compose 오케스트레이션, 런타임 보안 정책(AppArmor, seccomp)은 대상이 아닙니다.

```
이미지가 1.8GB고 코드 한 줄만 바꿔도 npm install이 다시 돕니다. Dockerfile 첨부합니다.
문제부터 전부 찾아낸 다음에 다시 쓴 버전을 주세요.
```

다루는 범위: 베이스 이미지 선택(alpine / distroless / slim / full), 멀티스테이지 빌드, 레이어
순서, `.dockerignore`, 논루트 유저, 레이어에 남는 시크릿. 참고 문서: `references/antipatterns.md`,
`references/dockerignore-template.md`.

### 언어 · 프레임워크

### `spring-boot-engineer`

Spring Boot 3.x 기반 Java 백엔드를 만들고 확장합니다. REST API, Spring Security 6와 인증,
Spring Data JPA, WebFlux 리액티브 엔드포인트, 캐싱, 트랜잭션 관리, 검증을 다룹니다. 코딩 전에
데이터 접근과 보안을 설계하고 확인받은 뒤, 생성자 주입과 레이어 구조로 구현합니다. 서비스 분해
결정은 `microservices-architect`, Kotlin 관용구는 `kotlin-specialist`와 함께 쓰세요.

```
회원 서비스 REST API를 만들어주세요. Spring Security 6 JWT 인증, JPA 영속화,
bean validation, 그리고 일관된 에러 응답 포맷까지 포함해서요.
```

### `kotlin-specialist`

관용적인 Kotlin을 씁니다. 코루틴과 Flow, 구조적 동시성과 취소, Kotlin Multiplatform 구성,
Jetpack Compose 안드로이드, Ktor 서버, 타입 안전 DSL을 다룹니다. sealed 클래스와 데이터 모델을
먼저 설계한 뒤, 취소가 제대로 전파되는지와 널 안정성이 지켜지는지 확인합니다. Spring Boot Java
백엔드는 `spring-boot-engineer`이고, 안드로이드는 XML 레이아웃이 아니라 Compose 기준입니다.

```
이 자바 서비스를 코틀린으로 전환하고 비동기 경로를 코루틴 기반으로 바꿔주세요.
GlobalScope 남발 말고 스코프와 취소를 제대로 다뤄주세요.
```

### `frontend-developer`

UI를 만들고 고칩니다. React 컴포넌트, 레이아웃, 클라이언트 인터랙션, 데이터 패칭 훅, 스타일링,
폼 처리를 다룹니다. 프로젝트에 별도 지정이 없으면 Next.js App Router + TypeScript + Tailwind가
기본입니다. 구현 전에 props·state·API 타입을 정의하고, 레이아웃 셸부터 톱다운으로 만듭니다.
Vue·Svelte·Angular나 백엔드 API는 대상이 아닙니다.

```
Next.js 앱에 대시보드 페이지를 만들어주세요. 서버 사이드 데이터 패칭, 필터 컨트롤,
반응형 테이블, 로딩·에러 상태 처리까지요.
```

### `cli-developer`

커맨드라인 도구를 만듭니다. 서브커맨드 계층, 플래그와 인자 파싱, 인터랙티브 프롬프트, 진행
표시줄, 셸 컴플리션, 크로스 플랫폼 배포를 다룹니다. 코드를 쓰기 전에 모든 커맨드와 기대되는
`--help` 출력을 먼저 나열하고, 플래그 네이밍 일관성과 기존 시그니처 호환을 확인합니다. 웹 UI나
REST API, SRE 파이프라인 연동만 필요한 경우(`sre-engineer`)는 제외입니다.

```
환경별 배포 설정을 관리하는 CLI를 만들어주세요. list/diff/apply 서브커맨드,
--dry-run 플래그, zsh 컴플리션까지요.
```

프레임워크 기본 선택: Node.js `commander` → `yargs` → `oclif`, Python `typer` → `click` →
`argparse`, Go `cobra + viper` (TUI만 `bubbletea`).

### 코드 품질 · 문서화

### `clean-code`

나중에 읽을 사람을 위해 코드를 리뷰하고 리팩토링합니다. 0~10점으로 채점해 점수를 명시한 뒤,
네이밍·함수·주석·에러 처리·테스트 카테고리별로 구체적인 위반과 각각의 리팩토링을 제시합니다. PR
피드백, 레거시 정리, 네이밍 결정에 쓰세요. 아키텍처 레이어 결정은 `clean-architecture`, 도메인
모델링은 `domain-driven-design`, 성능 작업은 프로파일링이 먼저입니다.

```
이 300줄짜리 서비스 클래스 가독성 리뷰해주세요. 점수와 구체적인 스멜,
그리고 우선순위 순 리팩토링을 주세요 — 오후 반나절밖에 없습니다.
```

### `pragmatic-programmer`

DRY, 직교성, 기술 부채 전략, 추정, 지식 포트폴리오 등 7가지 원칙으로 코드베이스와 엔지니어링
관행의 건강도를 진단하고 각각을 0~10점으로 채점한 뒤, 영향이 큰 위반부터 순위를 매겨 부채 작업의
착수 지점을 정당화합니다. 엔지니어링 회고와 부채 전략용입니다. 코드 레벨 네이밍은 `clean-code`,
구조적 아키텍처 결정은 `architecture-designer`, 도메인 모델링은 별도입니다.

```
3년치 부채가 쌓였는데 뭐가 제일 나쁜지 다들 의견이 다릅니다.
원칙별로 코드베이스를 채점하고 어디서부터 손대야 할지 알려주세요.
```

### `code-documenter`

아직 없는 문서를 만듭니다. 함수·클래스 docstring과 JSDoc, 기존 API에서 생성한 OpenAPI/Swagger
스펙, 문서 사이트, README, 튜토리얼을 다룹니다. 먼저 선호 포맷과 제외 대상을 묻고 코드베이스의
기존 관례를 따르며, 없으면 Python은 Google 스타일, TypeScript/JS는 JSDoc이 기본입니다.
아키텍처 결정 기록은 `technique-write:adr-writer`, 문서 체계 설계는 `documentation-strategy`입니다.

```
이 모듈에 문서가 전혀 없습니다. 공개 API에 docstring을 붙이고 컨트롤러에서 OpenAPI
스펙을 생성한 뒤, 신규 입사자가 바로 돌려볼 수 있는 README까지 써주세요.
```

### `documentation-strategy`

문서 한 장을 더 쓰는 대신 문서 체계를 설계합니다. 이미 있는 것을 먼저 감사하고, 커버리지 맵을
만들고, 효과가 가장 큰 누락 문서를 씁니다. 권고하는 모든 문서에는 독자와 유지보수 책임자가
지정되고, 최신 상태를 유지할 계획 없이는 아무것도 권고하지 않습니다 — 나쁜 문서는 잘못된 확신을
주기 때문에 없는 것보다 나쁩니다.

```
문서가 위키 세 곳에 흩어져 있고 절반은 오래됐습니다. 있는 걸 감사하고 독자별로
갭을 정리한 뒤, 실제로 유지할 가치가 있는 문서 5개를 골라주세요.
```

구분하는 문서 유형과 각각의 독자·갱신 트리거:

| 유형 | 독자 | 갱신 트리거 |
|---|---|---|
| Architecture Overview | 신규 엔지니어, 테크 리드, 감사 | 주요 설계 변경 |
| API Reference | API 소비자 | 모든 API 변경 |
| Runbook | 압박 상황의 온콜 엔지니어 | 절차가 바뀔 때 |
| ADR | 미래의 팀원, 리뷰어 | 한 번 작성, 삭제 대신 보완 |
| Onboarding Guide | 신규 팀원 | 분기 검토 + 워크플로 변경 시 |

## MCP

대부분의 스킬은 frontmatter에 `compatibility`를 선언합니다. `think-tool`은 트레이드오프를
명시적으로 저울질해야 하는 곳 — 아키텍처 패턴, SLO 목표, 격리 수준, 서킷 브레이커 임계값, 카오스
블라스트 반경 — 에서 권장됩니다. `sequential-thinking`은 순서 자체가 핵심인 곳에서 권장됩니다.
데이터베이스·성능 스킬의 베이스라인 → 변경 → 검증, 장애 대응의 탐지 → 트리아지 → 완화 → RCA,
그리고 모든 `*-workflow`가 여기 해당합니다. `mcp-reasoner`는 판단 비중이 가장 큰 설계 스킬에
optional로 붙습니다.

연결되어 있지 않다면 Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요. 없어도
스킬은 동작하고, 판단 단계의 구조화 정도만 달라집니다.
