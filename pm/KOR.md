# pm — 한국어

[English](README.md) · **한국어**

제품 의사결정의 전 구간을 다루는 PM 스킬 모음입니다. 시장과 사용자에 대해 실제로 참인 것을
알아내고, 엔지니어가 바로 착수할 수 있게 문서로 정리하고, 무엇을 만들지 고르고, 출시하고,
그 결과를 함께 일하는 사람들에게 설명하는 것까지. 각 스킬은 체크리스트가 아니라 이름 붙은
산출물이 나오는 작업 방식입니다 — PRD, RICE 점수가 매겨진 백로그, GTM 캔버스, 피치,
이해관계자 맵, 러닝 카드.

대부분의 스킬은 "이건 이 스킬로 하지 마세요"를 명시하고 대신 형제 스킬로 넘깁니다. 요청이
엉뚱한 스킬에 도착해도 플러그인이 계속 쓸모 있도록.

## 설치 & 제거

```bash
/plugin install pm@newkayak12-claude-skills
/plugin uninstall pm@newkayak12-claude-skills
```

여러 스킬이 `think-tool`, `sequential-thinking`, `mcp-reasoner`를 recommended MCP로 지정합니다.
없어도 동작하지만 포지셔닝 논리, 여러 단계 체인, 점수 산정의 일관성이 붙였을 때 확실히 낫습니다
(Claude 설정 → MCP Servers → remote SSE 엔드포인트 추가).

## 어떤 스킬이 필요한가요?

**전체 프로세스**

| 하고 싶은 것 | 스킬 |
|---|---|
| 시장 분석부터 이해관계자 승인까지 단계별로 진행 | `pm-strategy-workflow` |

**디스커버리 & 리서치**

| 하고 싶은 것 | 스킬 |
|---|---|
| 우리 팀에 어떤 디스커버리 방식이 맞는지부터 판단 | `product-discovery` |
| 지속적 디스커버리 습관 만들고 네 가지 제품 리스크 검증 | `inspired-pm` |
| 인터뷰 노트를 n= 카운트가 붙은 인사이트 카드로 정리 | `customer-research-synthesis` |
| 반증 가능한 가설과 가장 작은 실험 설계 | `hypothesis-driven-dev` |
| 경쟁사 지도를 그리고 우리가 차지할 빈 공간 찾기 | `competitive-analysis` |

**정의 & 스토리**

| 하고 싶은 것 | 스킬 |
|---|---|
| 엔지니어가 바로 쓸 수 있는 PRD 작성 | `prd-development` |
| Given/When/Then 인수 조건이 붙은 스토리 한 건 작성 | `user-story` |
| 백본·태스크·릴리스 슬라이스가 있는 스토리 맵 생성 | `user-story-mapping` |
| 스코프가 아직 흐릿할 때 질문받으며 스토리 매핑 진행 | `user-story-mapping-workshop` |
| 에픽을 독립 배포 가능한 스토리로 분해 | `user-story-splitting` |
| 엔지니어를 부르기 전에 기술 타당성 빠르게 확인 | `technical-feasibility-assessment` |

**우선순위 & 계획**

| 하고 싶은 것 | 스킬 |
|---|---|
| 백로그를 방어 가능하게 정렬하고 "안 만들 것" 명시 | `feature-prioritization` |
| KR이 기능 출시가 아니라 성과가 되는 분기 목표 설정 | `okr-planning` |
| 스프린트를 6주 사이클·피치·베팅 테이블로 교체 | `shape-up` |

**출시 & 성장**

| 하고 싶은 것 | 스킬 |
|---|---|
| 비치헤드·메시지·채널·단계별 롤아웃으로 출시 계획 | `go-to-market-planning` |
| 가격 모델, 가치 지표, 요금제 패키징 결정 | `pricing-monetization-strategy` |
| 제품이나 캠페인에 입소문 요소를 설계해 넣기 | `contagious` |
| 반응하기 전에 지표가 왜 움직였는지 파악 | `metrics-interpretation` |
| 출시 후 루프를 닫고 배운 것을 남기기 | `post-launch-retrospective` |

**커뮤니케이션**

