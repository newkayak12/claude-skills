# Situational — 사고 규율 (Cognitive Discipline)

**트리거**: 결정 마비 / 한 옵션에 강한 끌림 / 큰 베팅·되돌릴 수 없는 결정 직전

1인 개발자가 가장 자주 빠지는 함정은 *확증편향*과 *매몰비용*이다. 자기 검증을 외부화하지 않으면 같은 함정을 반복한다.

## C-01: Bias check before strong commit

- **Why**: 한 옵션이 *너무 매력적*으로 보이면 보통 무언가를 *못 보고 있다*. 확증편향은 자기 인지로 잡히지 않음.
- **How**:
  - 한 옵션에 80%+ 확신이 들 때 `cognition:bias-auditor` 호출
  - "이 결정의 *반대*가 맞다면, 어떤 증거가 있어야 할까?" 질문
  - 강한 끌림 자체가 *알람*

## C-02: Pre-mortem before big bet

- **Why**: 사후 후회보다 *사전 상상*이 비용이 100배 낮음. Gary Klein의 연구.
- **How**:
  - 결정 직전에 *6개월 뒤 이게 망했다*고 가정
  - 망한 이유 5개를 쓰기 (자유롭게)
  - 그중 *가장 가능성 높은* 1-2개에 대해 사전 완화책

## C-03: Steelman the opposing view

- **Why**: Strawman으로 반대 의견을 약하게 재구성하면 자기 확신만 강화. 진짜 검증은 *반대 의견을 가장 강하게* 재구성하는 것.
- **How**:
  - 반대 입장의 *가장 강한 버전*을 적기 — 본인 입장보다 강한 톤으로
  - 그 입장의 약점이 *진짜* 약점인지 vs *내가 만든 약점*인지 점검
  - 여전히 본인 입장 유지하면 *그것이 결정*

## C-04: Devil's Advocate on irreversible decisions

- **Why**: One-way door 결정은 되돌리는 비용이 매우 큼. *반대 압력*이 사전에 있어야 함.
- **How**:
  - Reversibility 등급 *high*인 결정(스택·아키텍처·데이터 모델·계약)에 `think:devils-advocate` 호출
  - 결정 변호자(본인)와 비판자(skill) 역할 분리
  - 결정 ADR에 *반론에 대한 답*도 함께 적기

## C-05: Assumption surfacing — 가정을 *글로*

- **Why**: 가정은 *무의식*에 산다. 글로 적지 않으면 가정이 *사실*인 척 함.
- **How**:
  - 큰 결정 전에 `cognition:assumption-extractor` 호출 또는 직접 작성
  - 형식: "We are assuming [가정] is true. If false, [이런 결과]."
  - 각 가정의 *확실도*(low/medium/high)와 *검증 방법* 표기

## C-06: Sunk cost — *과거 투입*은 결정에 영향 주지 않는다

- **Why**: 이미 쓴 시간·돈은 *되돌릴 수 없음*. 미래만 결정의 변수가 되어야 함.
- **How**:
  - 매 게이트에서 *지금부터의 비용·가치*만 계산 (과거 무시)
  - 매몰비용이 압박할 때 *pivot 선택지*를 의식적으로 다시 평가
  - "여기까지 왔는데"라는 생각은 알람

## C-07: Strawman vs Steelman 구분

- **Why**: 토론에서 strawman을 사용하면 *자기 자신을 속이는 효과*가 가장 큼. 본인이 토론 양쪽 다 하는 1인 개발자에게 특히 위험.
- **How**:
  - 반대 입장 재구성 후 *그 입장의 사람에게 보여줘도 동의할까?* 질문
  - 동의 안 할 것 같으면 strawman — 다시 작성

## C-08: First-principles thinking — *유추*에서 *원리*로

- **Why**: "다른 사람이 X 하니까 우리도 X"는 *유추*. 유추는 빠르지만 *컨텍스트 차이*를 무시.
- **How**:
  - 결정의 *기본 원리*까지 분해 (왜 이게 필요한가 → 왜 이 방식인가 → 왜 다른 방식이 안 되나)
  - `think:first-principles` 호출 또는 5 Whys 적용
  - 원리 수준에서 답이 나오면 *유추 결정*보다 단단

## C-09: Decision의 *Reversibility* 등급

- **Why**: 결정마다 *되돌리는 비용*이 다름. 같은 깊이로 다루면 빠른 결정이 무거워지고 무거운 결정이 가벼워짐.
- **How**:
  - 결정 시작 시 등급 부여:
    - **Two-way door** (낮은 reversibility 비용): 빠르게, 실험 OK
    - **One-way door** (높음): ADR + pre-mortem + devil's advocate
  - 등급 자체를 ADR 메타데이터에 기록

## C-10: 결정 마비 — "더 많은 데이터"는 답이 아닐 수 있다

- **Why**: 정보가 *충분*해도 결정을 미루는 패턴. 결정 자체의 두려움이 *데이터 부족*으로 위장.
- **How**:
  - "추가 데이터를 얻으면 *어떤 답이 어떻게 바뀌나*?" 질문
  - 답이 안 바뀌면 *지금 결정*
  - Time-box 적용 — 결정 deadline 명시 (`R-SC03`의 appetite)

## C-11: Outside view — *비슷한 시도들*의 base rate

- **Why**: Inside view(우리는 다르다)는 거의 항상 과대평가. Outside view(통계적으로 비슷한 시도들의 결과)가 더 정확.
- **How**:
  - 비슷한 시도가 *얼마나 성공/실패*했나? 출처와 함께 적기
  - 우리가 *왜 그 base rate를 깰 것인가*에 구체적 근거
  - 근거 없으면 base rate 따라가는 게 합리적

## 관련 skill

- `think:decision-maker` — 옵션 비교·선택
- `think:devils-advocate` — 결정 반대 압력
- `think:problem-reframer` — 문제 정의 자체 재점검
- `cognition:bias-auditor` — 편향 점검
- `cognition:assumption-extractor` — 가정 surface
- `cognition:second-order-thinker` — 2차·3차 결과 사고
- `cognition:tradeoff-articulator` — Trade-off 명료화
- `think:first-principles` — 원리 분해
