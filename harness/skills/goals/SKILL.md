---
name: goals
description: >-
  Use when decomposing a final goal into verifiable sub-goals before starting a
  harness cycle. Triggers on: "decompose this goal", "break into sub-goals",
  "create goals.json", "goal 분해", "sub-goal 나눠줘", "목표 쪼개줘", "acceptance
  criteria 만들어줘". Consumes .claude/harness/specs/<slug>.md (from
  harness:interview) and writes .claude/harness/goals.json that harness:run
  consumes.
scenarios:
  - "이 spec 보고 sub-goal로 분해해줘 — acceptance criteria도 같이"
  - "goal 분해부터 해줘, harness:run 전에"
  - "Decompose this goal into sub-goals with verifiable acceptance criteria"
  - "Break my interview spec into goals.json so harness:run can execute it"
compatibility:
  optional:
    - think-tool          # Planner가 acceptance_criteria를 정제할 때
    - sequential-thinking # Planner→Critic 루프를 단계별로 밟을 때
related:
  - interview
  - run
  - plan
---

# Harness Goals — Goal Decomposition + Critic Loop

목표: 최종 goal(spec)을 **검증 가능한 sub-goal 트리**로 분해하고, Critic 리뷰를 거쳐 `.claude/harness/goals.json`에 저장한다. 코드도, cycle도 시작하지 않는다.

> **Disambiguation**: `harness:goals` = decompose a final goal into sub-goals (this skill); `harness:plan` = write spec/design/plan files inside an active cycle (existing, unrelated). 목표 분해가 필요하면 이 skill을, active cycle 내부 계획 문서 작성이 필요하면 `harness:plan`을 사용한다.

## Preconditions

1. `.claude/harness/specs/<slug>.md` 가 존재해야 한다. 없으면 STOP하고 `harness:interview`부터 실행한다.
2. `goals-state.py` 가 `harness/scripts/` 에 있어야 한다.
3. 코드 파일을 편집하지 않는다.

## Process

### Step 1 — Planner: spec → sub-goals

spec을 읽고 sub-goal 목록을 초안으로 작성한다. 각 sub-goal에 반드시 두 필드를 포함한다.

- `acceptance_criteria` — 실행 전에 정의된, 관찰·측정 가능한 완료 기준 (사후 판단 금지)
- `skill_hints` — 아래 매핑 테이블을 참고하여 해당 goal 유형에 맞는 steered skill 목록

#### skill_hints Mapping Table

| Goal type | Steered skills |
|---|---|
| Feature development | `develop:clean-code`, `develop:test-driven-development`, `develop:pragmatic-programmer` |
| Architecture | `develop:architecture-designer`, `develop:domain-driven-design` |
| Technical writing | `write:writing-skills`, `write:doc-coauthoring` |
| DB / infra | `develop:database-optimizer`, `develop:dockerfile-optimizer` |
| Testing | `develop:test-master`, `develop:flaky-test-analyzer` |
| PM / strategy | `pm:prd-development`, `pm:feature-prioritization` |

Critic skill_hints: `think:devils-advocate`, `cognition:assumption-extractor`, `cognition:tradeoff-articulator`

Verifier skill_hints: `completion:verification-before-completion`, `write:writer-verification`, `think:devils-advocate`

### Step 2 — goals-state.py 실행

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/goals-state.py init --spec .claude/harness/specs/<slug>.md

# 각 sub-goal마다 반복
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/goals-state.py add-goal \
  --title "<goal title>" \
  --accept "<acceptance_criteria>" \
  --hint "<skill_hints comma-separated>"
```

### Step 3 — Critic Loop (cap = 3)

Critic 페르소나(`think:devils-advocate`)로 분해를 검토한다. **루프는 최대 3회.**

검토 항목:

1. **누락된 goal** — spec의 success criteria 중 커버되지 않는 항목이 있는가?
2. **순서 오류** — 의존성 역전이나 병렬화 불가 구조가 있는가?
3. **검증 불가 acceptance_criteria** — "잘 동작한다", "빠르다" 같은 모호한 기준이 있는가?

문제가 없으면 루프를 종료한다. 문제가 있으면 Planner에게 피드백을 넘기고 Step 1로 돌아간다. 3회 루프 후에도 미해결 항목이 남으면 사용자에게 알리고 승인을 받는다.

### Step 4 — Output

`goals.json` 이 `.claude/harness/goals.json` 에 생성된다 (schema: spec §5).

## Output Template

```json
{
  "spec": ".claude/harness/specs/<slug>.md",
  "goals": [
    {
      "id": "G1",
      "title": "<sub-goal title>",
      "acceptance_criteria": "<verifiable, pre-defined criterion>",
      "skill_hints": ["develop:clean-code", "develop:test-driven-development"],
      "status": "pending"
    }
  ],
  "critic_rounds": 0
}
```

## What Claude Does

- Planner 페르소나로 spec을 읽고 sub-goal 초안을 만든다.
- 각 goal에 `acceptance_criteria`(사전 정의, 검증 가능)와 `skill_hints`(매핑 테이블 참조)를 붙인다.
- `goals-state.py init` 및 `add-goal` 로 상태를 기록한다.
- Critic 페르소나로 분해를 검토하고 최대 3회 루프한다.
- 완료된 `goals.json` 경로를 사용자에게 알린다.
- 다음 단계(`harness:run`)를 제안한다.

## What You Do

- spec 파일 경로를 알려준다 (`harness:interview`가 출력한 경로).
- Critic이 제기한 미해결 항목이 있으면 3회 루프 후 최종 승인 여부를 결정한다.
- `goals.json` 을 검토하고 `harness:run` 에 넘길 준비가 됐는지 확인한다.

## Related Skills

- `harness:interview` — 이 skill이 소비하는 spec 파일을 생성한다
- `harness:run` — `goals.json` 을 소비하여 cycle을 실행한다
- `harness:plan` — active cycle 내부의 spec/design/plan 작성 (이 skill과 무관)
- `think:devils-advocate` — Critic 페르소나로 분해 검토 시 사용
