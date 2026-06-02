# Situational — 운영·관측 Baseline

**트리거**: 출시 직전 / 운영 중 / Performance budget·Observability 설정·SLO 합의 시

`06-rules.md`의 DoD에서 *분리한* Performance budget·Observability 항목이 이 문서에 있다. *출시 직전*에 한 번 통과하는 베이스라인.

## O-01: Three Pillars — 출시 전 필수

세 가지 *모두* 있어야 사고 시 추적 가능.

- **Logs**: 구조화(JSON) + correlation ID 전파 + level 분류
- **Metrics**: RED(Rate, Errors, Duration) 또는 USE(Utilization, Saturation, Errors) 모델
- **Traces**: 분산 트레이싱. OpenTelemetry 권장 (vendor-neutral)

**How**:
- 세 항목 *각각*에 대해 "어디서 보나" 답할 수 있어야 함
- 한 종류만 있으면 *어떤 사고*는 절대 못 푼다

## O-02: Performance budget — 수치를 사전에 박는다

- **Why**: "빠르다"는 합의 아님. 수치 없는 NFR은 합의되지 않은 것.
- **How**:
  - 핵심 경로별 P95/P99 응답시간 목표 (예: 로그인 P95 < 300ms, 검색 P95 < 500ms)
  - Page load: FCP < 1.5s, LCP < 2.5s, INP < 200ms (Web Vitals)
  - 백엔드 처리량: ___ rps (특정 시나리오)
  - 자원 한도: 메모리 < ___MB, CPU < ___% (단일 인스턴스)

## O-03: SLO + Error Budget

- **Why**: 100% 가용성은 *불가능*하고 *비효율적*. 어디까지 허용할지를 사전에 정함.
- **How**:
  - SLO 예: "월간 가용성 99.9% (= 약 43분 다운타임 허용)"
  - Error budget = 100% - SLO. 이 예산을 *다 쓸 때까지* 새 기능 출시 가능. 다 쓰면 *안정화에 집중*.
  - 1인 개발자는 단순화: *주간 다운타임 X분 허용*

## O-04: Alarms with thresholds — 임계값 없는 메트릭은 무용

- **Why**: 대시보드만 두고 *알람*이 없으면 사고가 *사용자 신고*로 들어옴.
- **How**:
  - 각 핵심 메트릭에 임계값 (예: 5xx 비율 > 1% / 5분, P95 > 1s / 5분, DB connection > 80% / 1분)
  - **알람 = 행동 가능**해야 함. "FYI 알람"은 *알람 피로*만 부름 → 제거.
  - On-call rotation 또는 단일 운영자 채널

## O-05: Runbook for top-5 failure modes

- **Why**: 사고 한가운데서 *공식 문서* 찾을 시간 없음. 사전에 정리되지 않은 절차는 *없는 절차*.
- **How**:
  - Top 5: DB 다운 / 외부 API 장애 / OOM / 디스크 풀 / 부하 폭증
  - 각각: *증상 → 진단 명령 → 1차 대응 → 에스컬레이션*
  - 분기별 *읽고 갱신* (drift 방지)

## O-06: Feature flag for risky changes

- **Why**: 끄지 못하는 변경은 *되돌릴 수 없는* 변경. 큰 변경에는 안전망이 필요.
- **How**:
  - DB 마이그레이션 외 *행동 변경*은 feature flag 뒤에 배포
  - Flag별: *기본값, 점진 ramp 비율, 종료(cleanup) 트리거*
  - Flag 정리도 부채 — debt register에 등재 [`R-TD01`](../06-rules.md#r-td01-debt-register--의식적으로-목록화)

## O-07: Blameless postmortem — 사람이 아니라 시스템

- **Why**: 사람을 비난하면 *다음 사고 보고가 숨김*. 시스템 결함이 누적.
- **How**:
  - 사고 후 24-72h 내 postmortem 작성
  - 형식: *timeline / impact / root cause / 5 whys / action items*
  - 책임 명시는 *역할*(Service Owner) 단위. *이름* 단위 금지.
  - Action items는 *오너 + 마감일* 명시

## O-08: 점진 rollout — 0% → 10% → 100%

- **Why**: 한 번에 100% 켜면 한 번에 100% 망함.
- **How**:
  - Feature flag 또는 LB 가중치
  - 단계별 *메트릭 게이트* (에러율 / latency / 비즈니스 metric)
  - 게이트 통과 못하면 *자동 rollback*

## O-09: Capacity planning — 명시적으로

- **Why**: 트래픽 증가는 *연속*이지만, 자원은 *점프*로 증가. 사전 계획 없으면 사고.
- **How**:
  - 사이클당 1회 capacity 점검: *현재 사용 vs 한계 vs 예상 증가*
  - 한계의 60-70% 도달 시 *확장 계획 발동*

## O-10: 운영 도구의 secret도 secret이다

- **Why**: 모니터링·로그·알람 시스템의 자격증명·webhook URL이 새면 *통제 위에 통제*가 무너짐.
- **How**:
  - 운영 도구 secret도 vault·KMS에 보관 ([`security.md#s-01`](./security.md))
  - 알람 webhook URL은 *공개 채널 금지*
  - 모니터링 dashboard 접근권은 least privilege

## O-11: Cost monitoring — 비용도 메트릭

- **Why**: 자원 사용량과 *비용*은 다르다. 비용을 안 보면 *조용한 부채*.
- **How**:
  - 일/주/월 단위 비용 추적
  - *비용 알람* — 예산 80%, 100%, 120% 임계값
  - 1인 개발자는 특히 무료 tier 한도 초과 알람 필수

## 관련 skill

- `develop:operations-workflow` — 운영 준비 entry point
- `develop:sre-engineer` — SRE 사고방식
- `develop:incident-response-playbook` — 사고 대응 절차
- `develop:chaos-engineer` — 사전 장애 주입 검증
- `develop:performance-profiling-optimization` — 성능 병목 분석
- `develop:circuit-breaker-tuner` — 외부 의존 장애 격리
- `develop:connection-pool-tuner` — DB 커넥션 풀
- `develop:dockerfile-optimizer` — 컨테이너 운영 효율
