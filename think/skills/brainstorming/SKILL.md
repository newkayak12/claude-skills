---
name: brainstorming
description: >-
  Use when something needs to be designed or built and the solution shape is
  unclear. Triggers on: "어떻게 만들지?", "기능 설계해줘", "아키텍처 잡아줘", "design this
  feature", "how should we build X?", "옵션 더 뽑아줘", "발산해줘". Always invoke before
  writing code.
scenarios:
  - "OAuth 로그인 기능 어떻게 설계해?"
  - "알림 시스템 새로 만들어야 하는데 어떻게 접근해?"
  - "We need to design a rate limiting system"
  - "새 CLI 툴 어떻게 구조 잡으면 좋을까?"
  - "How should I architect this new microservice?"
  - "대시보드 기능 추가하려는데 어디서부터 시작해?"
compatibility:
  optional:
    - think-tool        # surfaces trade-offs before presenting approaches
    - sequential-thinking  # for multi-step design sequences
    - mcp-reasoner      # for evaluating complex architectural alternatives
  remote_mcp_note: >-
    think-tool이 있으면 설계 옵션을 제시하기 전에 trade-off를 체계적으로 검토할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - decision-maker
  - problem-reframer
  - thought-organizer
  - bias-auditor
---

# Brainstorming Ideas Into Designs

아이디어를 디자인으로 만든다. **발산(divergent)**과 **수렴(convergent)**을 명시적으로 분리하고, 발산에는 양·수렴에는 기준이 작동하도록 한다. 코드 작성 전 반드시 invoke.

## The Gate

**디자인 승인 전에 코드·스캐폴딩·다른 구현 스킬 호출 금지.** "간단한" 프로젝트도 해당된다. 디자인 비용은 낮고 잘못 구현한 비용은 크다. 디자인은 짧아도 — 변경이 작다면 몇 문장이라도 — 존재해야 하고 사용자가 확인해야 한다.

디자인 산출물 OK: 아키텍처 다이어그램, 컴포넌트 설명, 데이터 모델 표, trade-off 비교, 자연어 흐름 설명.
디자인 산출물 NOT OK: 시그니처가 박힌 API 명령, 특정 라이브러리 호출, 실행 가능한 pseudocode, 정확한 명령 스키마 (예: `ZADD key score member` Lua까지). 이 줄을 쓰고 있으면 디자인을 벗어나 구현에 들어선 것 — 멈춰라.

요청이 simple해 보여도 *정확히 어떤 문제를 푸는가*는 물어볼 가치가 있다. 점검 안 된 가정이 "simple"에서 가장 많이 낭비를 만든다.

## Flow

```
1. Explore context → 2. Clarify → 3a. Diverge (양) → 3b. Converge (기준)
                                                              ↓
                              5. Implement via writing-plans ← 4. Present design + approval
```

### 1. Explore Context

질문 전에 프로젝트를 읽는다. 파일, 문서, 최근 커밋. 무엇이 이미 있는지 이해. 기존 코드베이스라면 따라야 할 패턴, 이번 변경에서 같이 손볼 만한 인접 문제 찾기.

요청이 여러 독립 서브시스템을 묶고 있으면("플랫폼 만들어줘 — 채팅, 결제, 분석, 파일 저장") 디테일 묻기 전에 먼저 그걸 flag — 분해가 먼저다. 각 sub-project가 자기 design cycle을 갖는다.

### 2. Clarify

한 번에 한 질문. 옵션이 분명할 땐 객관식 선호. 목적·제약·성공 기준·"done"의 모양에 집중. 답을 기다린 뒤 다음 질문.

### 3a. Diverge — Generate Options (NEW explicit split)

**규칙: 양 먼저, 비판 금지.** 발산 단계에서 옵션을 깎으면 다양성이 죽는다. 최소 3개, 가능하면 5개까지 띄운다. 그 중 일부는 "분명히 안 될 것 같은" 것까지 포함시켜라 — 안 될 옵션이 진짜 옵션의 윤곽을 드러낸다.

발산을 위한 도구 (한 번에 1-2개 적용):

- **Vanilla**: 가장 직관적인 첫 옵션
- **Constraint relaxation** (NEW): "만약 [가장 단단한 제약]이 없다면?" — 예산 무제한, 시간 무제한, 팀 무제한, 호환성 무관. 거기서 나오는 해법을 보고 진짜 제약을 다시 검토. (문제 자체를 재정의하려면 problem-reframer의 Constraint Removal로 — 여기는 해법 발산)
- **SCAMPER** (NEW): 기존 해법에 다음 조작을 시도. Substitute(치환) / Combine(결합) / Adapt(차용) / Modify(변형) / Put to other use(전용) / Eliminate(제거) / Reverse(역전)
- **Analogy / biomimicry** (NEW): "다른 도메인에서 유사 문제를 어떻게 풀었나?" 예: 큐 → 우체국, 캐시 → 도서관 대출, rate limiting → 고속도로 톨게이트. 자연계 패턴(개미 군집, 면역 시스템)도 유용
- **Opposite-of** (NEW): "정반대 접근은?" — push 대신 pull, 중앙집중 대신 분산, 동기 대신 비동기. 종종 nontrivial 옵션이 여기 숨어 있다

