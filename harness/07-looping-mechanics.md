# 07. Looping Mechanics

지금까지 문서들은 *루프의 존재*만 다뤘다. 이 문서는 4종 루프의 구분, 진입/종료/재진입 규칙, 종료(kill) 기준, pivot 트리거 매핑을 정리한다.

## 7.1 네 가지 루프

같은 단어("loop")가 4가지 다른 활동을 가리킨다. 명시적 구분 없이 섞으면 *비용·결정 단위*가 흐려진다.

| 루프 | 주기 | 비용 단위 | 핵심 산출물 |
|---|---|---|---|
| **Macro** | 사이클 1회 (수주~수개월) | 사이클 전체 | 출시된 제품 + 회고 |
| **Meso** | 한 단계 재실행 (수일~수주) | 단계 + 게이트 시간 | 수정된 단계 산출물 |
| **Micro** | TDD red-green-refactor (분~시간) | 한 함수/기능 | 통과 테스트 + 코드 |
| **Post-launch** | 출시 후 지속 (영구) | 운영 비용 | 메트릭 + 다음 사이클 후보 |

### Macro
- **시작**: Pre-cycle 게이트 통과 ([09-pre-cycle.md](./09-pre-cycle.md))
- **종료**: 출시 또는 kill 결정
- **회고**: 사이클 종료 시 `think:retrospective` ([R-KP01](./06-rules.md))

### Meso
- **시작**: Gate 실패 또는 단계 산출물의 명백한 결함
- **종료**: 갱신된 산출물이 다음 게이트 통과 가능
- **회고**: 단계 종료 시 *짧은* 회고 — "무엇을 놓쳤나"

### Micro
- **시작**: 작은 단위(1~3h) 작업 시작
- **종료**: red → green → refactor + DoD 충족
- **회고**: 별도 없음 (코드 자체가 산출물)

### Post-launch
- **시작**: 출시 직후
- **종료**: 제품 종료(sunset)까지 *영구* ([10-post-launch.md](./10-post-launch.md))
- **회고**: 분기별 메타-회고 + 트리거 발생 시 새 Macro loop 발동

## 7.2 Loop 진입 / 종료 / 재진입 규칙

### Macro
- **재진입 없음**. 사이클은 *한 번 살고 한 번 죽는다*. 다음은 새 사이클.

### Meso — 가장 중요
Gate 실패 시 4갈래 결정:

```
Gate 실패
  │
  ├─ 가설이 *반증*됨 (negative evidence)
  │    └─ Pivot (§7.6) — 같은 사이클 내 재실행
  │
  ├─ 가설이 *미입증*임 (insufficient evidence)
  │    └─ 현재 단계 재실행 (데이터 보강)
  │
  ├─ 산출물의 *전제*가 틀림
  │    └─ 직전 단계로 복귀
  │
  └─ 누적 재진입 N회 초과 → Kill (§7.5)
```

### Micro
- **재진입**: 다음 작업 단위로 *자동*. 의식적 결정 불필요.

### Post-launch
- **종료 없음**. 운영 중인 한 영구.
- *새 Macro loop 발동 트리거*:
  - 핵심 메트릭 X% 하락
  - 인터뷰에서 반복되는 새 신호
  - 운영 사고로 드러난 구조적 결함
  - 분기 메타-회고의 기회 식별

## 7.3 Loop 재진입 결정 표

| 신호 | 결정 | 추가 비용 |
|---|---|---|
| 가설 반증 (Loop 1) | Pivot, 같은 사이클 내 재실행 | 사이클 30~50% 추가 |
| 가설 미입증 (데이터 부족) | 현재 단계 재실행 (인터뷰·실험 보강) | 단계 시간 × 1.5 |
| 산출물의 전제 오류 | 직전 단계 복귀 | 직전 단계 시간 × 1.2 |
| 산출물의 *형식적* 결함 | 같은 단계 부분 수정 (재진입 아님) | 단계 시간 × 0.3 |
| 누적 재진입 3회 | Kill | 사이클 종료 |

## 7.4 Inter-loop carryover — 무엇이 살고 무엇이 버려지나

재진입 시 *모든 걸 버리지 않음*. **학습은 살리고, 결론은 의심하고, 코드는 버린다.**

### 살림
- 인터뷰 raw note (재해석 가능)
- 기각된 가설 + 기각 이유 (다음 사이클 출발점)
- 측정 메트릭과 임계값 근거
- 기술적 학습 (벤치마크 수치, 의존성 한계)

### 의심
- 가설의 *결론* — 데이터 재해석 시 바뀔 수 있음
- Persona 우선순위 — 인터뷰 누적되면 재정렬
- MVP 스코프 — pivot 시 통째로 재설계

### 버림
- 출시되지 않은 *프로토타입 코드* (학습은 살리되 코드는 버림)
- 비검증 가정에 기반한 산출물 (예: 검증 안 된 페르소나로 만든 UJM)

→ 회고 시 `살림 / 의심 / 버림`을 *명시적으로 분류*해 [`templates/retro.md`](./templates/retro.md)에 기록.