| 하고 싶은 것 | 스킬 |
|---|---|
| 대상별로 로드맵과 "왜 이건 안 하는지" 설명 | `roadmap-communication` |
| 막고 있는 특정 인물에게서 승인 받아내기 | `stakeholder-management` |

## 스킬

### `pm-strategy-workflow`

전체 전략 사이클의 진입점. 일곱 개 스킬을 정해진 순서로 구동합니다 — `competitive-analysis` →
`prd-development` → `feature-prioritization` → `pricing-monetization-strategy` →
`go-to-market-planning` → `roadmap-communication` → `stakeholder-management`. 각 단계의 산출물이
다음 단계 입력으로 넘어갑니다(포지셔닝 갭 → PRD, PRD의 기능 목록 → 우선순위, 정리된 백로그와
가격 → GTM). 단계마다 건너뛸 조건이 문서화돼 있고, 중간 단계부터 진입할 수도 있습니다.
산출물 하나만 필요하면 해당 스킬을 직접 부르세요.

```
신제품 전략을 처음부터 GTM까지 돌리고 싶어. 경쟁사 분석부터 시작하자.
경쟁 지형 자료가 6개월 됐으니 Step 1은 건너뛰지 말고.
```

| 단계 | 스킬 | 산출물 |
|---|---|---|
| 1 | `competitive-analysis` | 경쟁사 프로필, 포지셔닝 갭, "우리만" 문장 |
| 2 | `prd-development` | 문제 정의·스토리·성공 지표가 포함된 PRD |
| 3 | `feature-prioritization` | RICE 점수 백로그, MoSCoW 구분, 사이클 스코프 |
| 4 | `pricing-monetization-strategy` | 가격 모델, 티어 구조, WTP 검증 계획 |
| 5 | `go-to-market-planning` | GTM 브리프, 출시 시퀀스, 메시징, 채널 |
| 6 | `roadmap-communication` | 대상별 로드맵과 내러티브 |
| 7 | `stakeholder-management` | 이해관계자 맵, 영향력 전략, 커뮤니케이션 계획 |

---

**디스커버리 & 리서치**

### `product-discovery`

라우팅 스킬. 세 가지 질문(가장 큰 통증, 현재 방식, 팀 성숙도)으로 맥락을 진단해서 지속적
디스커버리(`inspired-pm`)와 고정 사이클(`shape-up`) 중 어디로 갈지 정해주고, 두 방식을 다른
시간 축에서 함께 쓰는 법도 보여줍니다 — "다음 6주에 뭘 만들까"는 Shape Up, "애초에 뭘 만들어야
하나"는 지속적 디스커버리. 현재 실천도를 0–10으로 채점도 합니다. 개별 가설 작성이나 특정
워크숍 진행에는 쓰지 않습니다.

```
우리 팀이 스프린트 지옥에 빠져 있고 백로그는 계속 늘어나. Shape Up이 맞을까,
아니면 continuous discovery부터 잡아야 할까? 현재 상태 진단해줘.
```

### `inspired-pm`

Marty Cagan의 임파워드 팀 모델. 디스커버리를 한 단계가 아니라 매주 하는 훈련으로, 기능 전달이
아니라 성과 소유로, 그리고 만들기로 확정하기 전에 네 가지 제품 리스크(가치·사용성·실현
가능성·사업 타당성)를 전부 검증합니다. 팀의 디스커버리 실천도 진단, 기능 로드맵을 성과
로드맵으로 전환, 주간 고객 인터뷰 세팅에 씁니다. 개별 스토리 작성이나 스프린트 실행은 아닙니다.

```
우리 팀이 완전히 feature factory야. 로드맵도 기능 목록이고.
현재 discovery 실천도를 점수 내고, outcome 로드맵으로 바꾸는 첫 단계를 알려줘.
```

### `customer-research-synthesis`

원자료 → 어피니티 클러스터 → Jobs-to-be-Done → 인사이트 카드 → 가설 체인을 돌립니다. 모든
클러스터에 n= 카운트와 "패턴인가 일화인가" 판정이 붙어서, 목소리 큰 인터뷰이 한 명이 로드맵
항목이 되는 일을 막습니다. 기존 합성 결과를 0–10으로 평가할 수도 있습니다. 정량 설문 통계는
`metrics-interpretation`, 경쟁 리서치는 `competitive-analysis`로.