If `think-tool` is available, 발산 끝에 호출 — 놓친 trade-off를 surface한다.

### 3b. Converge — Narrow to 2-3 (NEW explicit split)

발산 다음에야 비판이 허용된다. 옵션을 깎되 **기준이 있어야 한다** — 직감만으론 confirmation bias로 흐른다.

**Kill-criteria (구체적으로 적어둘 것):**
- 제약 위반: 시간/예산/팀 역량 한계를 넘는가
- 핵심 success criteria 미달: 풀어야 할 문제를 정말 푸는가
- 의존성 X: 우리가 통제할 수 없는 외부 시스템·인력에 의존하는가
- Reversibility: one-way door인 경우 critical 리스크를 sufficiently 보상하는가
- Team fit: 우리 팀이 정말 운영할 수 있는가 (학습 곡선·on-call 부담 포함)

기준에 비춰 옵션을 줄여 2-3개. 너무 빨리 1개로 좁히지 마라 — trade-off가 보이는 게 디자인의 본질이다.

**Confidence가 높으면 bias 점검**: 한 옵션에 강하게 끌리면 `bias-auditor` 호출 — 확증편향이나 sunk cost가 작동 중일 수 있다.

### 4. Present Design

사용자가 옵션을 고르거나 수정하면 디자인을 제시. 복잡도에 맞춰 섹션 크기 조절 — 간단하면 몇 문장, 진짜 nuance 있는 부분은 자세히. 아키텍처·컴포넌트·데이터 흐름·에러 처리·테스트 커버.

큰 섹션마다 "이거 맞는지" 묻는다. 수정 준비.

발산이 빈약했다는 신호 (확인): 사용자가 "다른 옵션 없어?"를 묻거나, 제시한 모든 옵션이 어색하거나, 사용자가 처음 들어보는 도메인 메타포가 하나도 없다면 — 3a로 돌아가라.

### 5. After Approval

디자인 승인 후 `writing-plans` invoke해서 구현 계획 작성. 다른 스킬(frontend-developer, mcp-builder 등) 호출하지 마라 — brainstorming의 산출물은 plan이지 동작 코드가 아니다.

## When Approaches All Feel Off

3-4개 옵션을 띄웠는데 전부 어색하면, 문제가 옵션이 아니라 문제 정의에 있을 가능성. `problem-reframer`로 한 layer 위에서 문제를 다시 본다. 거기서 새 framing이 나오면 brainstorming Step 1로 복귀.

## Design Principles

**Isolation and clarity**: 시스템을 단일 목적·정의된 인터페이스·독립적으로 이해 가능한 단위로 분해. 각 unit: 무엇을 하는가, 어떻게 쓰는가, 무엇에 의존하는가? 작고 경계가 분명한 단위가 추론·수정에 유리.

**YAGNI**: 명시된 목표에 필요 없는 기능은 빼라. 가설적 미래 요구에 디자인하지 마라.

**Working in existing code**: 기존 패턴 따르기. 변경에 영향받는 코드에 문제가 있다면 (파일이 비대해졌거나, 의존성이 엉켰거나) — 좋은 개발자가 작업 중인 코드에 손대듯 — 디자인에 포함. 무관한 리팩토링 제안 금지.

## Visual Companion

브라우저 기반 컴패니언 — 목업·다이어그램·시각 옵션 제시용. 다가오는 질문이 시각 콘텐츠(레이아웃·아키텍처 다이어그램·목업)면 한 번 제안:

> "Some of what we're working on might be easier to show than describe — I can put together mockups and diagrams in a browser as we go. Still experimental and token-intensive. Want to try it? (Needs a local URL to be opened)"

**제안 자체가 단독 메시지여야 한다.** 응답을 기다린 뒤 진행. 거절되면 텍스트만.

수락 후에도 매 질문마다 결정: **이게 텍스트보다 시각이 더 명확한가?** 실제 시각 콘텐츠에 사용 — 와이어프레임·레이아웃 비교·아키텍처 다이어그램. 컨셉 질문·trade-off 리스트·스코프 결정은 텍스트로.

동의하면 `skills/brainstorming/visual-companion.md` 읽고 진행.

## Related Skills

- `decision-maker` — 여러 설계 옵션이 나왔고 최종 선택이 필요할 때
- `problem-reframer` — 모든 옵션이 어색하면 문제 정의 자체 점검. 제약을 *제거*해 문제를 재정의하려면 그쪽
- `thought-organizer` — 발산된 아이디어가 많아 구조화·우선순위가 필요할 때
- `bias-auditor` — 한 옵션에 강한 끌림이 있으면 confirmation bias 점검
- `devils-advocate` — 최종 디자인에 강한 반론으로 stress-test
