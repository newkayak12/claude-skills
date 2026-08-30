# agents

**English** · [한국어](#한국어)

Skills for handing work to other agents instead of doing it all in one context. The three cover
the sequence that multi-agent work actually follows: cut a large, vague task into subtasks with
clear boundaries and ready-to-paste prompts; fan independent jobs out concurrently, each on the
persona it calls for; or walk a written plan task by task with a fresh subagent per task and a
two-stage review after each. What they share is a stance — an agent only succeeds when its scope,
inputs, constraints, and output shape are stated up front, and its "done" is settled by evidence
rather than its own summary.

## Install & Uninstall

```bash
/plugin install agents@newkayak12-claude-skills
/plugin uninstall agents@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Split one big or fuzzy task into agent-ready subtasks with written prompts | `agent-task-decomposer` |
| Run several unrelated jobs at once, each on a matching specialist | `dispatching-parallel-agents` |
| Execute a plan task by task, fresh subagent + review each time | `subagent-driven-development` |

## Skills

### `agent-task-decomposer`

Turns a task that is too large or too vague for one agent into bounded subtasks, then writes the
prompt for each. It maps the full task, cuts along a real seam (domain, artifact, phase, or
component), draws the dependency graph, isolates the context each subtask needs, and only then
writes prompts. It refuses to decompose an ambiguous task — it asks one focused question first,
because a precise decomposition of a fuzzy goal produces precise confusion.

```
This "add team workspaces" feature is too big to hand to one agent. Break it into
subtasks with dependencies mapped, and write the prompt for each one.
```

Every generated prompt carries five elements — concrete goal, explicit inputs, hard constraints,
output format, verification step — and the decomposition is emitted as:

```
## Task Overview
## Dependency Graph
## Subtask N: [Name]
**Runs:** [immediately / after Subtask X completes]
**Input:** …  **Output:** …
### Optimized Prompt
```

Granularity guide: a 30-minute task is 1–2 subtasks, a half-day task 3–5, a multi-day task 5–10
with each half a day or less.

### `dispatching-parallel-agents`

A job allocator for 2+ independent jobs: it fans them out concurrently and mounts the best-fit
persona on each — SQL work to a database optimizer, a flaky test to a flaky-test analyst, a UI bug
to a frontend agent, no clean match to general-purpose. Not for related jobs where fixing one may
fix another, jobs that need full system state to understand, or agents that would edit the same
files — investigate those together instead. It is horizontal fan-out of unrelated jobs, the
opposite axis from the harness's fixed vertical stages over one goal.

```
Three separate things are broken: a p99 regression on GET /orders, the cart badge not
updating after remove, and agent-tool-abort.test.ts failing on timing. Different causes,
different files — dispatch them in parallel to matching specialists.
```

The gate: `0. INDEPENDENCE` (no shared files, no causal link) → `1. ALLOCATE` (job signal →
persona) → `2. DISPATCH` (isolated agents, in parallel) → `3. GATHER` (conflict check, full
re-run, verdict via `completion:verification-before-completion`). Persona matching is dynamic —
match on the job's dominant signal, not a fixed registry.

### `subagent-driven-development`

Executes an implementation plan in the current session: one fresh subagent per task, then a spec
compliance reviewer and a code quality reviewer dispatched in the same turn, with the task marked
done only when both pass in the same round. Use it when you have a plan, the tasks are mostly
independent, and you want to stay in this session; use `planning:executing-plans` when you need a
separately gated session, and manual execution when the tasks are tightly coupled or there is no
plan yet.

```
Here's the plan in docs/plans/workspace-invites.md. Run it task by task with a fresh
subagent each time and two-stage review, and don't move on until both reviewers pass.
```

Bundled prompt templates: `implementer-prompt.md`, `spec-reviewer-prompt.md`,
`code-quality-reviewer-prompt.md`. Implementers report one of four statuses, each handled
differently:

| Status | Handling |
|---|---|
| `DONE` | Proceed to review |
| `DONE_WITH_CONCERNS` | Read concerns; fix if they touch correctness or scope, else note and review |
| `NEEDS_CONTEXT` | Supply the missing information, re-dispatch the same prompt |
| `BLOCKED` | Change something — more context, stronger model, smaller task, or surface the plan gap. Never retry unchanged |

Re-review routing: spec issues → both reviewers re-run; spec already passed with quality issues
left → only the quality reviewer re-runs. Never start on `main`/`master` without consent, never
dispatch two implementers in parallel, never let a self-review stand in for a review.

**Harness-aware dual mode.** `subagent-driven-development` is written to run two ways: standalone
as above, and as an executor the harness's SetGoal stage can optionally map onto a subgoal
(`harness:harness` → "Optional skill integrations"). Nothing is pre-wired — the harness runs
without it, and it runs without the harness.

## Related plugins

- `planning:executing-plans` — gates a plan and routes it to one of these two executors.
- `completion:verification-before-completion` — settles every "done" claim with isolated evidence.
- `harness:harness` — fixed vertical stages over one goal; these skills are the horizontal axis.

---

# 한국어

[English](#agents) · **한국어**

한 컨텍스트에서 다 하지 않고 다른 에이전트에게 일을 넘기기 위한 스킬 모음입니다. 멀티 에이전트
작업이 실제로 밟는 순서를 셋으로 나눠 담았습니다 — 크고 모호한 작업을 경계가 분명한 subtask와
바로 붙여넣을 프롬프트로 자르기, 서로 무관한 작업들을 각자에 맞는 persona로 동시에 뿌리기, 작성된
계획을 태스크마다 새 서브에이전트 + 2단계 리뷰로 밟기. 공통 입장은 하나입니다 — 에이전트는 범위,
입력, 제약, 출력 형태가 미리 명시돼야 성공하고, "완료"는 자기 요약이 아니라 증거로 결정됩니다.

## 설치 / 제거

```bash
/plugin install agents@newkayak12-claude-skills
/plugin uninstall agents@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 크고 애매한 작업을 프롬프트까지 붙은 subtask로 쪼개기 | `agent-task-decomposer` |
| 서로 무관한 작업 여러 개를 각 전문가에게 동시에 | `dispatching-parallel-agents` |
| 계획을 태스크 단위로, 매번 새 서브에이전트 + 리뷰로 실행 | `subagent-driven-development` |

## 스킬

### `agent-task-decomposer`

에이전트 하나가 감당하기엔 너무 크거나 모호한 작업을 경계가 잡힌 subtask로 자르고, 각 subtask의
프롬프트까지 씁니다. 전체 작업 파악 → 실제 이음매(도메인·산출물·단계·컴포넌트)로 분할 → 의존성
그래프 → subtask별 컨텍스트 격리 → 그다음에야 프롬프트 작성 순서입니다. 모호한 작업은 분해하지
않고 먼저 질문을 하나 던집니다. 흐릿한 목표를 정밀하게 분해하면 정밀한 혼란만 나오니까요.

```
"팀 워크스페이스 추가" 기능이 에이전트 하나한테 넘기기엔 너무 커. 의존성까지 그려서
subtask로 나누고 각각 프롬프트도 써줘.
```

생성되는 프롬프트에는 항상 다섯 요소가 들어갑니다 — 구체적 목표, 명시적 입력, 강제 제약, 출력
형식, 검증 단계. 분해 결과 형식:

```
## Task Overview
## Dependency Graph
## Subtask N: [Name]
**Runs:** [즉시 / Subtask X 완료 후]
**Input:** …  **Output:** …
### Optimized Prompt
```

입도 기준: 30분짜리는 subtask 1–2개, 반나절짜리는 3–5개, 며칠짜리는 5–10개(각각 반나절 이하).

### `dispatching-parallel-agents`

독립적인 작업이 2개 이상일 때 쓰는 job 할당기입니다. 동시에 뿌리면서 각 작업에 맞는 persona를
얹습니다 — SQL은 database-optimizer, flaky 테스트는 flaky-test-analyzer, UI 버그는
frontend-developer, 맞는 게 없으면 general-purpose. 서로 연관된 작업(하나 고치면 다른 게 같이
고쳐질 수 있는), 전체 시스템 상태를 알아야 이해되는 작업, 같은 파일을 건드릴 작업엔 쓰지 마세요 —
그건 같이 조사해야 합니다. 이건 무관한 작업들의 수평 팬아웃이고, 하네스가 하나의 목표를 고정
단계로 세로로 미는 것과 정반대 축입니다.

```
따로 노는 문제 세 개야: GET /orders p99 회귀, 삭제 후 장바구니 배지 안 바뀜,
agent-tool-abort.test.ts 타이밍 실패. 원인도 파일도 달라 — 각 전문가한테 병렬로 던져줘.
```

게이트: `0. INDEPENDENCE`(공유 파일·인과 관계 없음 확인) → `1. ALLOCATE`(작업 신호 → persona) →
`2. DISPATCH`(격리된 에이전트, 병렬) → `3. GATHER`(충돌 확인, 전체 재실행, 최종 판정은
`completion:verification-before-completion`). persona 매칭은 고정 목록이 아니라 작업의 지배적
신호로 동적으로 합니다.

### `subagent-driven-development`

구현 계획을 현재 세션에서 실행합니다. 태스크마다 새 서브에이전트를 붙이고, 끝나면 spec 준수
리뷰어와 코드 품질 리뷰어를 같은 턴에 함께 띄우며, 둘 다 같은 라운드에서 통과해야 그 태스크가
완료입니다. 계획이 있고, 태스크가 대체로 독립적이고, 이 세션에 머물고 싶을 때 쓰세요. 별도로
게이트된 세션이 필요하면 `planning:executing-plans`를, 태스크가 강하게 얽혀 있거나 계획이 아직
없으면 수동 실행을 쓰세요.

```
docs/plans/workspace-invites.md에 계획 있어. 태스크마다 새 서브에이전트로 구현하고
2단계 리뷰 붙여서, 두 리뷰어 다 통과하기 전엔 다음으로 넘어가지 마.
```

동봉 프롬프트 템플릿: `implementer-prompt.md`, `spec-reviewer-prompt.md`,
`code-quality-reviewer-prompt.md`. 구현 에이전트는 네 가지 상태 중 하나를 보고하고, 각각 처리가
다릅니다:

| 상태 | 처리 |
|---|---|
| `DONE` | 리뷰로 진행 |
| `DONE_WITH_CONCERNS` | 우려부터 읽기 — 정확성·범위에 닿으면 먼저 수정, 단순 관찰이면 기록하고 리뷰 |
| `NEEDS_CONTEXT` | 빠진 정보를 채워 같은 프롬프트로 재투입 |
| `BLOCKED` | 뭔가를 바꿔야 함 — 컨텍스트 추가, 상위 모델, 태스크 분할, 또는 계획 결함을 사람에게. 그대로 재시도 금지 |

재리뷰 라우팅: spec 문제가 나오면 두 리뷰어를 다시, spec은 통과했고 품질 문제만 남았으면 품질
리뷰어만 다시. 동의 없이 `main`/`master`에서 시작하지 않고, 구현 에이전트를 병렬로 띄우지 않고,
자체 리뷰를 리뷰 대신 쓰지 않습니다.

**하네스 인지 듀얼 모드.** `subagent-driven-development`는 두 가지로 돌도록 쓰였습니다 — 위처럼
단독으로, 그리고 하네스 SetGoal 단계가 subgoal 실행자로 선택할 수 있는 executor로
(`harness:harness`의 "Optional skill integrations"). 사전 배선은 없습니다 — 하네스는 이것 없이도
돌고, 이 스킬도 하네스 없이 돕니다.

## 관련 플러그인

- `planning:executing-plans` — 계획을 게이트해서 위 두 실행자 중 하나로 라우팅.
- `completion:verification-before-completion` — 모든 "완료" 주장을 격리된 증거로 판정.
- `harness:harness` — 하나의 목표에 대한 고정 수직 단계. 이 스킬들은 수평 축.