```
인터뷰 10건 노트를 붙여넣을게. 어피니티 클러스터를 n= 카운트와 함께 뽑고,
패턴인지 일화인지 판정해서 PRD에 넣을 인사이트 카드로 만들어줘.
```

산출물: 카운트가 붙은 어피니티 클러스터, 패턴/일화 판정, JTBD 상위 3개, 인사이트 카드(관찰 +
근거 + 함의), 추천 가설.

### `hypothesis-driven-dev`

아이디어를 반증 가능한 주장과 그것을 죽일 수 있는 가장 작은 실험으로 바꿉니다. 4부 형식의
가설, 중단 기준을 담은 귀무가설, 가장 먼저 검증할 riskiest assumption, 그리고 그에 맞는 실험
유형(컨시어지 / fake door / 프로토타입 / A/B)을 냅니다. 출시 후 지표 분석은
`metrics-interpretation`, 무엇을 만들지 정하는 건 `feature-prioritization`.

```
고객 문의함에 AI 요약 기능을 넣을까 고민 중이야. 가설을 쓰고, 가장 위험한 가정을
지목하고, 2주 안에 돌릴 수 있는 최소 실험을 설계해줘.
```

```
[X를 하면] [고객 Y에게] [결과 Z]가 생길 것이다.
[측정 가능한 신호]가 보이면 맞은 것이다.
[중단 기준]이면 멈춘다.
Riskiest assumption: …   추천 MVE: fake door / concierge / prototype / A/B
```

### `competitive-analysis`

경쟁 범위 정의(직접·간접·대체·신흥)부터 기능 매트릭스, 2×2 포지셔닝 맵, SWOT-lite, 차별화
전략까지 6단계. 끝에는 "[회사]만이 [사용자]에게 [이유] 때문에 [역량]을 제공할 수 있다" 문장과
명시적인 트레이드오프가 남습니다. 기능 동등성은 목표가 아니라 기본값으로 취급합니다. 외부
경쟁자가 없는 내부 도구에는 쓰지 마세요. 사용자 리서치의 대체재도 아닙니다 — 경쟁사가 무엇을
만들었는지는 알려주지만 사용자가 무엇을 원하는지는 알려주지 않습니다.

```
경쟁사 분석 해줘. 우리는 중소 물류사 대상 WMS고, 주요 경쟁자 4곳 대비
포지셔닝 갭과 "우리만 할 수 있는 것" 문장까지 뽑아줘.
```

산출물: **Competitor Profiles**와 **Positioning Gap Summary**(기능 매트릭스 + 포지셔닝 맵 +
SWOT-lite + 차별화 권고).

---

**정의 & 스토리**

### `prd-development`

8개 페이즈 — 요약, 문제 정의, 페르소나, 전략적 맥락, 솔루션 개요, 성공 지표, 유저 스토리와
요구사항, out of scope와 의존성. 채워 넣는 `template.md`, `references/`의 페이즈별 예시,
`examples/`의 전체 PRD 샘플이 함께 있습니다. 요구사항보다 문제와 페르소나가 먼저, 솔루션 목록
보다 성공 지표가 먼저입니다. 작은 버그 수정에는 과합니다. 지속적 디스커버리 실험은
`hypothesis-driven-dev`로.

```
디스커버리 스프린트 결과를 붙여넣을게. 엔지니어가 바로 착수할 수 있는 PRD로
정리해줘. 성공 지표와 out of scope는 특히 분명하게.
```

### `user-story`

Mike Cohn 형식("As a / I want to / so that")에 Gherkin 인수 조건을 붙인 스토리 한 건을 쓰고,
INVEST와 "When 하나, Then 하나" 규칙으로 검증합니다. `template.md`와 결정론적 스텁 생성기
`scripts/user-story-template.py`가 포함돼 있습니다(파일도 쓰지 않고 네트워크도 안 씁니다).
에픽 분할은 `user-story-splitting`, 전체 워크플로 매핑은 `user-story-mapping`, 순수 기술 부채는
대상이 아닙니다.

```
PRD의 "결제 수단 저장" 요구사항을 Given/When/Then 인수 조건이 들어간
유저 스토리로 변환해줘.
```

