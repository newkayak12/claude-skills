# Retrospective — phase-guard and feedback capture

> 2026-06-05 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **이전 사이클(#013)이 만든 "문서 게이트"를 이번에 hook으로 승격**: cycle/SKILL Step 6의 collaborative 게이트는 *글*이었다 — 정확히 하네스가 "주입≠강제, soft는 안 따름"이라 배운 그 패턴. phase-guard로 R-PG01을 물리 차단으로. 하네스의 자기교정 루프가 작동(글로 막았다가 → hook으로 못박음).
- **feedback capture가 phase-guard의 첫 소비자**: 두 작업을 한 사이클로 묶으니 feedbacklib이 추상적 인프라가 아니라 *실제 호출처*를 갖고 태어났다. lib을 단독으로 만들었으면 vacuous했을 것.
- **fail-soft ≠ fail-open**: feedbacklib(기록 실패해도 본업 유지=fail-soft)과 phase-guard(판정 불가 시 통과=fail-open)는 다른 개념. 한 hook 안에 둘 다 — 기록은 soft, 차단은 open.

## 놀란 것 (예측 vs 실제)

- **전환 무결성의 근본 한계가 설계 중 드러남**: metrics.json은 session-counter가 갱신해야 해서 hypothesis-immutability 보호를 못 건다 → current_phase 직접편집 우회가 원리적으로 열려 있다. phase-advance는 "정당 경로"일 뿐 강제가 아니다. active-symlink-guard(mv 못 막음)와 동형. 정직하게 H3 kill-line·README 한계로 명시.
- **메타-dogfood 사각**: 이 사이클 자신의 current_phase는 analysis인 채로 구현했다. hook이 이 레포에 설치 안 됨(export 산출물) → phase-guard가 자기 자신을 차단하진 않았다. 시운전(실설치 발화)은 별도 필요.

## 다음에 바꿀 것

- **전환 무결성 강화** (H3 잔여): current_phase를 metrics.json에서 분리해 보호 가능한 별도 파일로? 또는 phase-guard가 metrics.json의 current_phase 변경 Edit도 감시? 후속 사이클.
- **phase-guard 실설치 시운전**: rule-inject/stage-inject처럼 실제 발화 확인(#012 시운전 패턴).
- **GP-5 복잡도 +3**(phase-guard hook·phase-advance script·feedbacklib lib). 은퇴 후보 지명 필요 — `active-cycle-verify`(탐지율 관측 후), `deploy-kill-check`(효과측정 후) 검토. ratchet 축 harness-mechanism-count 등재가 선행돼야 close가 강제.

## 인계 (살림 / 의심 / 버림)

- 살림: phase-guard(단계순서 물리게이트), phase-advance(인접전환+--force blackbox), feedbacklib(fail-soft 마찰기록, .claude/.feedback SSOT), test-phase-guard.sh(6+4+2 케이스 매트릭스).
- 의심: current_phase 직접편집 우회(전환 무결성), 메타-dogfood 미발화(실설치 시운전 전엔 vacuous 위험).
- 버림: 없음(추가만). 단 GP-5 복잡도 증가分은 다음 사이클에서 은퇴로 상쇄해야.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- 이 사이클을 analysis phase인 채로 implementation까지 진행(자기 phase-advance 미적용). hook이 자기 레포에 미설치라 차단은 안 됐지만, dogfood 정합성으로는 phase를 전진시키며 했어야. 다음 사이클부터 자기 current_phase도 관리.
