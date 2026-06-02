# 09. Pre-cycle — 사이클을 *시작할지* 결정하는 게이트

[`07-looping-mechanics.md`](./07-looping-mechanics.md)가 사이클 *내부*의 루프 규칙을 다뤘다면, 이 문서는 사이클이 *시작될 자격*이 있는지 점검한다. **잘못 시작된 사이클은 잘 끝낼 수 없다**.

## 9.1 왜 Pre-cycle gate가 필요한가

가장 비싼 실패는 *잘 실행된 잘못된 사이클*이다.

- 사이클 시작 = 수주~수개월의 시간 + 기회비용 잠금
- 1인 개발자의 동시 사이클 한도 = 1 ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도))
- 한 번 시작하면 *완주 압박*과 *매몰비용*이 작동 ([`C-06`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다))

→ *어떤 사이클을 시작할지*가 *사이클을 어떻게 실행할지*보다 중요한 결정.

## 9.1b 사이클 타입 — 게이트는 타입에 따라 적응한다

> *(Cycle #001 dogfood F2에서 추가)* 하네스는 본래 **제품 사이클**(외부 사용자가 있는 제품)을 전제로 설계됐다. 그러나 모든 사이클이 제품은 아니다. 타입을 먼저 선언하면 게이트 체크가 *어색하게* 적용되는 걸 막는다.

| 타입 | 정의 | 주 사용자 | 게이트 적응 |
|---|---|---|---|
| **Product** | 외부 사용자를 위한 제품/기능 | 외부 n명 | §9.2 전체 *그대로* 적용. 인터뷰 5명·Gate 1 제품 가설 유효 |
| **Dev-tool / Self** | 본인(또는 팀)이 쓰는 도구·자동화·인프라 | n=1~소수 self-user | D의 "인터뷰 5명" → *self-dogfooding*으로 대체. Gate 1 "제품 가설" → *"도구 유용성 가설"*로 치환 |
| **Exploration / Spike** | 학습·검증이 목적, 산출물은 *지식* | 본인 | A의 "문제 진술"은 *학습 질문*으로. Kill 기준을 *시간*에 강하게 건다 (스파이크는 늘어지기 쉬움) |

### 타입별 핵심 차이

- **Product** — *검증 가능성(D)*이 가장 중요. 인터뷰 대상에 접근 못 하면 첫 단계에서 막힘.
- **Dev-tool / Self** — *self-user 함정* 주의: 내가 주 사용자라 검증이 "내 맘에 듦"으로 흐른다. 그래서 *반증 조건을 행동으로* 건다 ("만들고 나서 실제로 *쓰는가*").
- **Exploration** — *완주*가 목표가 아니라 *학습*이 목표. DoD를 "코드 동작"이 아니라 "질문에 답함"으로. 시간 Kill을 짧게.

### 타입 선언은 Cycle Card 맨 위에

사이클 타입을 Cycle Card 메타에 *명시*한다. 명시 안 하면 기본 **Product**로 간주하고 §9.2를 빡빡하게 적용한다.

## 9.2 Pre-cycle 게이트 체크리스트

### A. 아이디어 — *문제부터, 해결책 나중*

- [ ] **문제 진술이 있는가?** ("사용자가 X를 못 한다" 형식, "Y를 만들고 싶다"가 아님)
- [ ] **누구의 문제인가?** 구체적 Persona 가설 1개 이상
- [ ] **얼마나 자주 / 얼마나 아픈가?** Frequency × Severity의 거친 추정
- [ ] **현재 대안은 무엇인가?** 사용자가 *지금* 어떻게 해결하나
- [ ] **해결책에 *과도하게* 끌리고 있지 않은가?** [`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit) 자기 점검

→ "Y를 만들고 싶다"로 시작하면 *문제를 사후에 끼워 맞춤*. Solution-shopping anti-pattern.

### B. 전략적 적합도

- [ ] **이전 사이클의 *학습*과 정렬되는가?** 무관한 새 방향이면 *왜* 지금 이걸 하는가
- [ ] **본인의 *현재 강점*을 활용하는가?** 또는 *의도적*으로 새 영역인가
- [ ] **현재 운영 중인 제품과 *충돌*하지 않는가?** ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도))

### C. 비용·시간 윤곽

- [ ] **시간 예산이 *잡혀* 있는가?** (Macro loop budget — [`07-looping-mechanics.md §7.9`](./07-looping-mechanics.md#79-사이클-시작-시-loop-적용-체크리스트))
- [ ] **금전 예산이 *잡혀* 있는가?** (인프라 + 도구 + 외부 인터뷰 등)
- [ ] **현재 capacity로 *완주 가능*한가?** (다른 책임/일과의 중첩 검토)
- [ ] **Kill 기준이 사전 정의되어 있는가?** ([`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준))

### D. 검증 가능성

