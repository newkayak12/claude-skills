# 01. Product Track — 제품 트랙

목적: **"왜·누구를 위해·무엇을 만드는가"**를 글로 확정한다. 코드를 짜기 전에 *글이 안 써진다면* 머릿속에서도 정리가 안 된 것이다.

## 1.1 Persona 정의

### 무엇

대상 고객의 *구체적 한 사람*을 만들어내는 작업. 추상적인 "20대 직장인"이 아니라 "**김OO, 27세, 4년차 백엔드 개발자, 매주 토요일 사이드 프로젝트 2-3시간**" 수준으로 좁힌다.

### 흔한 실수

- **Persona가 너무 넓다**: "개발자". 너무 추상적이면 어떤 결정도 못 내림.
- **Persona가 인구통계뿐이다**: 나이/성별/직업만 있고 *행동·동기·맥락*이 없음.
- **Persona가 자기 자신이다**: 1인 개발자가 가장 자주 빠지는 함정. "내가 쓸 거니까"는 검증이 아니다.

### 더 강한 대안: Jobs-to-be-Done (JTBD)

Persona가 *누구인가*에 답한다면, JTBD는 *그 사람이 어떤 일을 끝내려고 우리 제품을 고용하는가*에 답한다. Clay Christensen의 framing:

> "사람들은 제품을 사는 게 아니다. **자기 삶에서 진전(progress)을 만들기 위해 제품을 고용한다(hire)**."

JTBD 문장 템플릿:

> When **[상황]**, I want to **[motivation]**, so I can **[expected outcome]**.

예시: *When I'm reviewing a long PR at the end of the day, I want to surface only the structural changes first, so I can decide whether to block or skim the rest.*

JTBD가 좋은 이유: Persona보다 **변경에 강하다**. 사람의 나이는 변해도, 끝내려는 일(progress)은 안정적이다.

### 산출물 형식

- Persona 카드 1-3장 (이름, 사진/이모지, 한 줄 정의, 주간 일과, 좌절 포인트 3개, 도구/대안, JTBD 문장 1-2개)
- JTBD 문장 5-10개 (우선순위 표시)

## 1.2 Service Concept 정의

### 무엇

"우리는 [누구]에게 [무엇]을 [어떻게]로 제공한다"를 **한 문장**으로 못 적으면 컨셉이 안 잡힌 것이다.

### 도구

**Value Proposition Canvas** (Strategyzer)
- 좌측 (Customer Profile): Jobs / Pains / Gains
- 우측 (Value Map): Products & Services / Pain Relievers / Gain Creators
- 좌·우가 *맞물려야* 가치 제안이 성립.

**Lean Canvas** (Ash Maurya — Business Model Canvas의 스타트업 변종)
- 9칸: Problem / Customer Segments / UVP / Solution / Channels / Revenue / Cost / Key Metrics / Unfair Advantage
- 1인 개발자에게 가장 유용한 항목: **Problem**, **UVP**, **Key Metrics**.

### Unique Value Proposition 검증

UVP 한 줄을 적은 뒤 스스로 묻기:
1. 이 문장에서 우리 제품 이름을 경쟁사 이름으로 바꿔도 말이 되는가? → 그러면 *unique*하지 않음.
2. 이 문장이 누군가의 *deal-breaker*인 통점을 직접 짚고 있는가? → 아니면 "nice to have"임.

## 1.3 Requirements 수집

### 채널

| 채널 | 얻는 것 | 한계 |
|---|---|---|
| 1:1 인터뷰 (5-7명) | 동기·맥락·언어 | 일반화 위험 |
| 설문 | 빈도·비율 | 동기 파악 약함 |
| 관찰 (사용자가 실제 일하는 모습) | 무의식 행동·우회 패턴 | 시간 소요 |
| 분석 데이터 (있는 경우) | 실제 행동 | "왜"가 빠짐 |
| 경쟁 제품/대안 분석 | 갭·차별점 | 베껴쓰기 위험 |