```bash
python3 scripts/user-story-template.py --persona "trial user" \
  --action "log in with Google" --outcome "access the app without a new password"
```

### `user-story-mapping`

페르소나·내러티브·워크플로가 이미 있을 때 맵을 생성합니다. 세그먼트와 페르소나 → JTBD
내러티브 → 백본 활동 3–5개 → 스텝 → 태스크 → MVP / Release 2 / Future 슬라이스로 세로 정렬.
백본은 시스템이나 기술 레이어가 아니라 사용자 워크플로를 따라야 합니다. 스코프를 대화하며
발견해야 한다면 워크숍 스킬로.

```
온보딩 플로우 스토리 맵 만들어줘. 페르소나와 워크플로는 아래에 정리해뒀고,
MVP / R2 / Future 슬라이스까지 갈라줘.
```

### `user-story-mapping-workshop`

퍼실리테이션 버전. 최대 5개의 적응형 질문, 각 분기마다 3–4개의 번호 붙은 선택지로 스코프와
페르소나를 함께 발견합니다. Claude가 백본·태스크·릴리스 슬라이스(Walking Skeleton, R2, R3)를
제안하고 기술 레이어식 사고를 잡아주면, 판단과 실현 가능성 검증은 사용자가 합니다. 맥락이 이미
정리돼 있거나, 단일 기능 스코핑이거나, 사용자 워크플로가 없는 리팩터링에는 쓰지 마세요.

```
스토리 맵을 처음 만들어봐. 신규 모바일 앱인데 스코프가 아직 흐릿해.
질문 하나씩 던져주면서 같이 진행해줘.
```

### `user-story-splitting`

8개 분할 패턴(워크플로 단계, 비즈니스 규칙, 데이터 변형, 인수 조건 복잡도 등)을 순서대로
적용하고 처음 맞는 패턴에서 멈춘 뒤, 각 스토리가 독립적으로 배포·테스트 가능한지 확인합니다.
수평 분할(프론트엔드 스토리 / 백엔드 스토리)도 아니고 태스크 분해도 아닙니다. 이미 작은
스토리나 기술 태스크에는 쓰지 않습니다.

```
이 에픽이 한 스프린트에 안 들어가. When 절이 3개야.
어떤 패턴으로 쪼개야 하는지 정하고 독립 배포 가능한 스토리로 분리해줘.
```

### `technical-feasibility-assessment`

엔지니어링 시간을 쓰기 전에 PM 수준에서 내리는 타당성 판단. 데이터·인프라·연동·팀 역량·시간
다섯 축을 채점하고, 가장 위험한 가정 하나를 명시하고, build/buy/partner 권고와 "확정 전에
반드시 엔지니어와 확인해야 할" 레드 플래그를 냅니다. 엔지니어링 견적, 아키텍처 설계, 스프린트
계획은 아닙니다.

```
로드맵 확정 전에 이 AI 추천 기능의 기술 타당성 빠르게 봐줘.
현재 스택으로 2스프린트 안에 가능한지, 어디가 제일 위험한지.
```

```
Feasibility Signal: [High / Medium / Low / Unknown]
- Data / Infrastructure / Integrations / Team Skill / Time: [Low|Medium|High risk] — 근거
Make vs. Buy: [Build / Buy / Partner] — 이유
Red flags requiring engineering consultation: …
Recommended next step: …
```

---

**우선순위 & 계획**

### `feature-prioritization`

상황별로 세 가지 프레임워크. 큰 백로그를 정량 정렬할 땐 RICE, 릴리스의 in/out 선을 그을 땐
MoSCoW, 워크숍에서 빠르게 정할 땐 Value-Risk-Effort 그리드. "전부 P1"인 실패 모드를 위한 강제
순위 기법도 있습니다. 점수 기준은 채점 전에 합의하고, 임팩트 추정과 공수 추정은 앵커링을
피하려고 분리합니다. 결과 로드맵을 전달하는 건 `roadmap-communication`, 목표 설정은
`okr-planning`.

```
백로그 50개인데 P1이 절반이야. RICE로 점수 내고 이번 분기 스코프를 잘라줘.
안 하기로 한 것과 그 이유도 같이.
```

