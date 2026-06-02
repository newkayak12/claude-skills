# 11. Anti-patterns — 하네스의 *고장 모드* 카탈로그

룰을 *알면서도* 빠지는 함정들. 이 문서는 *지금까지 본 모든 룰을 우회하는 패턴*을 모은다. 자기 점검 도구.

## 11.1 왜 anti-pattern 카탈로그가 필요한가

룰은 *해야 할 것*을 정한다. Anti-pattern은 *하지 말아야 할 것의 형태*를 보여준다.

- 룰을 위반하면 *명시적 알람*이 작동.
- 그러나 *형태가 비슷한 위반*은 룰을 안 어긴 척 통과.
- Anti-pattern 카탈로그는 *형태 인식* 도구 — "이거 그 패턴 아닌가?" 자기 호출.

→ 분기마다 이 문서를 *읽으며* 자기 점검 ([`SD-10`](./situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰)).

## 11.2 검증 단계의 anti-patterns

### AP-01: Validation theater (검증 시늉)
- **증상**: 인터뷰 5명을 했는데 *결론이 시작 전과 같다*. "이걸로 가설 검증 완료."
- **무엇이 고장났나**: 검증의 *형식*만 거치고 *결과는 사전에 정해짐*. 확증편향이 인터뷰를 *증거 수집*으로 환원.
- **알람**: "Mom Test" 위반 — 미래 의향 질문이 과거 행동 질문보다 많음.
- **대응**: 가설 *사전 등록* ([`08 §8.4`](./08-pass-criteria.md#84-가설-사전-등록-pre-registration)) + *기각 라인*을 인터뷰 전에 박기.
- **관련**: [`C-01 Bias check`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit)

### AP-02: Persona drift
- **증상**: 사이클 진행 중 *Persona가 조용히 확장*. "20대 여성"이 어느새 "관심 있는 누구나"로.
- **무엇이 고장났나**: 인터뷰에서 Persona 외 응답을 *유효 데이터*로 분류 → 가설 검증이 *모집단 정의*까지 흔듦.
- **알람**: Gate 1 통과율 ([`08 §8.2`](./08-pass-criteria.md#82-gate-1--제품-가설-검증-기준))의 "Persona 외 발화 < 30%" 위반.
- **대응**: Persona 정의를 *명시*하고 인터뷰 raw note에 *Persona 일치 여부* 태깅.

### AP-03: Hypothesis polyamory
- **증상**: 사이클 시작 시 5개 가설 → 인터뷰 후 가설이 *15개*로 증식. 우선순위 와해.
- **무엇이 고장났나**: 새 가설을 *기존 가설 제거 없이* 추가. [`SD-02`](./situational-rules/self-discipline.md#sd-02-max-5-hypotheses-per-cycle) 위반.
- **알람**: 가설 수 > 5.
- **대응**: 새 가설 추가 시 *기존 1개 제거 + 다음 사이클 큐로 이동*.

### AP-04: Negative-evidence amnesia
- **증상**: 인터뷰 5명 중 4명이 "안 쓸 것 같다"고 했는데 *1명의 긍정*만 인용.
- **무엇이 고장났나**: 부정 증거를 *예외*로 처리. 확증편향의 가장 위험한 형태.
- **알람**: Gate 1 통과 보고서에 *부정 응답 인용*이 없음.
- **대응**: 회고에 *부정 응답을 먼저* 기술 — "5명 중 4명은 ~ 이유로 부정적이었다."

## 11.3 산출물·게이트 단계의 anti-patterns

### AP-05: Harness ceremony (하네스 의식)
- **증상**: 모든 단계 산출물을 *형식적으로* 채우지만 *결정이 안 남*. 문서가 늘어남.
- **무엇이 고장났나**: 산출물 작성이 *목적*이 됨. 검증·결정의 *수단*이 아님.
- **알람**: 사이클당 산출물 분량 > 사이클당 *결정* 수.
- **대응**: 각 산출물에 *최소 1개 결정/배제*가 박혀야 다음 단계 진행. [`R-PG02`](./06-rules.md).

### AP-06: Gate fudging (게이트 봐주기)
- **증상**: Gate 통과 기준을 *결과를 본 뒤* 완화. "이번엔 조건이 달라서..."
- **무엇이 고장났나**: [`08 §8.8`](./08-pass-criteria.md#88-수치-조정-규칙) 위반. Pre-registration의 의미 상실.
- **알람**: Gate 통과 직전에 수치 조정 PR/ADR.
- **대응**: 사이클 *시작 전* 수치 고정 → 변경 시 ADR + 사유 + 회고에 *기록*.

### AP-07: Document inflation
- **증상**: ADR 한 줄로 끝낼 결정을 *Design Doc 10페이지*로 키움.
- **무엇이 고장났나**: 의사결정의 *무게*를 *문서 무게*와 혼동.
- **알람**: 같은 결정에 RFC + Design Doc + ADR이 *모두* 있는데 결정 내용이 동일.
- **대응**: [`templates/README.md`](./templates/README.md)의 문서 매트릭스 확인 — *해당 단계*만 작성.

### AP-08: Stale ADR
- **증상**: 시스템은 PostgreSQL 안 쓰는데 ADR-0007 "PostgreSQL을 사용한다"가 *Accepted*로 남음.
- **무엇이 고장났나**: 결정 *변경* 시 새 ADR + Superseded-by 미작성. ADR 불변 규칙 위반.
- **알람**: 분기 회고에서 *읽었더니 거짓*인 ADR 발견.
- **대응**: 분기마다 *Accepted ADR 점검* → 현실과 다른 항목 Superseded 처리.

## 11.4 루프·진행 단계의 anti-patterns

### AP-09: Cycle chaining
- **증상**: 사이클이 끝나자마자 *회고 없이* 새 사이클 시작.
- **무엇이 고장났나**: [`SD-07`](./situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로) 위반. 학습이 *다음 사이클에 흡수되지 않음*.
- **알람**: 사이클 종료 → 새 사이클 시작 간격 < 1일.
- **대응**: 회고를 *사이클 종료의 정의*에 포함. 회고 없이 새 사이클 시작 *금지*.

### AP-10: Sunk-cost rescue
- **증상**: Kill criteria 도달했는데 "여기까지 왔으니 조금만 더"로 *연장*.
- **무엇이 고장났나**: [`C-06 Sunk cost`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다) 위반. [`07 §7.5`](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준) Kill 우회.
- **알람**: Hard kill 트리거 발동 후 *연장 결정*이 ADR/회고에 *기록 없이* 일어남.
- **대응**: Kill 트리거를 *자동* 게이트로. 연장은 *명시적 ADR + 새 Kill 기준 재설정*.

### AP-11: Pivot avoidance
- **증상**: 가설이 *반증*됐는데 사이클을 "단계 재실행"으로 우회. Pivot 안 함.
- **무엇이 고장났나**: [`07 §7.2`](./07-looping-mechanics.md#meso--가장-중요)의 4갈래 결정 트리에서 *가장 어려운 결정*(pivot)을 *가장 쉬운 결정*(재실행)으로 대체.
- **알람**: 같은 단계를 2회 이상 재실행해도 게이트 미통과.
- **대응**: 재진입 3회 = 자동 pivot 결정 ([`07 §7.3`](./07-looping-mechanics.md#73-loop-재진입-결정-표)).

### AP-12: WIP explosion
- **증상**: 동시 진행 사이클 2-3개. "다 함께 가면 됨."
- **무엇이 고장났나**: [`SD-03 WIP=1`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도) 위반. 어느 것도 *완주* 못함.
- **알람**: Cycle Card가 *동시* 2개 이상 active.
- **대응**: 새 사이클 시작 전 *현재 사이클 명시적 종료*. 운영 사고만 예외.

### AP-13: Hill chart stagnation
- **증상**: Hill chart의 점이 *uphill*에 3주 이상 머묾.
- **무엇이 고장났나**: 알 수 없음(uphill)이 *감소하지 않음* — 탐색이 *진척 없이* 반복.
- **알람**: 주간 hill chart 업데이트 시 점 위치 *불변*.
- **대응**: 재진입 또는 kill 후보 ([`07 §7.7`](./07-looping-mechanics.md#77-loop-시각화--hill-chart)).

## 11.5 기술·구현 단계의 anti-patterns

### AP-14: Premature scaling
- **증상**: 사용자 100명도 안 되는데 *마이크로서비스* 아키텍처.
- **무엇이 고장났나**: 현재 부하가 아니라 *상상 부하*로 설계.
- **알람**: NFR ([`08 §8.6`](./08-pass-criteria.md#86-performance-budget-defaults))의 *실측 부하* < 설계 부하의 10%.
- **대응**: First-principles ([`C-08`](./situational-rules/cognitive.md#c-08-first-principles-thinking--유추에서-원리로)) — *현재 부하 + 6개월 예상*만으로 설계.

### AP-15: Solution-shopping
- **증상**: "이 기술을 써보고 싶다"가 사이클의 *진짜 시작*.
- **무엇이 고장났나**: Solution → Problem 역순. [`09 §9.5`](./09-pre-cycle.md#95-pre-cycle-anti-patterns) 미적용.
- **알람**: Problem 진술이 *기술 이름*에 의존 ("X를 사용해서 Y를 풀자").
- **대응**: 문제 진술 *재작성* — 기술 이름 없이 문제만 적어보기. 그 문제에 그 기술이 *진짜* 맞나?

### AP-16: NFR omission
- **증상**: Design Doc의 NFR 절이 *비어 있음* 또는 "빠르게, 안정적으로"로 채움.
- **무엇이 고장났나**: 수치 없는 NFR은 *합의되지 않은 것* ([`O-02`](./situational-rules/operations.md#o-02-performance-budget--수치를-사전에-박는다)).
- **알람**: Design Doc의 NFR에 *숫자*가 없음.
- **대응**: [`08 §8.6`](./08-pass-criteria.md#86-performance-budget-defaults) baseline에서 시작 + 사이클별 조정.

### AP-17: Observability afterthought
- **증상**: 출시 직전에 *Logs/Metrics/Traces*를 추가하기 시작.
- **무엇이 고장났나**: [`O-01 Three Pillars`](./situational-rules/operations.md#o-01-three-pillars--출시-전-필수)를 *DoD의 일부*로 인식 안 함.
- **알람**: 출시 *1주일 전*에 observability 작업이 시작됨.
- **대응**: 핵심 기능 작성 시 *동시에* observability 작성 — DoD에 포함.

### AP-18: Test theater
- **증상**: 테스트는 있는데 *통과하도록* 작성. Mock으로 진짜 의존성 우회.
- **무엇이 고장났나**: 테스트가 *코드의 거울*이 됨 — 같은 가정 위에서.
- **알람**: 코드 변경 시 테스트가 *항상 같이* 변경됨 (실패 없이).
- **대응**: 핵심 경로 *통합 테스트* — mock 최소화. [`R-TST02`](./06-rules.md).

## 11.6 자기 통제·심리 단계의 anti-patterns

### AP-19: Discovery escape
- **증상**: 검증 단계에서 *코드*를 짜기 시작. "검증보다 만드는 게 빠를 듯."
- **무엇이 고장났나**: [`SD-06`](./situational-rules/self-discipline.md#sd-06-검증-대신-코드를-짜고-있나--자기-점검) 위반. 불확실성 회피.
- **알람**: 코드 작성 시간 > 인터뷰·검증 시간.
- **대응**: 자기 점검 — "지금 코드를 짜는 게 *가장 큰 리스크*를 줄이는가?"

### AP-20: Ship paralysis
- **증상**: "조금만 더 다듬으면" 무한 반복. 출시일이 *5회* 미뤄짐.
- **무엇이 고장났나**: [`SD-04 80% ship rule`](./situational-rules/self-discipline.md#sd-04-80-ship-rule), [`SD-08`](./situational-rules/self-discipline.md#sd-08-출시-미루기의-진짜-이유-점검) 위반. 비판 두려움이 *기술적 이유*로 위장.
- **알람**: 출시 미루기 *3회* 발생.
- **대응**: 베타 사용자 수 제한([`R-SC04`](./06-rules.md))으로 *심리적 노출* 줄여 출시.

### AP-21: Rule exemptionism ("나는 다르다")
- **증상**: 어떤 룰이 적용될 때마다 "이건 우리 경우 다름"으로 회피.
- **무엇이 고장났나**: [`SD-11`](./situational-rules/self-discipline.md#sd-11-나는-다르다의-점검), [`C-11 Outside view`](./situational-rules/cognitive.md#c-11-outside-view--비슷한-시도들의-base-rate) 위반. Inside view 과신.
- **알람**: "다르다" 발언이 분기당 3회 이상.
- **대응**: 비슷한 시도의 base rate를 *직접* 찾기. 차이가 *진짜* 있나 확인.

### AP-22: Retrospective skip
- **증상**: 회고를 *간단히 메모*로 대체. 다음 사이클의 carryover 미생성.
- **무엇이 고장났나**: [`R-KP01`](./06-rules.md), [`SD-07`](./situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로) 위반. 학습이 *암묵*에 갇힘.
- **알람**: 회고 산출물 < 1페이지.
- **대응**: `think:retrospective` skill 호출 + [`templates/retro.md`](./templates/retro.md) 양식 강제.

## 11.7 운영·post-launch 단계의 anti-patterns

### AP-23: Endless polish (출시 후)
- **증상**: 출시 후 *6개월간 같은 제품* 다듬기만.
- **무엇이 고장났나**: [`10 §10.8`](./10-post-launch.md#108-post-launch-안티패턴) — 새 가설 검증 없음.
- **알람**: 출시 후 *새 Macro loop 0건*.
- **대응**: 분기 메타 회고 → 다음 Macro loop 후보 강제 식별 ([`10 §10.4`](./10-post-launch.md#104-새-macro-loop-발동-트리거)).

### AP-24: Feature creep without hypothesis
- **증상**: 사용자 1명의 요청 → 가설 없이 *바로 구현*.
- **무엇이 고장났나**: 1명의 발화를 *모두의 요구*로 일반화.
- **알람**: 새 기능에 가설 사전 등록 없음.
- **대응**: 새 기능도 [`08 §8.4`](./08-pass-criteria.md#84-가설-사전-등록-pre-registration) Pre-registration.

### AP-25: Sunset avoidance
- **증상**: 명백히 죽어가는 제품을 *살릴 수 있다*고 함.
- **무엇이 고장났나**: [`C-06 Sunk cost`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다). Sunset 트리거 무시.
- **알람**: Sunset 트리거 발동 후 *재평가 회피*.
- **대응**: 분기 회고에서 sunset 트리거 *재계산*. 발동 시 자동 재평가 강제.

## 11.8 자기 점검 — 분기 anti-pattern 회고

분기마다 이 문서를 *읽으며* 다음을 점검.

- [ ] 최근 3사이클에서 *어긴* anti-pattern을 식별
- [ ] 가장 자주 어긴 1-2개 — *왜* 어겼나? (룰 비현실 vs 본인 미숙)
- [ ] 회피 도구 추가 (time-box / alarm / 외부 호출 등)
- [ ] 새 anti-pattern 발견 시 이 문서에 추가

→ 이 문서는 *살아있어야* 한다. 발견된 새 함정은 *즉시* 등재.

## 11.9 Anti-pattern × Rule 역참조 표

| Anti-pattern | 위반한 핵심 룰 |
|---|---|
| AP-01 Validation theater | C-01, SD-06 |
| AP-02 Persona drift | R-PG01, 08 §8.2 |
| AP-03 Hypothesis polyamory | SD-02 |
| AP-04 Negative-evidence amnesia | C-01, C-03 |
| AP-05 Harness ceremony | R-PG02 |
| AP-06 Gate fudging | 08 §8.4, 08 §8.8 |
| AP-07 Document inflation | templates/README |
| AP-08 Stale ADR | ADR rules |
| AP-09 Cycle chaining | SD-07, R-KP01 |
| AP-10 Sunk-cost rescue | C-06, 07 §7.5 |
| AP-11 Pivot avoidance | 07 §7.2, 07 §7.3 |
| AP-12 WIP explosion | SD-03 |
| AP-13 Hill chart stagnation | 07 §7.7 |
| AP-14 Premature scaling | C-08 |
| AP-15 Solution-shopping | 09 §9.5 |
| AP-16 NFR omission | O-02, 08 §8.6 |
| AP-17 Observability afterthought | O-01 |
| AP-18 Test theater | R-TST02 |
| AP-19 Discovery escape | SD-06 |
| AP-20 Ship paralysis | SD-04, SD-08 |
| AP-21 Rule exemptionism | SD-11, C-11 |
| AP-22 Retrospective skip | R-KP01, SD-07 |
| AP-23 Endless polish | 10 §10.8 |
| AP-24 Feature creep | 08 §8.4 |
| AP-25 Sunset avoidance | C-06, 10 §10.6 |

## 관련 skill
- `cognition:bias-auditor` — 분기 anti-pattern 회고
- `cognition:assumption-extractor` — 회피된 가정 surface
- `think:devils-advocate` — 자기 진단의 반대 압력
- `think:retrospective` — anti-pattern 패턴화
- `self:examined-life` — *왜 같은 패턴을 반복*하나 사고
