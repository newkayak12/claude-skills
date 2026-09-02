---
name: devils-advocate-back
description: >-
  Use when the user explicitly asks for `devils-advocate-back` — the pre-rewrite backup of
  devils-advocate, kept for side-by-side comparison. Never triggers on its own.
scenarios:
  - "MSA로 전환하자는 계획, 반론 세 가지 던져줘"
  - "이 설계의 약점이 뭔지 공격적으로 말해줘"
  - "Play devil's advocate on our go-to-market strategy"
  - "우리 제품 아이디어 왜 실패할 수 있는지 말해줘"
  - "이 결정에 반대하는 가장 강력한 주장이 뭐야?"
  - "Punch holes in this architecture proposal"
compatibility:
  optional:
    - think-tool        # pre-counterargument reasoning about assumptions and second-order effects
    - mcp-reasoner      # for systematically evaluating whether objections are genuinely strong
    - sequential-thinking  # for multi-step adversarial analysis
  remote_mcp_note: >-
    think-tool이 있으면 반론을 작성하기 전에 제안의 근본 가정과 2차 효과를 체계적으로 탐색할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - problem-reframer
  - brainstorming
---

# Devil's Advocate

Surface the strongest objections against a position, design, or decision — so it can be stress-tested before it's acted on.

The goal isn't to tear down ideas for sport. It's to find the genuine weaknesses before reality does. v2 강화 포인트: 숨은 가정 헌트(F), 선례 grounding(C), reversibility 프레임(E), 다중 페르소나 공격(B, 자동 트리거).

## Process

Steps 1, 2, 4, 6, 7은 항상 실행. Step 3은 MCP 도구 있을 때. Step 5는 자동 판단(아래 규칙). Step 8은 사용자 의도에 따라.

### Step 1: Establish the Position (and Steel-man It)

사용자가 분명한 입장을 안 밝혔다면 먼저 명료화한다. 공격 대상이 있어야 devil's advocate가 성립한다. 그리고 그것의 **가장 강한 버전**을 한 줄로 재진술하라 — 약화된 straw 버전을 공격하면 비판 자체가 무의미해진다.

```
Position: "[원 제안]"
Steel-man: "[이 제안이 작동할 수 있는 최선의 조건/맥락]"
```

### Step 2: Hunt Hidden Assumptions

명시되지 않은 전제 2-3개를 발굴한다. 제안은 항상 말로 한 것보다 깔린 가정이 더 많다. **가장 위험한 반론은 보통 이 숨은 가정을 정조준한다.** 이 가정들이 Step 4 반론과 Step 6 핵심 취약점의 재료가 된다.

```
숨은 가정 / Hidden Assumptions:
1. [unstated 전제 1]
2. [unstated 전제 2]
3. [unstated 전제 3]
```

### Step 3: Reason Before Writing (MCP)

`think-tool` 또는 `mcp-reasoner`가 있다면 반론을 쓰기 전에 호출하라. 2차 효과, 선례 실패 패턴, 가장 큰 피해자를 체계적으로 탐색하면 일반적 비판이 아닌 날카로운 반론이 나온다.

### Step 4: Generate Counterarguments

**기본 3개**, 사용자가 다르게 지정하지 않는 한. 각 반론은:

- **Steel-man** — 객관적으로 가장 강한 형태
- **Specific** — 이 제안에 한정된 비판, 일반론 금지
- **Why it's a real problem** — 가능성이 아니라 왜 진짜 문제인지

각 반론에 라벨:
- **Type**: `[structural]` / `[assumption]` / `[execution]` / `[timing]`
- **Severity**: `low` / `medium` / `high` / `critical`
- **Precedent**: 이 반론이 닮은 실제 실패 패턴 한 줄. 구체적으로 ("classic distributed monolith" / "Quibi가 이래서 망했다 — 단편 콘텐츠가 제작비를 정당화 못 함" / "Google+ — 진짜 수요 없이 만든 플랫폼"). 명확한 선례가 없으면 **선례를 지어내지 말고** "no clear precedent — speculative concern"이라고 정직하게 표기.

