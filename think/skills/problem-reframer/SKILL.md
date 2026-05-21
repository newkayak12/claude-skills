---
name: problem-reframer
description: >-
  Use when solutions keep feeling wrong or shallow — when the problem itself may
  be mis-defined. Triggers on: "뭔가 잘못된 것 같아", "계속 이 문제가 반복돼", "다른 각도로 봐야 할 것
  같아", "wrong problem", "solutions feel off", "이 문제 자체가 맞는 건지", "증상만 자꾸 잡는 느낌".
scenarios:
  - "계속 해결하려는데 같은 문제가 반복돼"
  - "이 해결책들이 다 뭔가 어색한데, 내가 잘못된 걸 풀고 있는 건 아닐까?"
  - "We keep shipping features but the metric doesn't move"
  - "뭔가 근본적으로 잘못된 것 같은 느낌이 드는데"
  - "I've tried three approaches and none of them feel right"
  - "이 문제 자체를 다시 정의해야 할 것 같아"
compatibility:
  recommended:
    - think-tool        # required gate: assumption enumeration before reframing begins
  optional:
    - sequential-thinking  # for multi-step reframe sequences
  remote_mcp_note: >-
    think-tool이 있으면 숨겨진 가정을 체계적으로 열거하는 필수 게이트 단계를 수행할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - first-principles
  - decision-maker
  - devils-advocate
  - brainstorming
---

# Problem Reframer

문제를 풀기 전에 문제 자체를 의심한다. 다른 가정·다른 추상도·다른 stakeholder 시점에서 같은 상황이 어떻게 보이는지 본다. v2 강화: 문제vs증상 분리, 5 Whys ↔ 5 Hows 페어, ladder of abstraction, stakeholder 시점 구체화.

Brainstorming과 다른 점: brainstorming은 *주어진 문제에 더 많은 해법*을 만든다. 이 스킬은 *문제가 제대로 정의되었는지*를 묻는다.

## When to Use This vs. Brainstorming

| Situation | Use |
|-----------|-----|
| "I need more ideas for X" | brainstorming |
| "I keep trying things but nothing works" | problem-reframer |
| "What should I build?" | brainstorming |
| "Why does this keep being a problem?" | problem-reframer |
| "I have solutions but they all feel wrong" | problem-reframer |
| "Maybe I'm solving the wrong thing" | problem-reframer |

## Core Workflow

### Step 1 — Capture the Stated Problem

원문 그대로 적는다. 정리하지 마라. 사용자가 쓴 단어가 어디 묶여 있는지를 봐야 한다.

### Step 2 — Problem vs Symptom Diagnostic (NEW)

지금 사용자가 들고 온 것이 **문제인가 증상인가**? 둘은 다르다.

- **증상**: 관찰되는 현상 ("배포가 실패한다", "팀이 사기 떨어진다", "기능을 써도 retention이 안 오른다")
- **문제**: 증상을 만들어내는 메커니즘 ("CI가 신뢰할 수 없다", "1-on-1에서 진짜 얘기가 안 나온다", "사용자가 핵심 가치를 첫 세션에 못 본다")

질문: **이 상태가 사라지면 끝나는가, 아니면 다른 모습으로 다시 나타나는가?** 후자라면 증상이다. 증상에 해법을 만들면 두더지 잡기가 된다.

### Step 3 — Surface Hidden Assumptions (Required gate)

think-tool을 사용해 가정을 enumerate. 출력 시작 전에 이 표를 완성해야 한다.

| Assumption | Why it might be false | Confidence |
|---|---|---|
| [전제] | [틀릴 수 있는 이유] | high / medium / low |

가정이 안 보이면 reframe도 안 나온다. 이 단계 건너뛰지 마라.

### Step 4 — Apply Reframing Techniques

7개 중 **2-3개**를 골라 적용. 7개 전부 돌리면 redundant output이 된다. 세부 정의·예시는 `references/techniques.md`.

- **Assumption Reversal** — Step 3 가정을 뒤집어 본다
- **5 Whys ↔ 5 Hows pair** (NEW expanded) — 한 쌍으로 운용:
  - 5 Whys: "왜?"를 5번 — 풀 가치 있는 **문제의 층위**를 찾는다 (증상 → 진짜 문제)
  - 5 Hows: 그 층위에서 "어떻게?"를 5번 — 진짜 풀 수 있는 **개입의 층위**까지 내려간다
  - 둘은 짝이다. Why만 하면 추상적 깨달음, How만 하면 즉흥적 해결. 같이 써야 actionable한 재정의가 나온다
