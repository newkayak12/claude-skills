---
name: run
description: >-
  Use when executing decomposed goals through the persona team pipeline after
  harness:goals has produced goals.json. Triggers on: "execute goals", "run the
  team", "goal pipeline 돌려줘", "팀 실행해줘", "goal 실행해줘", "harness run",
  "팀 돌려줘". Consumes .claude/harness/goals.json (from harness:goals), runs
  gajae-pipeline.js via the Workflow tool (Planner/Critic/Executor/Verifier),
  and records pass/fail status back to goals-state.py.
scenarios:
  - "goal 실행해줘 — goals.json 이미 만들었어"
  - "팀 돌려줘, Planner/Critic/Executor/Verifier 다 써서"
  - "Execute goals — run the full persona team pipeline"
  - "Run the team against goals.json and report any failures"
compatibility:
  optional:
    - think-tool          # Verifier가 pass/fail 판정을 정제할 때
    - sequential-thinking # Planner→Critic→Executor→Verifier 루프를 단계별로 밟을 때
related:
  - goals
  - interview
---

# Harness Run — Workflow Goal Execution + Failure Reporting

목표: `.claude/harness/goals.json`의 pending goal을 **Planner/Critic/Executor/Verifier** 페르소나 팀 파이프라인으로 **배치(batch) 실행**하고, 결과를 `goals-state.py`에 기록한다. 파이프라인은 모든 pending goal을 실행한 뒤 results 배열을 반환한다. 반환 후 `passed=false`인 goal이 하나라도 있으면 blocker를 사용자에게 명시적으로 보고하고 다음 액션으로 진행하지 않는다 — 절대 silent 진행하지 않는다.

## Preconditions

1. `.claude/harness/goals.json`이 존재해야 한다. 없으면 STOP하고 `harness:goals`부터 실행한다.
2. `harness/scripts/goals-state.py`와 `harness/scripts/workflow-templates/gajae-pipeline.js`가 있어야 한다.
3. 코드 파일을 편집하지 않는다 — Executor가 작업하더라도 이 skill은 orchestration만 담당한다.

> **검증 필요 (P1 caveat)**: 서브에이전트(Executor, Verifier)가 `Skill` 도구를 통해 `think:devils-advocate` / `completion:verification-before-completion`을 직접 호출할 수 있는지는 **현재 미확인**이다. 실행 전에 반드시 확인하고, 불가능한 경우 인라인 페르소나 로직으로 대체한다.

## Process

### Step 1 — Pending goals 확인

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/goals-state.py show
```

(`${CLAUDE_PLUGIN_ROOT}` = 이 플러그인 루트, Claude Code가 주입)

`status: "pending"`인 goal 목록을 추출한다. pending이 없으면 사용자에게 알리고 종료한다.

### Step 2 — Workflow 실행

`Workflow` 도구를 호출한다.

```json
{
  "scriptPath": "harness/scripts/workflow-templates/gajae-pipeline.js",
  "args": {
    "goals": [
      {
        "id": "G001",
        "title": "...",
        "acceptance_criteria": ["..."],
        "skill_hints": ["develop:clean-code"]
      }
    ],
    "root": ".claude/harness"
  }
}
```

`goals`는 `.claude/harness/goals.json`의 pending goal 목록에서 추출한 **객체 배열**이다. 각 객체는 반드시 `id`, `title`, `acceptance_criteria`, `skill_hints` 네 필드를 포함해야 한다. **`acceptance_criteria`는 필수** — Verifier가 이 기준 없이는 layer (a) pass/fail 판정을 내릴 수 없다.

파이프라인은 `for (const goal of args.goals)` 루프로 **모든** pending goal을 순차 실행하고, 각 goal의 결과를 `[{id, passed, attempts, blocker}]` 형태의 results 배열로 반환한다. 단일 goal의 실패는 그 goal의 재시도 루프만 종료하며, 다음 goal 실행은 계속된다.

**파이프라인 구조 (goal당 1회 루프, 최대 3회 재시도):**

| 단계 | 페르소나 | 역할 |
|---|---|---|
| 1 | Planner | goal을 task slice로 분해, 실행 순서 결정 |
| 2 | Critic | Planner 산출물 검토 — 누락·순서 오류·검증 불가 기준 지적 |
| 3 | Executor | 승인된 task slice 실행 |
| 4 | Verifier | `acceptance_criteria` 기준으로 pass/fail 판정 |

**격리 모드**: context-only (Agent). worktree 격리는 사용하지 않는다.

**3-layer verification**: (1) Critic이 Planner 검토, (2) Verifier가 Executor 결과 검토, (3) `goals-state.py` 상태 기록이 외부 체크포인트 역할. 3단계 중 하나라도 실패 신호를 내면 해당 goal은 `failed`로 기록된다.

**3-attempt cap**: 단일 goal 실행이 3회 시도 후에도 `passed=false`면 재시도 없이 즉시 실패로 확정한다.

### Step 3 — 상태 기록 + 아티팩트 저장

각 goal의 실행 결과에 대해:

```bash
# 성공
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/goals-state.py set-status \
  --id <goal_id> --status passed