```
반론 1 / Counterargument 1: [짧은 제목] [type] · severity: X
[2-4문장. 가장 강한 형태로.]
선례 / Precedent: [실제 실패 패턴 한 줄, 또는 "no clear precedent — speculative concern"]

반론 2 / Counterargument 2: ...
```

(사용자가 한국어로 썼으면 한국어 라벨, 영어로 썼으면 영어 라벨.)

### Step 5: Multi-Perspective Attack (auto-trigger)

**언제 켤지** — 제안이 여러 stakeholder/도메인에 걸쳐 있을 때만:
- 아키텍처 전환, 조직 변화, GTM/사업 결정, 정책/규제 영향, 제품 전략 → **켠다**
- 좁은 기술 결정 (Redis vs Memcached, lib 선택, 함수 네이밍) → **스킵**. 이런 결정에 CFO/규제 시점 공격은 theater다.

켜기로 했다면, 제안 성격에 맞는 페르소나 **2-3개만** 골라 한 단락씩:

- **CFO/재무**: 위험조정 ROI 관점에서 무엇이 안 맞는가
- **On-call/SRE**: 새벽 3시에 무엇이 터지는가, MTTR은 어떻게 되는가
- **경쟁사**: 이걸 어떻게 역이용할 수 있는가
- **규제/Legal/Compliance**: 어떤 규칙을 위반하거나 회색지대로 들어가는가
- **주니어/신입**: 첫날에 무엇이 혼란스럽거나 위험한가
- **고객/사용자**: 이 변화로 무엇을 잃거나 강요당하는가

전 페르소나 동원 금지 — 핵심 2-3개만.

```
[페르소나 1]: [한 단락 공격]
[페르소나 2]: [한 단락 공격]
```

### Step 6: Expose the Core Weakness

반론들 뒤에 **단 하나의 가장 위험한 약점**을 지적한다. 가장 눈에 띄는 문제가 아니라 **가장 깊은 구조적 결함**. 종종 이건 Step 2의 숨은 가정 중 하나가 무기화된 형태다.

```
핵심 취약점 / Core Vulnerability:
[한 단락. 왜 이게 다른 반론들보다 본질에 가까운지.]
```

### Step 7: Reversibility Frame

한 줄로 의사결정의 비가역성을 캘리브레이션한다. 이건 반론을 무력화하는 게 아니다 — 반론의 **무게**를 결과의 비가역성과 맞추는 것이다.

```
가역성 / Reversibility: [reversible | one-way door]
[한 줄: 왜 그렇게 보는가. one-way door라면 critical 반론은 진입 전에 반드시 해결해야 한다. reversible이라면 빠르게 시도하고 학습하는 게 더 나은 길일 수 있다.]
```

### Step 8: Path Forward (사용자가 개선을 원할 때만)

사용자가 비판만 원하면 통째로 스킵. 개선을 원하는 신호가 있을 때만, 각 `high`/`critical` 반론에 대해 "이 반론이 해소되려면 무엇이 참이어야 하는가?"를 한 줄씩.

## Anti-patterns to Avoid

**헤지하지 마라.** "Some might argue that..." 같은 표현은 반론의 힘을 뺀다. 직접 진술하라.

**Balance 하지 마라.** "But on the other hand..."는 균형 잡힌 토론이지 devil's advocate가 아니다. 찬성 이유는 사용자가 이미 안다. 네 일은 반대 이유를 최대한 강하게 말하는 것이다.

**숫자 채우려고 약한 반론 만들지 마라.** 진짜로 강한 반론이 2개뿐이면 2개라고 말해라. 질이 양을 이긴다.

**선례를 조작하지 마라.** "이건 X 회사 망한 이유와 똑같다" — 진짜 그럴 때만. 확신 없으면 "no clear precedent — speculative concern"이라고 적고 그것이 가설임을 명시하라. 가짜 선례는 비판 전체의 신뢰를 깎는다.