## 7.5 Loop 종료 (Kill Criteria) — 사이클을 *죽이는* 기준

[`C-06 Sunk cost`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다)를 코드화한다. *사전*에 kill 기준을 박아둔다.

### Hard kill (자동 종료)
- **누적 재진입 3회**: 같은 단계를 3번 재실행해도 게이트 통과 못함
- **시간 200% 초과**: 사이클 예산 시간의 2배 초과
- **예산 100% 초과**: 정해진 비용 한도 초과

### Soft kill (재평가 트리거)
- 사이클 시간 150% 도달 → *계속 vs 종료 vs pivot* 의식적 결정
- 핵심 가설이 모두 미입증 + 재실험 비용 > 새 가설 비용

### Kill 시 산출물
- *Kill 이유* 1장 ([`templates/retro.md`](./templates/retro.md) 형식)
- 살릴 학습 별도 보존
- 다음 사이클 후보에 *회피 패턴*으로 등록

## 7.6 Pivot 트리거 → Pivot 타입 매핑

[`03-validation-loops.md`](./03-validation-loops.md)의 10개 pivot 타입에 *발동 신호*를 붙인다.

| 트리거 신호 | Pivot 타입 | 비고 |
|---|---|---|
| Persona는 맞으나 *제안한 해결*이 외면 | Zoom-in / Zoom-out | 한 기능만 살림 / 더 큰 문제로 확장 |
| *다른* Persona가 같은 기능에 강한 관심 | Customer Segment | 타겟 자체 교체 |
| Customer는 맞으나 *문제*가 약함 | Customer Need | 같은 고객의 다른 문제로 |
| 가치는 인정하나 *지불 의사*가 약함 | Business Architecture / Value Capture | B2C↔B2B 또는 수익 모델 변경 |
| 기술적 *실현 비용* >> 가치 | Technology / Channel | 다른 구현 또는 다른 채널 |
| 성장 *루프*가 작동 안함 | Engine of Growth | viral/paid/sticky 전환 |
| 모든 게 작동하나 *너무 작음* | Platform | 단일 제품 → 플랫폼 |

→ Pivot은 *Macro loop 종료가 아님*. 같은 사이클 내 재진입.

## 7.7 Loop 시각화 — Hill Chart

Shape Up의 Hill Chart는 작업의 *현재 위치*를 두 단계로 표시한다.

```
                    ⛰
       Uphill              Downhill
   (탐색·발산)           (실행·수렴)
   알 수 없음 ↑          남은 일 ↓
```

- **Uphill**: 문제·가설·옵션 탐색. *알 수 없음*이 크다.
- **Downhill**: 선택된 방향 실행. *남은 일*이 명확하다.

### 활용
- 현재 단계의 작업을 hill 위 *점*으로 그림
- 매주 점 위치 업데이트
- *uphill에 정체*된 점은 신호 → 재진입 또는 kill 후보
- 1인 개발자도 *3개 이상의 점*이 동시 uphill이면 WIP 초과 ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도))

## 7.8 대안 루프 패턴 — 언제 쓰나

| 패턴 | 적합한 상황 | Harness에서의 역할 |
|---|---|---|
| **Build-Measure-Learn** (Ries) | 가설 검증 중심 | Loop 1·2의 기본 |
| **PDCA** (Deming) | 점진 품질 개선 | Post-launch loop |
| **OODA** (Boyd) | 고속·고불확실 대응 | 운영 사고 / pivot 의사결정 |
| **DMAIC** (Six Sigma) | 정량 품질 관리 | Performance budget 미달 시 |
| **Continuous Discovery** (Torres) | 지속 인터뷰 cadence | Post-launch + 다음 사이클 후보 발굴 |

→ 기본은 BML, 다른 패턴은 *명시적으로* 도입.

## 7.9 사이클 시작 시 Loop 적용 체크리스트

사이클 진입 시 각 루프의 운영 방식을 *고정*한다.

- [ ] Macro loop 시간 예산 ___주
- [ ] Meso loop 재진입 한도 ___회
- [ ] Micro loop DoD ([R-DoD01~04](./06-rules.md))
- [ ] Post-launch loop 메트릭 ___ + 트리거 임계값 ___
- [ ] Kill 기준 명시 (Hard + Soft, §7.5)
- [ ] Pivot 트리거 신호 *사전 정의* (§7.6)

## 관련 룰
- [`R-PG01~05`](./06-rules.md) — Process Gates
- [`R-SC01~04`](./06-rules.md) — Scope 관리
- [`SD-01`](./situational-rules/self-discipline.md#sd-01-time-box-validation-loops--7-14일) — Time-box
- [`C-06`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다) — Sunk cost
- [`C-09`](./situational-rules/cognitive.md#c-09-decision의-reversibility-등급) — Reversibility

## 관련 skill
- `think:retrospective` — 사이클·루프 회고
- `think:decision-maker` — pivot / kill 결정
- `pm:hypothesis-driven-dev` — 가설 재설계
- `pm:shape-up` — appetite + hill chart
- `cognition:second-order-thinker` — pivot의 2차 결과