### 인터뷰 질문 패턴

**나쁜 질문**: "이런 기능이 있으면 쓰시겠어요?" → 미래 가정 질문은 거의 모든 사람이 "네"라고 답함. 무용.

**좋은 질문**:
- "마지막으로 X 했던 게 언제였나요? 그때 정확히 어떻게 하셨어요?" (과거 행동)
- "그게 잘 안 풀린 적이 있나요? 어떻게 우회하셨어요?" (workaround → 진짜 통점의 신호)
- "오늘 그 일을 하기 직전에 무슨 일이 있었나요?" (trigger 파악)

→ **The Mom Test** (Rob Fitzpatrick) 원칙: 미래 의견이 아니라 **과거 행동**을 묻는다.

### 산출물

- 인터뷰 노트 (raw)
- Affinity diagram 또는 코딩 결과 (insight n=X 형식)
- "들은 가설" 목록 (검증 게이트로 넘길 후보들)

## 1.4 SRS / RFP — 요구사항 정의서

### 용어 정리

- **RFP** (Request for Proposal): 발주측이 외주에 요청할 때 쓰는 문서. "이런 걸 만들어달라"의 형식.
- **SRS** (Software Requirements Specification): 시스템이 *무엇을 해야 하는지*를 명세하는 문서. IEEE 830 또는 후속인 ISO/IEC/IEEE 29148:2018이 표준.

1인 개발자라면 RFP는 보통 불필요. SRS만 작성한다.

### SRS 구조 (lean version)

1. **서론** — 목적, 범위, 정의·약어, 참고자료
2. **전체 설명** — 제품 컨텍스트, Persona, 가정·제약
3. **기능 요구사항 (FR)** — 시스템이 해야 하는 행동. 보통 use case 또는 user story로 표현.
4. **비기능 요구사항 (NFR)** — 시스템이 *어떻게* 해야 하는지의 품질 속성.
5. **외부 인터페이스** — 외부 시스템, API, UI 윤곽.
6. **데이터 요구사항** — 핵심 엔티티, 보유 기간, 정합성 요구.

→ 슬림 템플릿: [`templates/srs.md`](./templates/srs.md)

### NFR이 가장 자주 빠진다

FR은 자연스럽게 적게 되지만, NFR을 명시하지 않으면 나중에 "왜 이게 느리지?"가 *버그*가 아니라 *합의되지 않은 기준*의 문제가 된다.

**NFR 7가지 카테고리** (FURPS+):
- **Functionality** (Func 외 보안·상호운용)
- **Usability** (학습 시간, 접근성)
- **Reliability** (가용성 %, MTBF, fault tolerance)
- **Performance** (응답시간, throughput, 자원)
- **Supportability** (테스트성, 유지보수성, 국제화, 설치)
- "+": Implementation / Interface / Operations / Packaging / Legal