- [ ] **Gate 1 통과 가능성이 *있는가*?** ([`08 §8.2`](./08-pass-criteria.md#82-gate-1--제품-가설-검증-기준))
- [ ] **인터뷰할 사람 5명에 *접근 가능*한가?** (아니면 사이클이 첫 단계에서 막힘)
- [ ] **가설이 *반증 가능*한 형태인가?** (반증 불가 가설은 검증 불가)

### E. 자기 점검

- [ ] **이 사이클의 *진짜 동기*는 무엇인가?** (기술 호기심? 도피? 외부 압력? 시장 기회?)
- [ ] **6개월 뒤 *후회 시나리오*는 무엇인가?** ([`C-02`](./situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet) Pre-mortem 축소판)
- [ ] **이 사이클을 *안 하면* 무엇이 나빠지는가?** (대답이 약하면 시작 자격 약함)

## 9.3 Pre-cycle 결정 매트릭스

체크리스트 결과를 다음 매트릭스에 대입.

| 항목 군 | 통과 비율 | 결정 |
|---|---|---|
| A 아이디어 + D 검증 가능성 | 모두 yes | 진행 가능 |
| C 비용·시간 | 1개 이상 no | **STOP** — 예산 부족 |
| B 전략적 적합도 | 모두 no | 재검토 — *왜* 지금 이걸 하는가 |
| E 자기 점검 — 진짜 동기가 *도피*/외부 압력 | yes | **STOP** — 다른 해결책 모색 |

## 9.4 Pre-cycle 산출물

게이트 통과 시 *다음 산출물*을 생성하고 사이클 시작.

### 1. Cycle Card (1장 요약)
- 사이클 제목 / 시작일 / 시간 예산
- 핵심 가설 (3개 이하)
- Persona 가설
- 성공 기준 (Gate 1·2 수치 — [`08-pass-criteria.md`](./08-pass-criteria.md))
- Kill 기준 (Hard + Soft — [`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준))
- 이전 사이클의 *살림/의심/버림* 인계 ([`07 §7.4`](./07-looping-mechanics.md#74-inter-loop-carryover--무엇이-살고-무엇이-버려지나))

### 2. Pre-mortem 한 장
- "6개월 뒤 이 사이클이 *실패*했다면 — 왜?" 5개 답
- 가장 가능성 높은 1-2개에 *사전 완화책*

### 3. Pivot Triggers 사전 정의
- 사이클 중 *어떤 신호*가 보이면 pivot을 고려하는가
- 신호별로 가능한 pivot 타입 매핑 ([`07 §7.6`](./07-looping-mechanics.md#76-pivot-트리거--pivot-타입-매핑))

## 9.5 Pre-cycle anti-patterns

자주 빠지는 함정 — 발견 시 *시작 보류*.

### Solution-shopping
- 증상: "Next.js로 만들고 싶은 게 있는데..."로 시작
- 위험: 문제가 *기술에 맞춰* 왜곡됨
- 대응: 문제 진술로 *다시 시작* — 그 문제에 Next.js가 맞나?

### Idea-flow excess
- 증상: 3주마다 새 아이디어로 사이클 시작
- 위험: 어느 사이클도 *완주*에 도달 못함
- 대응: WIP=1 강제 ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도)). 새 아이디어는 *큐*로.

### Validation bypass
- 증상: "이건 검증 안 해도 알아요"
- 위험: Inside view 과신 ([`C-11`](./situational-rules/cognitive.md#c-11-outside-view--비슷한-시도들의-base-rate))
- 대응: Outside view — 비슷한 시도의 base rate 확인

### Escape cycle
- 증상: 현재 사이클이 어려워서 *다른 사이클*로 도피
- 위험: 새 사이클도 같은 패턴 반복
- 대응: 현재 사이클을 *명시적으로 종료* (kill 포함) 후 새 사이클

### Half-baked persona
- 증상: "20-30대 사용자"처럼 모호
- 위험: 검증 가능한 인터뷰 대상 불특정
- 대응: 구체적 Persona 가설로 좁히기 — *접근 가능한* 5명을 떠올릴 수 있을 정도

## 9.6 Pre-cycle 결정의 *문서화*

Pre-cycle 게이트는 *기록 없이* 통과시키지 말 것.

- **Go**: Cycle Card 저장 → 사이클 시작
- **No-go**: 사유 1줄 + 큐 어디로 (재검토 / 폐기 / 다른 사람에게 인계)
- **Defer**: 보류 조건 명시 — *어떤 신호*가 보이면 재시작
- 분기별로 *No-go / Defer* 더미를 *다시 본다* — 환경 변화로 결정 바뀔 수 있음

## 9.7 Pre-cycle Skill 호출 패턴

- `pm:pm-strategy-workflow` — 큰 그림 전략 정렬
- `pm:hypothesis-driven-dev` — 가설 사전 등록
- `think:decision-maker` — Go / No-go / Defer 결정
- `cognition:bias-auditor` — E 자기 점검
- `cognition:second-order-thinker` — "이 사이클이 *성공*하면 다음에 무엇이 오나" 사고

## 관련 룰
- [`R-PG01`](./06-rules.md) — Process Gate 진입
- [`SD-01`, `SD-03`, `SD-07`](./situational-rules/self-discipline.md) — Time-box / WIP / 명시적 종료
- [`C-01`, `C-02`, `C-11`](./situational-rules/cognitive.md) — Bias / Pre-mortem / Outside view
- [`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준) — Kill criteria

## 관련 skill
- `pm:pm-strategy-workflow`
- `pm:hypothesis-driven-dev`
- `think:decision-maker`
- `cognition:bias-auditor`
- `cognition:second-order-thinker`
- `self:examined-life` — *진짜 동기* 점검
