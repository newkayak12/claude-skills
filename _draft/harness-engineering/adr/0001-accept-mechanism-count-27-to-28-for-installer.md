# ADR-0001: 설치기(project-install.py) 도입을 위해 mechanism-count 27→28 회귀를 1회 수용한다

> MADR. close-cycle.py `--force` 의 필수 사유 기록 (#008 ratchet override).

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-06-06 |
| Deciders | newkayak12, Claude (Opus 4.8) |
| Related Design Doc | `.claude/.feedback/delivery-model-failure-20260606.md` (로컬) |
| Related ADRs | — (최초 ADR) |

---

## Context and Problem Statement

직전 사이클(#013c)에서 `harness-mechanism-count = 27 (lower_better)` 을 cross-cycle ratchet floor 에
잠갔다. 이번 사이클(20260606-project-local-install)은 P0 delivery 재설계로 **새 설치기
`project-install.py`** 를 추가한다 — 프로젝트 `.claude/` 로 하네스를 vendoring 해 per-project + ambient
governance 를 여는 핵심 메커니즘. 이로써 mechanism-count 가 27→28 이 되어 ratchet 이 close 를 회귀로 차단한다.
**이 정당한 신규 역량 추가를 ratchet 과 어떻게 화해시킬 것인가?**

## Decision Drivers

- delivery 재설계는 P0 — 다른 모든 작업에 선행(사용자 명시) ★★★
- "빼기 없는 더하기" 금지(CA-11/PF-11) — 메커니즘 증식은 부채 ★★★
- 은퇴 후보(deploy-kill-check)는 hooks.json 배선 제거를 동반 → 별도 사이클 risk 격리 필요
- 정직성 — 실제 count(28)를 floor 에 숨기지 않는다

## Considered Options

### Option 1: --force + ADR (이번 채택)
27→28 을 1회 명시 회귀로 수용하고 사유를 ADR 로 박는다. 은퇴는 별도 사이클.
**Pros**: delivery 즉시 진행; risk 격리(은퇴와 분리); blackbox 에 force 기록되어 추적 가능.
**Cons**: ratchet floor 는 best=27 로 남아(강제 회귀는 floor 를 올리지 못함) **은퇴 전까지 후속
사이클도 이 축에서 --force 가 필요**한 standing 부채; 축 lock 직후 --force 라 self-stamp 탈출구(NS-2 전례) 재사용.

### Option 2: deploy-kill-check 은퇴와 짝 (27 유지)
새 +1 과 동시에 효과 0 로 지목된 deploy-kill-check 을 은퇴 -1 → 27 유지, --force 불요.
**Pros**: ratchet 설계 의도(빼기 강제) 충족; standing 부채 없음.
**Cons**: hooks.json UserPromptSubmit 배선 제거 + 연쇄의존 해소를 이 사이클에 끌어들여 delivery 와 은퇴 두 risk 가 한 사이클에 섞임.

### Option 3: 기존 스크립트에 흡수 (새 파일 0)
project-install 로직을 user-rules-init.py 에 subcommand 로 흡수 → count 27 유지.
**Pros**: 새 메커니즘 0.
**Cons**: user-rules-init 이 'L1 온보딩 + 프로젝트 scaffold' 두 책임 → 응집도 저하, 단일책임 위반.

## Decision Outcome

**Chosen option**: "Option 1 — --force + ADR" (사용자 결정).

**Rationale**:
- P0 delivery 를 막지 않고 진행하면서, 은퇴의 배선-제거 risk 를 이번 delivery 사이클에서 분리.
- 28 을 B4 축 바로 *정직하게 선언* — floor 에 숨기지 않음. ratchet 이 의도대로 차단했고, override 는 blackbox 에 남는다.

### Positive Consequences
- delivery 재설계(P0) 즉시 진행.
- 새 count(28)가 기록으로 남아 다음 사이클의 은퇴 목표가 명확.

### Negative Consequences
- **standing 부채**: floor=27 고정 → deploy-kill-check 은퇴(27 복원)까지 이 축에서 후속 --force 필요.
- 축 lock 직후 --force = self-stamp 탈출구 재사용(무력화 통로 우려, NS-2 전례).
- **신규 발견(ratchetlib gap)**: lower_better 에서 *정당한 새 baseline 수용* 경로가 없다 — 강제 회귀가
  floor 를 올리지 못해 "수용된 증가"를 표현 불가. TODO 등재.

### Trade-offs (Tipping Points)
- 다음 사이클이 deploy-kill-check 은퇴로 27(또는 그 이하)을 복원하지 *않으면*, 이 축의 --force 가
  상시화되어 ratchet 이 이 축에서 사실상 무력화됨 → 그 시점에 ratchetlib "accept-new-baseline" 도입 재검토.

## Implementation Notes
- 후속 사이클: (a) deploy-kill-check 은퇴 → mechanism-count 27 복원, (b) ratchetlib 에 "수용된 baseline 상향"
  (force-close 시 floor 를 best 가 아니라 *수용값*으로 갱신하는 옵션) 도입 검토.

## References
- `.claude/.feedback/delivery-model-failure-20260606.md` — delivery 모델 실패 분석(원인)
- `.claude/.feedback/harness-roadmap-ultracode-workflow-20260606.md` — rank6(deploy-kill-check 은퇴) 선행 분석
