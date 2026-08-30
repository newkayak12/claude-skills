# planning

**English** · [한국어](#한국어)

Two skills for the moment a plan exists but nothing has been executed yet — at two very different
altitudes. `executing-plans` is the pre-flight gate on an implementation plan: review it as an
adversary, stamp an observable pass bar on every step, then route it to an executor without
running a single step itself. `roadmap-planning` works a quarter or two above that, turning
competing initiatives into a sequenced, stakeholder-ready roadmap. Both refuse to move forward on
an unexamined assumption — one about a plan's preconditions, the other about capacity and
dependencies.

## Install & Uninstall

```bash
/plugin install planning@newkayak12-claude-skills
/plugin uninstall planning@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Check a written implementation plan is sound and hand it to the right executor | `executing-plans` |
| Turn goals and competing initiatives into a sequenced quarterly roadmap | `roadmap-planning` |

## Skills

### `executing-plans`

The gate between a plan and its execution. It reads the plan in full, reviews it adversarially,
attaches a pass bar to each step, and routes the work — it never edits code itself. Reach for it
whenever a plan is about to be run, especially one written earlier or by someone else. Its iron
law: **no hand-off without a clean plan and a stated pass bar per step**.

```
docs/plans/billing-retry.md was written last week. Check it still holds against the
current code, set a pass bar per step, and hand it to whichever executor fits.
```

The gate is `0. LOAD → 1. REVIEW → 2. GATE → 3. HAND-OFF`. Three review defects block hand-off:

| Defect | Symptom | Action |
|---|---|---|
| Gap | Step N needs something no earlier step produces | STOP — the plan is incomplete |
| Ambiguity | You couldn't dispatch the step to a stranger without guessing | STOP — pin the intent first |
| Drift | The plan assumes a file, API, or schema that changed | STOP — the plan is stale |

Routing at hand-off: independent steps → `agents:dispatching-parallel-agents`; sequential or
dependent steps → `agents:subagent-driven-development`. Default when unsure is sequential — a
wrong parallel call costs more than running in order. Each step's done-verdict is settled against
its step-2 bar by `completion:verification-before-completion`, not the executor's word.

**Harness-aware dual mode.** This skill is written to run two ways: standalone as above, and as an
executor the harness's SetGoal stage can optionally map onto a subgoal (`harness:harness` →
"Optional skill integrations"). It describes itself as the harness *SetGoal + QualityGate* brought
down to a single session — where the six-stage engine derives acceptance criteria and gates on
them automatically, here you do it by hand before dispatch. Nothing is pre-wired; each side runs
without the other.

### `roadmap-planning`

A five-phase workflow, roughly 1–2 weeks of elapsed time with 45–90 minutes of active facilitation
a day, that turns business goals, customer problems, technical constraints, and stakeholder
requests into a sequenced roadmap and the deck that explains it. Use it for annual or quarterly
planning, after a strategy session, or to reframe a feature list as outcomes. Not for sprint
planning, not when the strategy itself is still unclear, and not when stakeholders are expecting
date commitments — address that expectation first.

```
15개 initiatives competing for Q2 across three teams. Build the roadmap: epic
hypotheses, RICE scoring, dependency-ordered quarters, and the exec deck.
```

| Phase | Days | Output |
|---|---|---|
| 1. Gather inputs | 1–2 | 3–5 business outcomes, 3–5 validated problems, tech investments, stakeholder requests |
| 2. Define initiatives | 3–4 | 10–15 epics with hypothesis, success metric, T-shirt effort |
| 3. Prioritize | 5 | Ranked backlog, top 10 epics |
| 4. Sequence | 6–7 | Now/Next/Later or quarterly roadmap, dependency map, capacity check |
| 5. Communicate | Week 2 | 30–45 min deck, stakeholder alignment, published roadmap v1.0 |

Standing mandates: always map dependencies between epics before sequencing; always separate
committed from aspirational; never build a roadmap without the team's real capacity constraints;
never sequence without stakeholder alignment on top-level outcomes. Supporting files:
`template.md` (fill-in structure), `examples/sample.md`, `references/roadmap-types.md`,
`references/anti-patterns.md`, and `agents/roadmap-coordinator.md` for guided facilitation.

## Related plugins

- `write:writing-plans` — produces the plan `executing-plans` gates.
- `agents:*` — the executors `executing-plans` routes to.
- `completion:verification-before-completion` — closes out each step against its bar.

---

# 한국어

[English](#planning) · **한국어**

계획은 있는데 아직 아무것도 실행되지 않은 시점을 위한 스킬 둘 — 다만 고도가 아주 다릅니다.
`executing-plans`는 구현 계획의 사전 점검 게이트입니다. 적대적으로 검토하고, 단계마다 관찰 가능한
통과 기준을 박고, 실행자에게 넘깁니다 — 자기가 단계를 실행하지는 않습니다. `roadmap-planning`은
그보다 한두 분기 위에서, 경쟁하는 이니셔티브들을 순서가 잡힌 이해관계자용 로드맵으로 바꿉니다.
둘 다 검증 안 된 가정 위에서 앞으로 나가지 않습니다 — 한쪽은 계획의 전제, 다른 쪽은 캐파와 의존성.

## 설치 / 제거

```bash
/plugin install planning@newkayak12-claude-skills
/plugin uninstall planning@newkayak12-claude-skills
```

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 작성된 구현 계획이 멀쩡한지 보고 맞는 실행자에게 넘기기 | `executing-plans` |
| 목표와 경쟁 이니셔티브를 순서 잡힌 분기 로드맵으로 | `roadmap-planning` |

## 스킬

### `executing-plans`

계획과 실행 사이의 게이트입니다. 계획을 통째로 읽고, 적대적으로 검토하고, 단계마다 통과 기준을
붙이고, 일을 라우팅합니다 — 코드를 직접 고치지는 않습니다. 계획을 막 돌리려는 시점, 특히 예전에
썼거나 남이 쓴 계획일 때 쓰세요. 철칙: **깨끗한 계획과 단계별 통과 기준 없이는 넘기지 않는다.**

```
docs/plans/billing-retry.md 지난주에 쓴 건데, 지금 코드 기준으로 아직 유효한지 보고
단계별 통과 기준 잡아서 맞는 실행자한테 넘겨줘.
```

게이트는 `0. LOAD → 1. REVIEW → 2. GATE → 3. HAND-OFF`. 다음 셋 중 하나라도 있으면 넘기지
않습니다:

| 결함 | 증상 | 조치 |
|---|---|---|
| Gap | N단계가 앞 단계에서 나오지 않는 산출물·결정을 필요로 함 | STOP — 계획이 불완전 |
| Ambiguity | 모르는 사람에게 그대로 넘길 수 없는 단계 | STOP — 의도부터 확정 |
| Drift | 계획이 전제한 파일·API·스키마가 이미 바뀜 | STOP — 계획이 낡음 |

핸드오프 라우팅: 독립적인 단계 → `agents:dispatching-parallel-agents`, 순차·의존 단계 →
`agents:subagent-driven-development`. 애매하면 기본은 순차입니다 — 병렬 오판이 순서대로 도는
것보다 비쌉니다. 각 단계의 완료 판정은 실행자의 말이 아니라 2단계에서 정한 기준에 대고
`completion:verification-before-completion`이 내립니다.

**하네스 인지 듀얼 모드.** 이 스킬은 두 가지로 돌도록 쓰였습니다 — 위처럼 단독으로, 그리고 하네스
SetGoal 단계가 subgoal 실행자로 선택할 수 있는 executor로 (`harness:harness`의 "Optional skill
integrations"). 스스로를 하네스의 *SetGoal + QualityGate* 를 한 세션으로 내린 것이라고 설명합니다
— 6단계 엔진은 수용 기준을 자동으로 도출하고 자동으로 게이트하지만, 여기서는 그 일을 넘기기 전에
손으로 합니다. 사전 배선은 없고, 양쪽 다 서로 없이도 돕니다.

### `roadmap-planning`

5단계 워크플로입니다. 총 1–2주, 하루 45–90분의 능동적 퍼실리테이션 기준으로, 비즈니스 목표·고객
문제·기술 제약·이해관계자 요청을 순서 잡힌 로드맵과 그것을 설명하는 덱으로 만듭니다. 연간/분기
계획, 전략 세션 직후, 피처 리스트를 outcome 중심으로 재구성할 때 쓰세요. 스프린트 계획엔 쓰지
말고, 전략 자체가 아직 불투명하면 쓰지 말고, 이해관계자가 날짜 확약을 기대하고 있으면 그 기대부터
정리하세요.

```
Q2에 세 팀 걸쳐 이니셔티브 15개가 경쟁 중이야. epic 가설, RICE 점수, 의존성 반영한
분기 배치, 임원 보고 덱까지 로드맵 만들어줘.
```

| Phase | 일자 | 산출물 |
|---|---|---|
| 1. 입력 수집 | 1–2일 | 비즈니스 outcome 3–5, 검증된 고객 문제 3–5, 기술 투자 항목, 이해관계자 요청 |
| 2. 이니셔티브 정의 | 3–4일 | 가설·성공지표·티셔츠 사이즈가 붙은 epic 10–15개 |
| 3. 우선순위 | 5일 | 랭킹된 백로그, 상위 10 epic |
| 4. 시퀀싱 | 6–7일 | Now/Next/Later 또는 분기 로드맵, 의존성 맵, 캐파 확인 |
| 5. 커뮤니케이션 | 2주차 | 30–45분 덱, 이해관계자 정렬, 로드맵 v1.0 공개 |

Standing mandates: 시퀀싱 전에 epic 간 의존성을 반드시 매핑한다, 확약 항목과 희망 항목을 반드시
구분한다, 팀의 실제 캐파 제약 없이 로드맵을 만들지 않는다, 최상위 outcome 우선순위에 대한
이해관계자 정렬 없이 순서를 잡지 않는다. 부속 파일: `template.md`(작성 양식),
`examples/sample.md`, `references/roadmap-types.md`, `references/anti-patterns.md`, 가이드형
진행에는 `agents/roadmap-coordinator.md`.

## 관련 플러그인

- `write:writing-plans` — `executing-plans`가 게이트할 계획을 만드는 쪽.
- `agents:*` — `executing-plans`가 넘기는 실행자들.
- `completion:verification-before-completion` — 각 단계를 기준에 대고 닫는 쪽.