```
Priority | Feature            | RICE  | Rationale                          | Quarter
P1       | Guided onboarding  | 3,200 | 활성화 KR을 직접 움직임              | Q2
P3       | Dark mode          | 420   | 커뮤니티 요청, KR 영향 낮음          | Q3
Deferred | 3rd-party integr.  | —     | 벤더 API 미준비                     | Q4
```

모든 목록에는 사용한 기준, 이번에 만들지 *않는* 것과 그 이유, 각 항목이 기여하는 OKR, 재검토
날짜가 함께 붙습니다.

### `okr-planning`

Doerr 모델 전체. 정성적 Objective, 측정 가능한 Key Result, committed와 stretch의 구분, 순수
톱다운이 아닌 회사 → 팀 캐스케이딩, 그리고 CFR(대화·피드백·인정) — 이게 없으면 OKR은 스프레드
시트 작업으로 전락합니다. 반복해서 교정하는 지점은 output KR이 아니라 outcome KR입니다.
"기능 출시"는 Key Result가 아닙니다. 사이클 내부의 백로그 정렬이나 스프린트 태스크 추적은
대상이 아닙니다.

```
이번 분기 팀 OKR 초안이야. KR이 전부 "기능 출시" 형태인데 outcome으로 다시 써주고,
회사 목표와의 정렬도 확인해줘.
```

### `shape-up`

Basecamp의 사이클 모델. 견적 대신 appetite(스코핑 전에 정하는 시간 예산), 피치로의 shaping,
백로그를 대체하는 베팅 테이블, 스스로 스코프를 깎는 자율 팀, 힐 차트, 2주 쿨다운. 피치 작성,
베팅 테이블 운영, 스프린트에서 벗어나기에 씁니다. 단일 스토리 견적, 스탠드업, 버그 트리아지,
목표 설정에는 쓰지 않습니다.

```
Shape Up 피치 써줘. 문제는 대량 주문 취소 처리고 appetite는 6주.
rabbit hole과 no-go를 명시적으로 뽑아줘.
```

```
Pitch: [이름]
Appetite: [1-2주 / 6주]
Problem: [한 문단]
Solution sketch: [굵은 마커 수준 — 무엇을 하는지, 어떻게 만드는지는 아님]
Rabbit holes: [이름 붙인 함정 — 출입 금지 선언]
No-gos: [명시적 제외 항목]
```

---

**출시 & 성장**

### `go-to-market-planning`

다섯 단계. 우선순위 그리드(통증 강도 × 도달 용이성 × 전략적 가치)로 비치헤드 세그먼트를 고르고,
핵심 메시지를 만들고, 채널을 고르고, 단계별 성공 게이트가 붙은 3단계 롤아웃(베타 → 제한 →
전체)을 정의하고, 제품 헬스 지표와 분리된 출시 지표를 세웁니다. 출시 전/출시 당일 체크리스트가
포함됩니다. 릴리스 노트면 충분한 소규모 배포나, 광범위한 출시가 이른 PMF 이전 제품에는 쓰지
마세요.

```
6주 뒤 출시야. 비치헤드 세그먼트부터 정하고, 메시지·채널·베타→제한→전체
롤아웃 단계와 각 단계 성공 기준까지 GTM 브리프로 만들어줘.
```

산출물: **GTM Canvas**와 **Rollout Plan**(대상·목표·성공 게이트가 있는 단계 표).

### `pricing-monetization-strategy`

여섯 단계. 가치 교환 이해 → 가격 모델 선택 → 가치 지표(실제로 무엇에 과금할 것인가) 결정 →
티어 패키징 설계 → Van Westendorp, 컨조인트, 경쟁사 벤치마킹, 세일즈/CS 인터뷰로 지불 의사
검증. 마지막은 흔한 가격 안티패턴입니다. 용역 계약 가격이나 계약으로 고정된 가격에는 쓰지
마세요. 프레임워크는 주지만 WTP 데이터는 주지 않습니다 — 고객과는 직접 이야기해야 합니다.

```
seat 기반에서 usage 기반으로 옮기는 게 맞는지 판단해줘. B2B SaaS고,
가치 지표 후보와 3단계 요금제 구조, WTP 검증 계획까지.
```

산출물: **Pricing Model Recommendation**과 **Packaging Structure**(티어별 구성).

### `contagious`