- **Ladder of Abstraction** (NEW) — 같은 문제를 위/아래로 옮긴다:
  - 한 칸 위: "이건 무엇의 한 사례인가?" (구체 → 범주)
  - 한 칸 아래: "구체적으로 어떤 케이스인가?" (범주 → 인스턴스)
  - 너무 위면 일반론, 너무 아래면 미시. 적절한 층위에서 다시 정의한다
- **Constraint Removal** — 가장 단단해 보이는 제약을 일시 제거하고 문제를 다시 본다. (해결이 아닌 문제 재정의용. 해법 단계 제약 완화는 brainstorming의 constraint relaxation을 사용)
- **Stakeholder Reframe** (NEW expanded) — 다음 시점 중 2-3개 골라 같은 상황을 진술해본다:
  - **사용자/고객**: 그들이 보는 problem statement는 무엇인가
  - **운영/지원**: 매일 이걸 다루는 사람이 보는 문제
  - **신입/외부인**: 처음 보는 사람에게 무엇이 이상한가
  - **CEO/경영진**: 사업 관점에서 진짜 문제는 무엇인가
  - **경쟁사**: 그들이 이 상황을 어떻게 묘사할까
  - **규제/legal**: 법·정책 시점에서 보이는 문제
  - 각 시점은 *다른 problem statement*를 만들어낸다. (이는 reframe — devils-advocate의 multi-persona는 *공격*이 목적)
- **Problem Inversion** — "이 문제를 확실히 못 풀게 만드려면?"을 답한 뒤 뒤집어 본다
- **Reframe the Goal** — 명시된 목표가 진짜 목표의 proxy인지 확인. "이걸 달성하면 진짜로 원하는 게 해결되는가?"

### Step 5 — Generate Reframed Problem Statements

2-4개의 다른 problem statement를 만든다. 각각 한 문장.

### Step 6 — Test the Reframes

각 reframe에 대해: "**만약 이게 진짜 문제라면, 내 접근이 어떻게 달라지는가?**" 답이 안 달라지면 그건 reframe이 아니라 같은 문제의 paraphrase다.

### Step 7 — Select or Synthesize

가장 큰 진전을 unlock하는 framing 선택, 또는 sharper 버전으로 합성.

## Output Format

```
1. Stated problem: [원문]

2. Symptom vs problem:
   증상: [관찰된 현상]
   메커니즘 가설: [증상을 만드는 것]
   → 우리가 다룰 것: [증상 / 문제 어느 쪽인지 명시]

3. Hidden assumptions:
   | Assumption | Why it might be false | Confidence |
   | ... | ... | ... |

4. Reframed versions:
   a. [reframe 1 — 한 문장]
   b. [reframe 2 — 한 문장]
   c. ...

5. Most promising reframe:
   [선택한 reframe]
   Why: [왜 이게 unlock하는가, 한 두 줄]

6. Unlocking question:
   [답이 나오면 접근이 가장 크게 바뀔 단 하나의 질문]
```

대화체로. academic하게 쓰지 마라. reframe은 통찰처럼 느껴져야지 jargon처럼 느껴지면 안 된다.

## Constraints

### MUST DO
- Step 3 가정 표 완성 후에야 출력 시작
- 원문을 먼저 그대로 재진술하고 reframe
- 여러 reframe 제시 — 하나는 부족
- reframing과 solving을 구분
- "이 문제를 풀어야 하는가?"를 적어도 한 번 묻는다
- domain-agnostic — 개인·조직·기술 문제에 같은 rigor

### MUST NOT DO
- Step 3 가정 표 게이트 skip
- reframing 끝나기 전에 solution으로 점프
- 원래 problem statement를 무시 — 왜 그 framing이 그럴듯했는지 인정
- 같은 문제의 다른 표현을 reframe이라 부르기
- 제약을 명시적으로 질문하지 않은 채 고정된 것으로 취급
- "more ideas"와 "better problem definition"을 혼동

## Concrete Examples

See `references/examples.md` for worked examples across software and non-software domains.

## Related Skills

- `first-principles` — 재프레이밍 후 근본 가정을 더 깊이 분해하고 바닥부터 재구성하고 싶을 때
- `decision-maker` — 새 문제 프레임이 나왔고 옵션 간 선택이 필요할 때
- `devils-advocate` — 재프레이밍한 새 방향에 강한 반론으로 검증하고 싶을 때. multi-persona *공격*이 필요하면 그쪽
- `brainstorming` — 문제 정의가 분명해진 뒤 해법을 발산해야 할 때. 제약 *완화*로 해법을 찾고 싶다면 그쪽의 constraint relaxation
- `bias-auditor` — reframing 결과 confidence가 높다면 점검
