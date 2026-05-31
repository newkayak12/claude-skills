# 08. Pass Criteria — 게이트 수치 기준

[`07-looping-mechanics.md`](./07-looping-mechanics.md)이 *언제 루프를 멈추고 다음으로 가나*를 정했다면, 이 문서는 *통과·실패의 수치 기준*을 박는다. "감으로 통과시킨다"는 게이트는 게이트가 아니다.

## 8.1 원칙

1. **수치는 사이클 *시작 전*에 결정** — 결과를 본 뒤 임계값을 정하면 self-confirmation.
2. **수치 + 근거** — "P95 < 300ms"만 적지 말고 *왜* 300ms인지(경쟁자 / 사용자 인내 한계 / 기존 시스템 비교) 1줄.
3. **부족하면 *조정 가능*, 단 명시적으로** — 사이클 진행 중 수정은 ADR로 기록.

## 8.2 Gate 1 — 제품 가설 검증 기준

[`03-validation-loops.md`](./03-validation-loops.md) Loop 1의 통과 조건을 정량화한다.

### 정량 기준 (1인 개발자 baseline)

| 항목 | 기준 | 비고 |
|---|---|---|
| 타겟 Persona 인터뷰 수 | ≥ 5명 | 패턴 인지 최소선 (3명은 우연, 5명부터 신호) |
| 핵심 가설별 발화 일치 | ≥ 60% | "이 문제 겪는다" 응답 비율 |
| 지불·시간·전환 의향 | ≥ 3명 명시적 yes | 단순 흥미 아님, *행동 약속* |
| Persona 외 발화 | < 30% | 30% 넘으면 Persona segment 의심 |
| 인터뷰 raw note 보존율 | 100% | 학습 carryover ([§7.4](./07-looping-mechanics.md#74-inter-loop-carryover--무엇이-살고-무엇이-버려지나)) |

### 정성 기준
- "Mom Test" 위반 없음 — *과거 행동* 질문이 *미래 의향* 질문보다 많음 (Rob Fitzpatrick)
- 인터뷰 *반증 가능* 형식 — "어떤 답이면 가설 기각?"이 사전 정의됨
- 가설별 *기각 라인* 사전 명시 (예: "5명 중 2명 이하 yes면 기각")

### 통과 시그널 분류
- **Strong pass**: 모든 정량 기준 + 정성 기준 충족
- **Conditional pass**: 정량 1개 미달 — *추가 검증 항목*과 함께 다음 단계 진행
- **Soft fail**: 정성 1개 위반 — 인터뷰 재실행 ([§7.2 Meso 재진입](./07-looping-mechanics.md#meso--가장-중요))
- **Hard fail**: 정량 2개 이상 미달 — Pivot 또는 Kill ([§7.5](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준))

## 8.3 Gate 2 — 기술 가설 검증 기준

Loop 2의 기술적 실현 가능성 게이트.

### 정량 기준

| 항목 | 기준 | 비고 |
|---|---|---|
| 핵심 경로 P95 latency | < 사전 정의 budget | [§8.6 참조](#86-performance-budget-defaults) |
| 핵심 경로 에러율 | < 1% (부하 테스트 시) | RED 모델 |
| DB 쿼리 N+1 / full-scan | 0건 (핵심 경로) | EXPLAIN 검증 |
| 부하 테스트 처리량 | ≥ 예상 트래픽 × 3 | 헤드룸 확보 |
| 외부 의존 SLA 합산 | ≥ 자체 SLO + buffer | dependency math |
| 단위 테스트 커버리지 (핵심 모듈) | ≥ 70% | 전체 평균 아님 |

### 정성 기준
- 핵심 경로 *failure mode* 3개 이상 식별 + 각각 대응 명시
- *Reversibility* high인 결정에 ADR 작성 ([`C-09`](./situational-rules/cognitive.md#c-09-decision의-reversibility-등급))
- 1인 운영 가능성 — 알람 응답 + 1차 복구 절차 ([`O-04`, `O-05`](./situational-rules/operations.md))

### 통과 시그널 분류
- **Strong pass**: 부하 테스트 결과가 baseline 대비 여유 ≥ 30%
- **Conditional pass**: 1개 항목 미달 — 추가 최적화 사이클 + 출시 가능
- **Hard fail**: 핵심 경로 SLO 미달 — 아키텍처 재검토 ([§7.2 Meso 재진입](./07-looping-mechanics.md#meso--가장-중요))

## 8.4 가설 사전 등록 (Pre-registration)

학술 연구의 pre-registration을 *해석 오염 방지*용으로 차용.

### 사이클 시작 시 작성 (변경 시 ADR 필요)

```
[가설 ID]
가설: [구체적, 검증 가능한 문장]
지표: [측정할 metric — 정의 + 측정 방법]
기각 라인: [어떤 수치/응답이면 기각인가]
통과 라인: [어떤 수치/응답이면 통과인가]
사이드 메트릭: [부수적으로 관찰할 것 — 의사결정에 사용 금지]
```

### 왜 별도 라인이 필요한가
- 결과를 본 뒤 *경계*를 조정하면 모든 가설이 "통과"
- 사전 등록된 라인은 *확증편향*에 저항 ([`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit))

## 8.5 Risk Scoring Matrix

각 결정·산출물의 위험을 *체계적*으로 평가한다.

### 축
- **Impact**: 잘못됐을 때 영향 (Low / Medium / High / Critical)
- **Reversibility**: 되돌리는 비용 (Easy / Moderate / Hard / Irreversible)
- **Confidence**: 현재 확신도 (Low / Medium / High)

### 매트릭스 (간소)

| Impact × Reversibility | Low conf | Medium conf | High conf |
|---|---|---|---|
| Low × Easy | Just do | Just do | Just do |
| Medium × Moderate | Spike 1d | Just do | Just do |
| High × Hard | ADR + DA + PM | ADR + DA | ADR |
| Critical × Irreversible | **STOP** + spike | ADR + DA + PM | ADR + DA |

- **Spike**: 1-3일 시간제한 탐색
- **ADR**: Architecture Decision Record
- **DA**: Devil's Advocate ([`C-04`](./situational-rules/cognitive.md#c-04-devils-advocate-on-irreversible-decisions))
- **PM**: Pre-mortem ([`C-02`](./situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet))
- **STOP**: 진행 금지, 확신 확보 전까지 다른 결정으로 우회

## 8.6 Performance Budget Defaults

수치를 *처음부터* 정하기 어려우면 이 baseline에서 시작. 사이클별 조정.

### 응답 시간 (Web Vitals — 사용자 향)
- **FCP** (First Contentful Paint) < 1.5s
- **LCP** (Largest Contentful Paint) < 2.5s
- **INP** (Interaction to Next Paint) < 200ms
- **CLS** (Cumulative Layout Shift) < 0.1
- **TTFB** (Time to First Byte) < 500ms

### 백엔드 (RED — 서비스 향)
- **P50 latency** < 100ms (핵심 경로)
- **P95 latency** < 500ms
- **P99 latency** < 1s
- **Error rate** < 1% (5분 윈도우)
- **RPS capacity** ≥ 예상 트래픽 × 3

### 리소스 (USE — 인프라 향)
- **CPU utilization** < 70% (평시), < 85% (피크)
- **Memory utilization** < 75%
- **Disk I/O saturation** < 60%
- **DB connection pool** < 80%

### 비용 (1인 개발자 추가)
- **월간 클라우드 비용** < 사전 예산
- **요청당 비용** < $X (수익화 모델에 따라)

## 8.7 DoD 수치 — Definition of Done

[`06-rules.md`](./06-rules.md)의 DoD를 *수치화*한다.

### 기능 단위 DoD
- [ ] 핵심 경로 단위 테스트 통과율 100%
- [ ] 통합 테스트 (golden path + 1 edge case) 통과
- [ ] 핵심 메트릭 (latency, error rate) baseline 이내
- [ ] Observability 3-pillars 적용 ([`O-01`](./situational-rules/operations.md#o-01-three-pillars--출시-전-필수))
- [ ] Feature flag 적용 (해당 시) ([`O-06`](./situational-rules/operations.md#o-06-feature-flag-for-risky-changes))

### 사이클 단위 DoD
- [ ] Gate 1 통과 (§8.2)
- [ ] Gate 2 통과 (§8.3)
- [ ] Performance budget 충족 (§8.6)
- [ ] 운영 baseline ([`operations.md`](./situational-rules/operations.md)) 충족
- [ ] 회고 산출물 보존 ([`templates/retro.md`](./templates/retro.md))

## 8.8 수치 조정 규칙

기준은 *고정*이 아니다. 단, *조정에 절차*가 있어야 진정한 기준.

### 조정이 가능한 시점
- 사이클 *시작 전* — 자유롭게 (근거 적시)
- 사이클 *진행 중* — ADR + 사유 명시
- 사이클 *종료 후* — 회고에 기록, 다음 사이클 baseline에 반영

### 조정 금지 시점
- 게이트 *통과 판정 직전*에 수치 완화 — *self-deception* 패턴
- 결과 *본 뒤*에 임계값 재정의 — pre-registration 의미 상실

## 8.9 사이클 시작 시 체크리스트

- [ ] Gate 1 정량·정성 기준 *기록* (§8.2)
- [ ] Gate 2 정량·정성 기준 *기록* (§8.3)
- [ ] 모든 핵심 가설에 *기각/통과 라인* 사전 등록 (§8.4)
- [ ] 핵심 결정에 Risk Scoring 적용 (§8.5)
- [ ] Performance budget 수치 *고정* (§8.6)
- [ ] DoD 수치 확인 (§8.7)

## 관련 룰
- [`R-PG01~05`](./06-rules.md) — Process Gates
- [`R-DoD01~04`](./06-rules.md) — Definition of Done
- [`R-NFR01~03`](./06-rules.md) — NFR 수치화
- [`C-01`, `C-05`](./situational-rules/cognitive.md) — Bias / Assumption
- [`O-02`, `O-03`](./situational-rules/operations.md) — Performance budget / SLO

## 관련 skill
- `pm:hypothesis-driven-dev` — 가설 사전 등록
- `develop:performance-profiling-optimization` — Performance budget 검증
- `cognition:assumption-extractor` — 정성 기준 명시화
- `think:decision-maker` — Risk matrix 적용
- `develop:sre-engineer` — SLO / Error budget