**좁은 결정에 다중 페르소나 안 한다.** "Redis vs Memcached"에 CFO/규제 시점 공격은 theater. Step 5 스킵.

**가정을 reframe하지 말고 그대로 노출하라.** Step 2에서 숨은 가정을 발견했으면, 너의 해석으로 부드럽게 만들지 말고 가정 자체를 그대로 적어라.

**예의 때문에 정확성을 희생하지 마라.** 설계에 근본적 결함이 있으면 그렇게 말하라.

## Example Output Shape

```
Position: "우리 서비스는 MSA로 전환해야 한다"
Steel-man: 도메인 경계가 명확히 분리 가능하고, 팀이 독립 배포 사이클을 원하며, 모놀리식 배포가 실제로 입증된 병목인 상황.

숨은 가정:
1. 우리 도메인 경계가 이미 분명히 보인다
2. 현재 팀이 운영 복잡도를 흡수할 역량이 있다
3. MSA의 비용보다 모놀리식의 비용이 더 크다

반론 1: 운영 복잡성이 현재 팀 역량을 초과한다 [execution] · severity: high
단일 서비스도 안정 운영이 안 되는 상태에서 MSA는 서비스 간 통신 장애, 분산 트랜잭션, 독립 배포 파이프라인을 동시에 떠안는다. 복잡성은 곱셈으로 증가한다.
선례: Segment가 2018년 MSA에서 모놀리식으로 되돌렸다 — 운영 부담이 가치를 초과했다.

반론 2: 분리 경계가 명확하지 않다 [structural] · severity: critical
도메인 경계가 정의되지 않은 채 MSA로 가면 서비스 간 결합도가 오히려 더 높아진다. 가정 1이 깨진다.
선례: distributed monolith 패턴 — 거의 모든 조기 MSA 전환이 이걸 겪는다.

반론 3: 전환 비용 대비 현재의 실제 문제가 불분명하다 [assumption] · severity: medium
모놀리식의 어떤 구체적 한계가 지금 우리를 막고 있는가? 배포 주기? 팀 독립성? 둘 다 MSA 없이 해결될 수 있다.
선례: no clear precedent — speculative until concrete bottlenecks are named.

[다중 페르소나 — 아키텍처 전환은 cross-functional]
On-call: 분산 트랜잭션 실패 시 새벽 3시에 5개 서비스 로그를 동시에 읽어야 한다. 단일 서비스 인시던트 MTTR도 이미 길다.
CFO: 인프라 비용 2-3배, SRE 채용/도구 학습 추가. 모놀리식 한계가 이 비용을 정당화한다는 데이터가 없다.
주니어: 새 멤버가 한 기능을 추가하려면 3-4개 서비스를 동시에 이해해야 한다. 온보딩 시간이 길어진다.

핵심 취약점: 전환 자체가 목적이 되었다
MSA는 특정 규모와 팀 구조에서 효과적인 수단이지 목표가 아니다. 현 논의에서 "왜 지금"에 대한 답이 없다 — 가정 3을 정면으로 친다.

가역성: one-way door
한 번 분할한 시스템을 다시 모놀리식으로 합치는 비용은 분할보다 더 크다. critical 반론은 진입 전에 해결해야 한다.
```

이건 모양이지 그대로 베끼는 템플릿이 아니다. 실제 내용에 맞춰 적응하라. 좁은 기술 결정이면 Step 2와 Step 5는 압축하거나 스킵 — overhead가 가치보다 클 때는 정직하게 줄여라.

## Related Skills

- `problem-reframer` — 반론이 모두 표면적 문제만 지적한다면, 문제 정의 자체가 틀렸을 수 있을 때
- `brainstorming` — 반론으로 기존 방향이 무너졌고 새 아이디어를 처음부터 탐색해야 할 때
