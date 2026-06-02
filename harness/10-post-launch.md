# 10. Post-launch — 출시 후 *영구* 루프

Macro/Meso/Micro loop이 *출시*에서 끝나는 것이 아니다. [`07 §7.1`](./07-looping-mechanics.md#71-네-가지-루프)의 네 번째 루프인 **Post-launch loop**는 *제품이 살아있는 한 영구*다. 이 문서는 출시 후의 운영·발견·종료(sunset)를 다룬다.

## 10.1 Post-launch loop의 4가지 부담

출시는 *끝*이 아니라 *새로운 부담의 시작*이다.

1. **운영 부담** — 사고 대응, 사용자 지원, 인프라 비용
2. **발견 부담** — Continuous Discovery, 다음 사이클 후보 발굴
3. **개선 부담** — 부채 상환, 점진 품질 개선
4. **종료 부담** — 언제 *그만둘지* 결정 (sunset 시점)

→ 출시 전부터 *4가지 부담의 capacity*를 확보하지 않으면 Post-launch는 *모든 다음 사이클을 잠식*.

## 10.2 Cadence — 주기와 산출물

### 일간 (자동화로 처리)
- 핵심 메트릭 dashboard 점검 ([`O-04`](./situational-rules/operations.md#o-04-alarms-with-thresholds--임계값-없는-메트릭은-무용))
- 알람 처리 (있을 때만)
- 비용 추적 ([`O-11`](./situational-rules/operations.md#o-11-cost-monitoring--비용도-메트릭))

### 주간
- Continuous Discovery 인터뷰 — *최소 1건* (Teresa Torres)
- 사용자 피드백 triage (어떤 신호가 의미 있는가)
- 메트릭 추세 검토 (전주 대비)

### 월간
- 운영 사고 회고 (있었을 경우, blameless — [`O-07`](./situational-rules/operations.md#o-07-blameless-postmortem--사람이-아니라-시스템))
- 부채 register 점검 ([`R-TD01`](./06-rules.md))
- Feature flag cleanup ([`O-06`](./situational-rules/operations.md#o-06-feature-flag-for-risky-changes))

### 분기별
- **메타 회고** — 지난 분기의 *학습 응축*
- 다음 사이클 후보 큐 *재정렬*
- Sunset 조건 *재평가* (§10.6)
- 룰 자체 점검 — *어긴 룰* 패턴 ([`SD-10`](./situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

## 10.3 Continuous Discovery — 출시 후에도 인터뷰

> *출시했다고 인터뷰가 끝나는 것이 아니다.* — Teresa Torres

### 원칙
- **주간 cadence** — 빈도가 중요. 한 달에 5명 몰아 하는 것보다 *주 1명 8주 지속*이 신호 누적에 강함.
- **현재 사용자 + 이탈 사용자 + 미사용자** — 3개 세그먼트 모두.
- **Opportunity Solution Tree 업데이트** — 새 opportunity가 발견되면 트리에 등재. 모든 opportunity가 사이클이 되진 않음.

### 결과물
- 인터뷰 raw note (다음 사이클의 *살림* 자원)
- Opportunity 트리 갱신
- *반복되는 신호* 식별 → 다음 Macro loop 트리거 후보

## 10.4 새 Macro loop 발동 트리거

Post-launch loop은 *자체로* 다음 Macro loop을 만들어내야 한다.

### 정량 트리거
- 핵심 메트릭 X% 하락 (예: WAU 20% 감소)
- 비용 메트릭 임계 초과 (예: 사용자당 인프라 비용 > $Y)
- SLO error budget *반복* 소진

### 정성 트리거
- Continuous Discovery에서 *반복 신호* (서로 다른 인터뷰 3명+에서 같은 opportunity)
- 운영 사고가 *구조적 결함*을 드러냄
- 경쟁/시장 환경 변화 — 외부 신호

### 자기-트리거 (위험)
- "지루해서 새 기능을 만들고 싶다" — 자기 점검 필요 ([`SD-06`](./situational-rules/self-discipline.md#sd-06-검증-대신-코드를-짜고-있나--자기-점검), [`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit))
- "기술이 더 좋은 게 나왔다" — Solution-shopping anti-pattern ([`09 §9.5`](./09-pre-cycle.md#95-pre-cycle-anti-patterns))

→ 트리거 발생 시 → [`09-pre-cycle.md`](./09-pre-cycle.md) 게이트 거쳐 새 Macro loop 진입.

## 10.5 부채 vs 새 기능 — Pay-down Ratio

Post-launch 시기는 *부채 상환*과 *새 기능*의 줄다리기.

### Ratio 권장값 (1인 개발자 baseline)
- **신규 사이클**: 새 기능 70% / 부채 30%
- **성숙 사이클**: 새 기능 50% / 부채 50%
- **출시 직후 1-3 사이클**: 새 기능 50% / 부채·관찰 50% (안정화 중심)
- **운영 사고 후**: 새 기능 30% / 부채 70% (구조적 원인 해소)

### 부채 register
- [`R-TD01`](./06-rules.md) — *의식적으로* 목록화
- 항목별: 발생 시점 / 원인 / 영향 / 상환 비용 / 상환 트리거
- 분기별 *재평가* — 일부 부채는 *상환 불필요* (제품 방향 바뀌면)

## 10.6 Sunset — 언제 *그만둘지*

종료는 *실패*가 아니다. 종료를 미루는 것이 *실패*다.

### Sunset 트리거
- **사용자**: WAU/MAU가 N개월 연속 임계 이하
- **비즈니스**: 운영 비용 > 수익 (또는 수익 가능성)
- **전략**: 다른 사이클로 *capacity 이전*이 더 가치 있음
- **유지 비용**: 부채 상환만으로 매 사이클이 소비됨

### Sunset 결정 매트릭스
- 종료 비용 (마이그레이션 / 사용자 통보 / 데이터 보존) < 유지 비용 → 종료 진행
- 핵심 사용자 N명이 있고 *이동시킬 곳이 있나* → 마이그레이션 계획
- *이동시킬 곳이 없나* → 충분한 사전 공지 + 데이터 export 제공

### Sunset 산출물
- 종료 일정 (T-90d 공지 → T-30d 신규 가입 종료 → T-0 서비스 종료 → T+30d 데이터 보존 종료)
- 마이그레이션 가이드 (있을 경우)
- 데이터 export / 삭제 절차
- *Sunset 회고* — 무엇을 배웠나, 무엇을 다음 사이클로 carry-over

→ Sunset 회고는 *제품의 마지막 학습 자원*. 다음 Macro loop의 출발점.

## 10.7 Post-launch 메트릭 baseline

출시 *전*에 미리 정해야 할 메트릭들. 출시 후 정하면 *해석 오염* ([`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit)).

### 제품 메트릭
- DAU / WAU / MAU
- Retention curve (D1 / D7 / D30)
- Activation rate (정의한 핵심 이벤트 달성 비율)
- 핵심 task 완료율
- NPS 또는 대체 만족도 지표

### 운영 메트릭 (RED + USE — [`O-01`](./situational-rules/operations.md#o-01-three-pillars--출시-전-필수))
- P95/P99 latency
- Error rate
- Throughput
- Utilization / Saturation

### 비즈니스 메트릭
- Revenue / 사용자당 비용
- CAC / LTV (해당 시)
- Churn rate

### Sunset 트리거 메트릭 (사전 정의 필수)
- N개월 연속 WAU < ___
- 사용자당 비용 > $___
- 부채 상환만으로 N 사이클 소비

## 10.8 Post-launch 안티패턴

### Endless polish
- 증상: 출시 후 *6개월간 같은 제품* 다듬기만
- 위험: 학습 멈춤 — 새 가설 검증 없음
- 대응: [`SD-04 80% ship rule`](./situational-rules/self-discipline.md#sd-04-80-ship-rule)을 *post-launch에도* 적용

### Feature creep without hypothesis
- 증상: "사용자가 X 달라고 했다" → 가설 없이 바로 구현
- 위험: 한 명의 요청을 *모두의 요구*로 착각
- 대응: 새 기능도 *가설 사전 등록* ([`08 §8.4`](./08-pass-criteria.md#84-가설-사전-등록-pre-registration))

### Sunset avoidance
- 증상: 명백히 죽어가는 제품을 *살릴 수 있다*고 함
- 위험: 매몰비용 ([`C-06`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다))
- 대응: 사전 정의 sunset 트리거 발동 → 자동 재평가

### Discovery skip
- 증상: 출시 후 인터뷰 *0건* 상태로 새 기능 결정
- 위험: 현재 사용자의 *진짜 패턴* 모름
- 대응: 주간 인터뷰 cadence를 *시간표에* 박기

### Operational drowning
- 증상: 운영 사고·지원 응대로 *다음 사이클* 시작 못함
- 위험: 영구 운영 모드 — 발견·개선 없음
- 대응: 운영 자동화 사이클을 명시적 Macro loop로 분리

## 10.9 Sunset → 다음 Macro loop carryover

[`07 §7.4`](./07-looping-mechanics.md#74-inter-loop-carryover--무엇이-살고-무엇이-버려지나)의 살림/의심/버림을 sunset에도 적용.

### 살림 (다음 제품으로)
- 인터뷰 raw note 누적
- 사용자 세그먼트 학습 — *누가* 가치를 느꼈나
- 운영 학습 — *어떤 결정*이 어떤 비용을 만들었나
- 기술 학습 — 어떤 의존이 어떤 한계를 보였나

### 의심 (재해석 필요)
- *왜* 이 제품이 죽었는가 — 즉답 금지, 데이터 다시 보기
- "다음에 더 잘하면 된다" 같은 모호한 학습

### 버림
- 죽은 제품의 *코드*
- 검증 안 된 *추측성 해석*
- "우리만의 특수성" 식의 inside view ([`C-11`](./situational-rules/cognitive.md#c-11-outside-view--비슷한-시도들의-base-rate))

## 10.10 Post-launch 체크리스트

### 출시 *직전*
- [ ] Post-launch 메트릭 baseline 사전 정의 (§10.7)
- [ ] Continuous Discovery cadence 일정 잡기 (§10.3)
- [ ] Sunset 트리거 사전 정의 (§10.6)
- [ ] 부채 register 초기화 (§10.5)
- [ ] 운영 baseline 통과 ([`operations.md`](./situational-rules/operations.md))

### 출시 *후 매 분기*
- [ ] 메트릭 추세 종합 (§10.7)
- [ ] Discovery 신호 회고 (§10.3)
- [ ] Sunset 조건 재평가 (§10.6)
- [ ] 부채 ratio 점검 (§10.5)
- [ ] 다음 Macro loop 트리거 점검 (§10.4)

## 관련 룰
- [`R-TD01`](./06-rules.md) — 부채 register
- [`SD-04`](./situational-rules/self-discipline.md#sd-04-80-ship-rule), [`SD-10`](./situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰) — 출시·자기 회고
- [`C-06`, `C-11`](./situational-rules/cognitive.md) — Sunk cost / Outside view
- [`O-01~11`](./situational-rules/operations.md) — 운영 baseline 전체

## 관련 skill
- `pm:hypothesis-driven-dev` — 출시 후에도 가설 등록
- `develop:operations-workflow` — 운영 cadence
- `develop:sre-engineer` — SLO / error budget 운영
- `think:retrospective` — 분기 메타 회고
- `cognition:second-order-thinker` — sunset의 2차 결과
- `pm:shape-up` — 다음 사이클의 appetite