Berger의 STEPPS 프레임워크 — Social Currency, Triggers, Emotion, Public, Practical Value,
Stories — 를 제품·기능·캠페인에 적용해 0–10으로 채점하고, 트리거 메커니즘을 명시적으로 지목
합니다: 현실에서 어떤 단서가 이걸 입에 올리게 만드는가. 입소문의 7%만 온라인에서 일어난다는
전제 위에서 동작합니다. 유료 획득, SEO/퍼포먼스 마케팅, 바이럴 계수 계산은 대상이 아닙니다.

```
우리 온보딩 플로우가 왜 입소문이 안 나는지 STEPPS로 진단하고 점수 매겨줘.
공유를 유발할 트리거를 제품 안에 어떻게 심을지도 제안해줘.
```

### `metrics-interpretation`

움직인 숫자에 대한 3단계 조사. 변화가 진짜인지 확인(계측, 계절성, 노이즈) → 위에서부터
세그먼트를 쪼개며 원인 좁히기 → 원인 유형에 맞는 액션 매칭. 상관과 인과 혼동 같은 흔한 함정과
"증상 → 유력 원인 → 첫 확인 대상" 진단표가 포함됩니다. 무슨 지표를 추적할지 정하는 일이나 특정
출시 평가(`post-launch-retrospective`)에는 쓰지 않습니다.

```
지난주 conversion이 15% 떨어졌어. 계측 문제인지 실제인지부터 확인하고,
세그먼트별로 원인 좁혀서 이해관계자용 메모까지 써줘.
```

출력 형식: 이해관계자용 **metric change memo**, 그리고 ship 결정이 붙은 **A/B test result
summary**.

### `post-launch-retrospective`

출시 *전에* 써둔 가설과 대조해 Build-Measure-Learn 루프를 닫습니다. 가설 검증 체크, 4개 섹션
회고(무엇을 출시했나 / 어떤 지표가 움직였나 / 무엇을 배웠나 / 무엇을 다르게 할까), 런칭 실패인지
가설 실패인지 측정 실패인지 가르는 실패 유형 진단, 팀 위키에 그대로 붙일 러닝 카드, 그리고
우선순위나 리서치로의 명시적 인계까지 나옵니다. 특정 출시와 무관한 지표 하락 진단은
`metrics-interpretation`.

```
3주 전에 출시한 기능인데 활성화 지표가 안 움직였어. 사전 성공 기준과 대조해서
가설 실패인지 런칭 실패인지 판정하고, 러닝 카드까지 만들어줘.
```

---

**커뮤니케이션**

### `roadmap-communication`

*무엇을 말할 것인가*의 문제. 같은 로드맵을 대상별로 다시 씁니다 — 엔지니어링에는 내러티브 +
의존성, 임원에는 OKR 연결 요약, 고객에는 Now/Next/Later, 세일즈에는 enablement 카드. 순서에
대한 근거, 예상되는 반박에 대한 답변, "왜 내 기능은 없냐"에 대한 네 가지 정직한 답, 그리고
피벗·지연·스코프 축소를 알리는 스크립트를 함께 줍니다. 메시지가 아니라 막고 있는 사람이
문제라면 `stakeholder-management`로.

```
우선순위가 바뀐 이유를 설명하는 로드맵 업데이트가 필요해. 임원용 한 장과
고객용 Now/Next/Later 두 벌로 만들어주고, 날짜 약속은 피해줘.
```

### `stakeholder-management`

*누구인가*의 문제. 영향력 × 관심도 2×2로 이해관계자를 배치하고, 분면별 커뮤니케이션 주기를
정하고, 설득을 시도하기 전에 저항 유형부터 진단하고, 어떤 그룹 미팅보다 먼저 1:1로 사전 조율을
합니다. 거절하는 공식(인정 → 트레이드오프 설명 → 대안 제시 → 문은 열어두기), 갈등 패턴, 최후의
수단인 에스컬레이션 경로까지 포함됩니다. 로드맵 메시지 자체를 만드는 건 `roadmap-communication`.

```
VP가 이 기능을 계속 밀어붙여서 로드맵이 흔들려. 이해관계자 맵부터 그리고,
저항 유형을 진단해서 승인 미팅 전에 뭘 해야 하는지 알려줘.
```
