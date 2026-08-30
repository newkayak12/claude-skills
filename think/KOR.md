# think — 한국어

[English](README.md) · **한국어**

일 시작 전에 하는 생각을 위한 스킬입니다 — 처음 떠오른 안에 안주하지 않고 옵션을 만들어내기,
문제가 제대로 정의됐는지부터 의심하기, 현실이 먼저 때리기 전에 내 계획을 충분히 세게 때려보기,
그리고 감이 아니라 기준으로 결론에 도달하기. 전 과정을 다 돌리고 싶으면 진입점은
`deep-thinking-workflow`이고, 나머지는 각각 단독으로 씁니다.

## 설치 / 제거

```bash
/plugin install think@newkayak12-claude-skills
/plugin uninstall think@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 아이디어 → 결정까지 전 과정 돌리기 | `deep-thinking-workflow` |
| 해법 모양이 아직 안 잡힌 걸 설계하기 | `brainstorming` |
| 애초에 맞는 문제를 풀고 있는지 점검 | `problem-reframer` |
| 물려받은 가정을 걷어내고 바닥부터 재구성 | `first-principles` |
| 내 계획을 가장 강한 반론으로 두들겨 맞기 | `devils-advocate` |
| 흩어진 노트를 쓰거나 발표할 수 있는 구조로 | `thought-organizer` |
| 토글·로딩·빈 화면 같은 UI 순간을 제대로 설계 | `microinteractions` |
| 연봉·계약·어려운 대화 준비 | `negotiation` |

## 스킬

### `deep-thinking-workflow`

진입점입니다. 네 단계 — 발산 → 분해 → 공격 → 수렴 — 로 다른 스킬 셋을 순서대로 몰고 마지막에
결정 매트릭스를 만듭니다:

| 단계 | 스킬 | 산출 | 건너뛸 때 |
|---|---|---|---|
| 1. 발산 | `brainstorming` | 테마별로 묶인 아이디어 10~20개 | 아이디어가 이미 있을 때 |
| 2. 분해 | `first-principles` | 근본 원인, 구성요소, 가정 목록 | 문제 범위가 이미 명확할 때 |
| 3. 공격 | `devils-advocate` | 가장 강한 반론 3개 + 핵심 취약점 | 판돈이 작거나 되돌릴 수 있을 때 |
| 4. 수렴 | (결정 프레임워크) | 가중치 결정 매트릭스, 추천, 확신도 | 남은 옵션이 하나뿐일 때 |

4단계는 살아남은 옵션 2~4개를 놓고 3~5개 기준에 가중치를 매겨 채점한 뒤, 추천안과 확신도, 그리고
"무엇이 바뀌면 결론이 뒤집히는지"를 말합니다. 중간부터 합류해도 됩니다 — 어느 단계인지 알려주면
거기서 시작합니다. 단순 사실 질문이나 이미 답을 아는 일에는 쓰지 마세요.

```
사내 결제 시스템을 직접 만들지 외부 PG를 쓸지 결정해야 해.
아이디어 발산부터 반론까지 다 돌리고 마지막에 비교표로 정리해줘.
```

### `brainstorming`

아이디어를 디자인으로 만듭니다. 발산과 수렴을 명시적으로 분리해서, 앞쪽은 양이 규칙이고 뒤쪽은
기준이 규칙입니다. 구현을 막는 게이트이기도 합니다 — 디자인 승인 전엔 코드·스캐폴딩·구현 스킬
호출 금지. "간단한" 프로젝트도 예외 아닙니다. 디자인 산출물은 다이어그램, 컴포넌트 설명, 데이터
모델 표, trade-off 비교까지. API 시그니처, 라이브러리 호출, 실행 가능한 pseudocode를 쓰고 있다면
이미 디자인을 벗어난 겁니다.

```
알림 시스템을 새로 만들어야 해. 이메일/푸시/인앱을 하나로 묶고 싶은데
어떤 구조가 가능한지 옵션부터 넓게 뽑아줘.
```

발산 도구(한 번에 1~2개): vanilla, constraint relaxation, SCAMPER, analogy/biomimicry,
opposite-of. 수렴은 적어둔 kill-criteria로만 합니다 — 제약 위반, 핵심 success criteria 미달, 통제
못 하는 의존성, 되돌릴 수 있는지, 팀이 실제로 운영 가능한지. 1개가 아니라 2~3개까지만 줄입니다.
승인 후엔 `write:writing-plans`로 넘기고 구현 스킬은 직접 부르지 않습니다.

### `problem-reframer`

풀기 전에 문제를 의심합니다. `brainstorming`이 *주어진 문제에 더 많은 해법*을 만든다면, 이건
*문제가 제대로 정의됐는지*를 묻습니다. 증상과 메커니즘을 분리하고("이 상태가 사라지면 끝나는가,
아니면 다른 모습으로 다시 나타나는가?"), 출력 전에 숨은 가정 표를 완성하는 필수 게이트를 거친 뒤,
7가지 재프레이밍 기법 중 2~3개만 적용합니다. 7개 전부는 쓰지 않습니다.

```
기능을 계속 내는데 리텐션이 안 움직여. 세 가지 접근을 다 해봤는데
전부 뭔가 어긋난 느낌이야. 문제 정의부터 다시 봐줘.
```

출력 형태:

```text
1. Stated problem (원문 그대로)
2. Symptom vs problem — 증상 / 메커니즘 가설 / 우리가 다룰 것
3. Hidden assumptions — | Assumption | Why it might be false | Confidence |
4. Reframed versions — 2-4개, 각 한 문장
5. Most promising reframe + why
6. Unlocking question — 답이 나오면 접근이 가장 크게 바뀔 단 하나의 질문
```

접근이 안 달라지는 reframe은 reframe이 아니라 같은 문제의 다른 표현입니다.

### `first-principles`

주장을 더 쪼갤 수 없는 사실까지 분해하고 거기서 다시 쌓습니다. 렌즈 셋으로 돌아갑니다. **A**
아리스토텔레스식 분해 — 물리·논리·검증된 데이터에 닿을 때까지 "왜?"를 계속 묻습니다. "원래 이렇게
해왔다"는 절대 first principle이 아닙니다. **B** 실전 재구성(Musk/Munger) — 원재료부터 다시 쌓고,
뒤집어 보고, 2차 효과를 따라가고, 기회비용을 이름으로 적습니다. **C** 종합과 공격 — A에서 살아남은
가정과 B가 새로 들여온 가정을 구분하고, 이 재구성이 틀리게 되는 조건을 명시합니다. 0~10점으로
스스로 채점하고 10점까지 뭐가 모자란지 말합니다. 새로운 상황이나 큰 베팅에 쓰세요. 일상적 결정엔
과합니다.

```
우리 배포가 왜 2주 걸려야 하는지 처음부터 다시 따져줘.
물리적으로 필수인 단계랑 관행으로 남은 단계를 분리하고 싶어.
```

### `devils-advocate`

어떤 입장에 대한 가장 강한 반론을 만듭니다. steel-man으로, 이 제안에만 해당하는 구체적 비판으로,
헤지 없이, 균형 잡지 않고. 기본 3개이며 각각 타입(`structural` / `assumption` / `execution` /
`timing`), severity, 그리고 실제 선례가 붙습니다 — 확실하지 않으면 선례를 지어내지 않고 "no clear
precedent — speculative concern"이라고 정직하게 적습니다. 가장 날카로운 반론은 대개 말하지 않은
가정을 정조준하므로, 숨은 가정 발굴이 먼저입니다.

```
모놀리식을 MSA로 쪼개자는 제안이야. 가장 강한 반론 세 개랑
그중 진짜 치명적인 게 뭔지 짚어줘.
```

출력 형태:

```text
Position / Steel-man
숨은 가정 1-3
반론 1..3 — [type] · severity · 선례 (또는 "no clear precedent")
[다중 페르소나 공격 — 아키텍처·조직·GTM·정책 결정일 때만, 2-3명]
핵심 취약점 — 가장 눈에 띄는 문제가 아니라 가장 깊은 구조적 결함
가역성 — reversible | one-way door
```

다중 페르소나 공격(CFO, on-call/SRE, 경쟁사, legal, 주니어, 고객)은 좁은 기술 결정에선 건너뜁니다
— "Redis vs Memcached"에 규제 시점 공격은 theater입니다. 개선안은 비판이 아니라 개선을 원한다고
할 때만 나옵니다.

### `thought-organizer`

흩어진 노트, 반쯤 만들어진 아이디어, 의식의 흐름을 받아 구조를 냅니다: 흡수 → 원자 추출 → 군집화
→ 우선순위 → 구조화 → 빈틈 노출 → 전달. 사용자의 의도를 보존하고 서사를 씌우지 않으며, 말하지
않은 아이디어를 더하지 않고, 모순과 미결 사항은 매끄럽게 덮지 않고 반드시 드러냅니다. 출력은 항상
구조부터 — 입력을 요약해서 되돌려주는 걸로 시작하지 않습니다.

```
독서 기록 앱 만들고 싶은데 생각이 산만해. 소셜 기능도 넣고 싶고
혼자 쓸 수도 있어야 하고. 아웃라인으로 정리해줘.
```

구조화 전에 출력 형태부터 고릅니다:

| 상황 | 기법 |
|---|---|
| 목표가 문서·에세이·발표 | Outline |
| "맵"이라고 했거나 위계가 없는 입력 | 텍스트 마인드맵 |
| 교차 링크가 있는 5개 이상 아이디어, 지식베이스 목적 | Zettelkasten 방식 링크 |
| 핵심 메시지만 필요할 때 | Core claim extraction |

### `microinteractions`

토글, 비밀번호 필드, 로딩 인디케이터, pull-to-refresh, 좋아요 버튼 같은 작은 제품 순간을 Dan
Saffer의 구조 — Trigger, Rules, Feedback, Loops & Modes — 에 signature moment와 축약을 더해
설계합니다. 모션을 설계하기 전에 trigger → feedback → rules를 먼저 정의하고, 애니메이션 길이는
행동의 체감 무게에 맞추며, 장식용 모션은 넣지 않습니다 — 모든 움직임은 상태 변화를 전달해야 합니다.
0~10점으로 채점하고 빠진 부분을 지목합니다.

```
파일 업로드 버튼이 눌러도 반응이 없는 것처럼 느껴져.
트리거부터 성공 피드백까지 어떻게 설계해야 할지 잡아줘.
```

영역마다 윤리 경계가 붙습니다 — 중요한 트리거를 보이는 대안 없이 제스처 뒤에 숨기지 않기, 가짜
프로그레스 바나 조작적 카운트다운 금지, opt-out을 점점 어렵게 만드는 적응형 루프 금지, 그리고
기능이 항상 즐거움보다 먼저.

### `negotiation`

Chris Voss의 tactical empathy 프레임워크를, 대화 중 즉흥이 아니라 대화 전에 준비하는 형태로 씁니다:
tactical empathy, mirroring, labeling, calibrated questions, accusation audit, "That's right",
Ackerman 협상, Black Swans. 들어가기 전에 BATNA를 정하고, black swan을 최소 두 개 준비하고, 포지션
대신 이해관계에 앵커하고, 첫 제안을 바닥으로 취급하지 않습니다. 이 항목들에 대해 0~10점으로 스스로
채점합니다.

```
연봉 협상을 앞두고 있어. 시장가보다 낮게 받고 있는 상황이고
매니저는 예산이 묶여 있다고 말해. 어떻게 접근해야 할지 준비해줘.
```

Ackerman 사다리: 목표의 65 %로 열고 85 % → 95 % → 100 %, 마지막은 딱 떨어지지 않는 정밀한 숫자에
비금전적 보너스를 붙입니다. 모든 기법에 윤리 경계가 있습니다 — 조작이 아니라 이해를 위한 공감,
사적 정보 착취가 아니라 양쪽 결과를 개선하기 위한 black swan.

## MCP

| 스킬 | Recommended | Optional |
|---|---|---|
| `deep-thinking-workflow` | think-tool, sequential-thinking | mcp-reasoner |
| `brainstorming` | — | think-tool, sequential-thinking, mcp-reasoner |
| `problem-reframer` | think-tool (가정 열거 필수 게이트) | sequential-thinking |
| `first-principles` | think-tool (Lens A, Lens C) | mcp-reasoner |
| `devils-advocate` | — | think-tool, mcp-reasoner, sequential-thinking |
| `thought-organizer` | think-tool (빈틈 노출) | sequential-thinking |
| `microinteractions` | — | think-tool |
| `negotiation` | think-tool (상대 동기 분석, black swan 탐색) | sequential-thinking |

Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.

## 이어지는 워크플로

- Step 1 전에, 질문 자체가 이상하게 느껴지면 `problem-reframer`.
- 결정이 나오면 `pm:pm-strategy-workflow`나 `develop:dev-quality-workflow`로 넘깁니다.
- `technique-write:design-review-writer`는 발산과 스트레스 테스트 결과를 리뷰 가능한 설계 문서로
  바꿔줍니다.
