# planning — 한국어

[English](README.md) · **한국어**

계획은 있는데 아직 아무것도 실행되지 않은 시점을 위한 스킬 하나.
`executing-plans`는 구현 계획의 사전 점검 게이트입니다. 적대적으로 검토하고, 단계마다 관찰 가능한
통과 기준을 박고, 실행자에게 넘깁니다 — 자기가 단계를 실행하지는 않습니다. 계획의 전제에 대한
검증 안 된 가정 위에서는 앞으로 나가지 않습니다.

## 설치 / 제거

```bash
/plugin install planning@newkayak12-claude-skills
/plugin uninstall planning@newkayak12-claude-skills
```

> **trophy 함께 설치.** 이 버전부터 이 플러그인을 설치하거나 업데이트한 뒤 첫 대화형 세션에서, trophy가 없으면 [trophy](../trophy/KOR.md)(업적)를 user 범위로 한 번 설치합니다. 동의하기 전에는 아무것도 보내지 않으며, trophy를 지우면 다시 설치하지 않습니다. 미리 거부하려면: `mkdir -p ~/.claude/plugins/.newkayak12-trophy-ride.done`. `sh`가 필요합니다(sh가 없는 Windows는 해당 없음).

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 작성된 구현 계획이 멀쩡한지 보고 맞는 실행자에게 넘기기 | `executing-plans` |

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

핸드오프 라우팅: 단계를 의존성 순서의 레이어로 나눕니다. 한 레이어 안에서 독립적인 단계 →
`agents:dispatching-parallel-agents`, 순차·의존 단계 → `agents:subagent-driven-development`
(계획 순서대로). 다음 레이어는 이전 레이어의 모든 단계가 2단계 기준을 통과한 뒤에 시작합니다.
애매하면 기본은 순차입니다 — 병렬 오판이 순서대로 도는 것보다 비쌉니다. 각 단계의 완료 판정은
실행자의 말이 아니라 2단계에서 정한 기준에 대고 `completion:verification-before-completion`이
내립니다.

**하네스 인지 듀얼 모드.** 이 스킬은 두 가지로 돌도록 쓰였습니다 — 위처럼 단독으로, 그리고 하네스
SetGoal 단계가 subgoal 실행자로 선택할 수 있는 executor로 (`harness:harness`의 "Optional skill
integrations"). 스스로를 하네스의 *SetGoal + QualityGate* 를 한 세션으로 내린 것이라고 설명합니다
— 6단계 엔진은 수용 기준을 자동으로 도출하고 자동으로 게이트하지만, 여기서는 그 일을 넘기기 전에
손으로 합니다. 사전 배선은 없고, 양쪽 다 서로 없이도 돕니다.

## 관련 플러그인

- `write:plans` — `executing-plans`가 게이트할 계획을 만드는 쪽.
- `agents:*` — `executing-plans`가 넘기는 실행자들.
- `completion:verification-before-completion` — 각 단계를 기준에 대고 닫는 쪽.