ISO/IEC 25010이 더 정밀하지만, FURPS+로 1차 점검 가능. → 상세는 [`04-unknowns.md`](./04-unknowns.md#nfr-taxonomy).

### FR 작성 단위

**User Story** 형식:
> As a [persona], I want [capability], so that [outcome].

**Acceptance Criteria** — Gherkin:
> Given [precondition], When [action], Then [observable outcome].

acceptance criteria가 명확하지 않으면 그 스토리는 *불완전*하다 — 완료를 판정할 수 없기 때문.

## 1.5 User Journey Map (UJM)

### 무엇

페르소나가 *시작 트리거*부터 *목표 달성*까지 거치는 단계를 시간 축으로 펼치고, 각 단계에서의 **행동·접점·생각·감정·통점**을 표시한 다이어그램.

### 비슷한 것과의 구분

| 도구 | 시점 | 시각 | 포함 범위 |
|---|---|---|---|
| User Journey Map | 사용자 중심 | 외부 (사용자가 보는 것) | 1명의 여정 |
| Service Blueprint | 서비스 제공자 중심 | 외부 + 내부 (백오피스/시스템 포함) | front-stage + back-stage |
| Experience Map | 사용자 중심 (제품 무관) | 외부 | 더 광범위, 제품 *이전*의 삶 포함 |

→ MVP 단계에서는 **UJM 한 장**이면 충분. 운영 단계 진입 후 Service Blueprint로 확장 고려.

### 작성 방법

1. **단계(phase) 정의**: Awareness → Consideration → Onboarding → Usage → Renewal/Churn 같은 큰 줄기
2. **각 단계에서의 행동**: 사용자가 *실제로* 하는 일
3. **접점(touchpoint)**: 사용자가 만나는 화면·메일·콜·물리적 사물
4. **생각·감정**: 인용구 또는 ↑↓ 표시
5. **통점(pain point)**: 단계마다 *최소 1개*. 통점이 없는 단계는 의심하라 — 진짜 없는 건지, 못 본 건지.
6. **기회(opportunity)**: 통점마다 우리가 개입할 수 있는 지점

### 산출물

- 현재 상태 UJM (As-is) — 우회 도구로 일을 끝내고 있는 모습
- 목표 상태 UJM (To-be) — 우리 제품이 들어간 모습
- 두 맵의 *차이*가 곧 우리가 만들어야 할 변화.

## 1.6 MVP 범위 정의

### MVP의 본래 의미

Eric Ries의 정의: **"최소한의 노력으로 검증된 학습을 얻을 수 있는 제품 버전."**

→ "minimum viable"의 *viable*은 "고객이 가치를 인지할 수 있는"의 의미이지, "기능이 거의 없는"이 아니다. 기능이 적어도 *어떤 가치를 분명히 제공*해야 MVP다.

### 두 가지 흔한 함정

- **MMP (Minimum Marketable Product)와 혼동**: MMP는 *판매 가능한* 최소 제품. MVP는 *학습 가능한* 최소 제품. 둘은 다르다. MVP가 MMP보다 더 작다.
- **'얇은 모든 것' vs '두꺼운 일부'**: Spotify가 자전거·스쿠터·자동차 비유로 설명. *전체 가치를 한 번에* 제공하는 가장 단순한 형태를 골라야 한다 — 자동차 부품을 따로 주면 사용자는 못 굴림.

### Scope 결정 도구

**MoSCoW**: Must / Should / Could / Won't (이번 release에는). 가장 빠른 방법.

**RICE 스코어**: Reach × Impact × Confidence ÷ Effort. 정량 비교가 필요할 때.

**Story Mapping** (Jeff Patton):
- 가로축: 사용자 여정 (backbone activities)
- 세로축: 우선순위 (각 활동 안에서)
- *수평으로 자른 띠* = release slice. R1(MVP), R2, R3 순서로 펼친다.

→ 1인 개발자에게는 **Story Mapping이 가장 잘 맞는다**. UJM과 자연스럽게 이어지고, "자전거 → 자동차"의 점진성을 강제하기 때문.

### MVP 종료 기준

"몇 개 만들었는가"가 아니라 **"어떤 학습이 끝났는가"**로 종료. 검증 루프 1의 결과로 다음 사이클 진입 또는 pivot 결정.

## 1.7 트랙 산출물 체크리스트

- [ ] Persona 카드 1-3장 (JTBD 문장 포함)
- [ ] Service Concept 1줄 + Value Proposition Canvas 또는 Lean Canvas
- [ ] 인터뷰 노트 (5-7명 분량)
- [ ] SRS — FR(user stories + AC) + NFR(FURPS+ 7카테고리 점검)
- [ ] User Journey Map (As-is + To-be)
- [ ] MVP scope — Story Map의 첫 슬라이스 또는 MoSCoW의 Must 묶음
- [ ] 검증 게이트 1로 넘길 *가설 목록* (3-5개)