# 실패
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/goals-state.py set-status \
  --id <goal_id> --status failed --reason "<blocker summary>"
```

아티팩트는 `goals-state.py scaffold-cycle`을 통해 `.claude/harness/cycles/<goal_id>/`에 기록한다.

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/goals-state.py scaffold-cycle \
  --root .claude/harness --id <goal-id>
```

### Step 4 — 실패 보고 (필수)

Workflow는 모든 pending goal을 실행한 뒤 results 배열 `[{id, passed, attempts, blocker}]`을 반환한다. 반환 후:

1. results를 순회하여 `passed=false`인 goal을 **모두** 찾는다.
2. `passed=false` goal이 하나라도 있으면 — **각 goal의 `blocker`를 사용자에게 명시적으로 보고한다.** (아래 Output Template 참조)
3. 보고 후 **다음 액션/페이즈로 진행하지 않는다** — 성공 선언, run 완료 처리, 후속 단계 제안 등을 하지 않는다. 사용자로부터 재시도·수정·skip 지시를 받는다.
4. `passed=false`가 없을 때에만 run 완료를 선언하고 다음 단계를 제안한다.

> **규칙**: 실패를 **silent**하게 넘기는 것은 금지다 (spec §6). "silent continue 금지"는 배치 실행 중 개별 goal 실패로 다음 goal로 넘어가지 말라는 뜻이 아니라, 파이프라인이 반환된 뒤 실패 결과를 감추고 다음 액션으로 나아가는 것을 금지하는 규칙이다.

## Output Template

실행 완료 후 사용자에게 보여주는 요약:

```
## Run Summary

| Goal ID | Title | Status | Attempts |
|---------|-------|--------|----------|
| G1      | ...   | passed | 1        |
| G2      | ...   | failed | 3        |

### Failures

**G2 — <title>**
Blocker: <what specifically blocked Verifier from passing this goal>
Next: <suggested fix or clarification needed>
```

## What Claude Does

- `goals-state.py show`로 pending goal을 확인하고 Workflow에 전달한다.
- `gajae-pipeline.js`를 `scriptPath`로 지정하여 Workflow를 호출한다.
- Planner → Critic → Executor → Verifier 루프를 goal당 최대 3회 시도한다.
- 3-layer verification (Critic / Verifier / goals-state 기록)을 모두 통과해야 `passed`로 기록한다.
- `set-status`로 결과를 저장하고 `scaffold-cycle`로 아티팩트를 기록한다.
- Workflow 반환 후 results를 검사하여 `passed=false` goal 전체의 blocker를 사용자에게 보고한다 — silent 진행은 없다.

## What You Do

- `harness:goals`로 `goals.json`을 먼저 만든다.
- 실행 전 P1 caveat (서브에이전트 Skill 호출 가능 여부)를 확인한다.
- 실패 보고를 받으면 blocker를 검토하고 재시도·수정·skip 여부를 결정한다.
- 전체 완료 후 Run Summary를 검토하고 다음 단계(`harness:review` 등)로 진행한다.

## Related Skills

- `harness:goals` — 이 skill이 소비하는 `goals.json`을 생성한다
- `harness:interview` — goals보다 먼저 spec을 캡처한다
- `harness:review` — run 완료 후 결과를 검토한다
- `think:devils-advocate` — Critic 페르소나 역할 (서브에이전트 Skill 호출 가능 여부 검증 필요)
- `completion:verification-before-completion` — Verifier 페르소나 역할 (동일 caveat)
