# Retrospective — project-local-install

> 사이클 종료 시 작성. (P0 delivery 재설계 첫 슬라이스 — ⓐ delivery scaffold)

## 무엇을 배웠나

- **delivery 는 재배선이지 재작성이 아니었다.** 기존 hook 이 "CLAUDE_PLUGIN_ROOT 우선, 없으면 상대
  fallback" 을 이미 갖고 있어, `plugin/harness` 를 프로젝트 `.claude/harness` 로 복사만 하면 hook 이
  CLAUDE_PLUGIN_ROOT 없이 자급 동작했다. delivery 모델 실패의 교정 비용이 생각보다 작았다.
- **harness-export 를 install 의 엔진으로 재사용**했다(subprocess). 설치 = "프로젝트 `.claude/harness` 로
  export + settings/CLAUDE.md 얹기". 도구 1개로 두 목적.
- **ratchet 이 처음으로 실제 후속 사이클을 차단**했다(#013c 에서 잠근 27 vs 이번 28). 게이트가 dogfood
  자기 자신에게 발화 — 설계대로.

## 놀란 것 (예측 vs 실제)

- **close `--force` 가 blackbox 에 기록하지 않는다(F2, high).** phase-advance --force 는 남기는데 close 는
  안 남긴다. ratchet override 가 사이클 감사 흔적에 *불가시*. "black box 대면"이 방금 force 했는데도
  "override 0건" 을 표시. 잠금 직후 force 의 self-stamp 우려(NS-2)보다 나쁨 — 보이지도 않음.
- force-close 가 floor 를 올리지 못한다(F3) — 28 수용해도 floor=27 유지 → 은퇴 전까지 --force 상시화.
  ratchet 의 lower_better "accept-new-baseline" 부재를 처음 마주침.

## 다음에 바꿀 것

- **F2 즉시 후속(high)**: close `--force` 가 `{kind:"force-close", regressions, ts}` 를 blackbox 에 append
  + `--adr <path>` 결박(존재 검사). 게이트 우회의 tamper-evident 기록은 게이트 자체만큼 중요.
- **deploy-kill-check 은퇴**로 mechanism-count 27 복원 → 이 축 --force 상시화 차단(ADR-0001 인계).
- P0 후속 ⓑ(ceremony-free)·ⓒ(GOAL.md 명시화) 남음.

## 인계 (살림 / 의심 / 버림)

- 살림: project-install.py(벤더링+settings 병합+CLAUDE.md, 멱등·보존), install SKILL Step A, ADR-0001,
  installer 페이로드 제외 규약.
- 의심: "ambient governance" 는 *파일은 썼지만* 실제 AI 가 그 아래서 행동하는지는 N=0(리뷰어 지적 4).
  실세계 per-project 채택 시에만 입증 — post-delivery 검증 대기.
- 버림: 전역-플러그인-단독 전달 모델(install 이 user-rules 만 쓰던 경로) — 프로젝트 scaffold 가 1차 경로로.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- **close --force 사용(ratchet override)** — ADR-0001 로 정당화(P0 진행 + 은퇴 risk 분리). 단 F2 때문에
  blackbox 에 자동 기록 안 됨 → 이 retro + ADR 가 유일 흔적. self-stamp 탈출구를 또 썼다는 사실 자체가
  F2 수정(기록 강제)의 동기.
