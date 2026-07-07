---
name: interview
description: >-
  Use when a goal is too vague to feed into harness:goals or harness:cycle.
  Triggers on: "clarify a vague goal", "spec capture interview", "help me figure
  out what I want to build", "인터뷰로 spec 잡아줘", "목표 명료화", "뭘 만들지 모르겠어".
  Runs a Socratic interview (one question at a time) and writes a spec file at
  .claude/harness/specs/<slug>.md that harness:goals consumes.
scenarios:
  - "인터뷰로 spec 잡아줘 — 뭘 만들지 아직 불분명해"
  - "목표 명료화부터 해줘, harness:goals 전에"
  - "Clarify my vague goal before we start a cycle"
  - "Run a spec capture interview — I have a rough idea but no clear success criteria"
compatibility:
  optional:
    - sequential-thinking # Socratic Q-sequence를 단계별로 밟을 때 유용
    - think-tool          # 모호한 success criteria를 검증 가능한 형태로 정제할 때
related:
  - cycle
  - goals
---

# Harness Interview — Socratic Spec Capture

목표: 모호한 최종 목표를 Socratic 대화로 구체화하여 `.claude/harness/specs/<slug>.md`에 기록한다. 코드도, cycle도 시작하지 않는다. 이 skill은 `harness:goals` / `harness:cycle`의 *전처리*다.

## When to Use

Goal이 다음 중 하나이면 이 skill을 먼저 실행한다.

- 문제·사용자·성공 기준 중 하나라도 문장으로 쓰지 못할 때
- "느낌은 있는데 뭘 만들지 모르겠어" 상태일 때
- Standalone spec 캡처가 필요할 때 (cycle 없이)

**Order**: interview → goals → cycle/run. 이미 goal이 명확하면 건너뛰고 `harness:goals`로 직행한다.

## Process

Planner 페르소나로 질문한다. **한 번에 질문 하나씩.** 답을 받은 뒤 다음 질문으로 넘긴다.

### Q-sequence (이 순서를 따른다)

1. **Problem** — "어떤 문제를 해결하려고 하나요? (형식: '사용자가 X를 할 수 없다')"
   - 해결책("Y를 만들고 싶다")으로 시작하면 문제 진술로 돌려보낸다.
2. **Persona** — "누구의 문제인가요? 구체적인 페르소나 하나를 묘사해주세요."
3. **Success criteria** — "이 문제가 해결됐다는 걸 어떻게 알 수 있나요? 측정·관찰 가능한 형태로 말해주세요."
4. **Constraints** — "시간·비용·기술·범위 등 알고 있는 제약이 있나요?"
5. **Open questions** — "아직 모르거나 결정 못한 게 있나요?"

### Stopping Rule ("clear enough" 기준)

다음 **세 조건이 모두 충족**될 때 인터뷰를 종료한다.

1. Problem, Persona, Success Criteria가 각각 **완전한 문장** 하나로 작성되어 있다.
2. Success Criteria가 **검증 가능한 형태**다 — 관찰·측정할 수 있는 지표 또는 행동이 명시되어 있다.
3. 사용자가 "**더 추가할 내용 없음**"을 확인한다.

조건이 충족되면 spec 초안을 보여주고 승인을 받은 뒤 파일에 저장한다. 조건이 충족되지 않으면 부족한 항목만 질문한다.

## Output Template

저장 위치: `.claude/harness/specs/<slug>.md` (`slug` = 목표를 kebab-case로 2–4 단어)

```markdown
# Spec: <goal title>

_captured: YYYY-MM-DD | status: draft_

## Problem

<한 문장: 사용자가 X를 할 수 없다>

## Persona

<구체적인 사용자 설명>

## Success Criteria

- [ ] <검증 가능한 기준 1>
- [ ] <검증 가능한 기준 2>

## Constraints

- <제약 항목>

## Open Questions

- <미결 사항>
```

파일 생성 후 경로를 사용자에게 알려준다. `harness:goals`에 이 경로를 전달하면 goals가 이 spec을 소비한다.

## What Claude Does

- Planner 페르소나로 Socratic 질문을 **하나씩** 던진다 — 한꺼번에 쏟아내지 않는다.
- "Y를 만들고 싶다" 형태의 입력을 문제 진술로 돌려보낸다.
- Stopping Rule 세 조건이 모두 충족될 때만 인터뷰를 종료한다.
- Spec 초안을 대화 중에 보여주고 사용자 승인을 받은 뒤 `.claude/harness/specs/<slug>.md`에 저장한다.
- 저장 후 다음 단계(`harness:goals` 또는 `harness:cycle`)를 제안한다.

## What You Do

- 질문마다 솔직하게 답한다 — 모르면 "모른다"고 말해도 된다 (open questions에 기록된다).
- Success Criteria가 측정 가능한지 직접 판단이 어려우면 AI에게 되물어본다.
- Spec 초안을 검토하고 수정·승인한다.

## Related Skills

- `harness:goals` — 승인된 spec을 소비하여 목표 트리를 생성한다
- `harness:cycle` — 목표가 확정된 뒤 사이클을 시작한다
- `think:decision-maker` — goal 선택이 여러 후보 사이에서 갈릴 때
