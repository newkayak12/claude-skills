# Retrospective — hypothesis-immutability-sensor

> 사이클 종료 시 작성. dev-tool / self-user 타입. 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로)

## 가설 결과

| 가설 | 결과 | 근거 |
|---|---|---|
| **H1** — hypotheses.jsonl 직접 편집 시도가 hook으로 차단되면 AP-06 물리적 방지 | **지지** | self-test T1·T3·T4 모두 exit2 차단. `CV-1` narrative→물리 전환의 첫 실제 조각 |
| **H2** — 정당한 우회(register)는 막히지 않음, false positive 0 | **지지** | T2(비대상 Edit) exit0, register/verify 정상. 정당 경로 무손상 |

## 무엇을 배웠나

- **첫 Computational Sensor가 실제로 작동한다.** #001까지는 Guide(게이트)뿐이었고 Sensor는 hash 등록(탐지)만. 이번에 *차단*하는 Sensor를 wiring — Böckeler Guide/Sensor 균형이 한 칸 채워짐.
- **PreToolUse의 한계**가 명확해짐 (F2): 도구 호출만 가로채므로 *세션 밖 편집*은 못 막는다. 즉 PreToolUse Sensor는 *완전*하지 않고, SessionStart verify 같은 *짝 Sensor*가 필요하다. 단일 hook으로 self-enforcement 완성 환상 금지.
- **fail-open 설계 결정** (F3): hook이 정당한 작업을 막는 게 더 큰 해악이라 입력 파싱 실패 시 통과시킴. self-enforcement 도구라도 *마찰을 최소화*해야 안 꺼진다 (#001 시나리오 2 교훈의 연장).

## 놀란 것 (예측 vs 실제)

- 예측: hook 입력 스키마가 단순 `file_path` 하나일 것
- 실제: 도구별로 키가 다름(notebook_path, edits[]). 단일 키 가정했으면 NotebookEdit/MultiEdit 변종이 새어나갔을 것 (F1). *테스트가 잡았다* — T3가 없었으면 놓쳤을 갭.

## 다음에 바꿀 것

- 새 hook 작성 시 *도구 스키마 변종*을 먼저 나열하고 테스트 케이스로 박는다 (T1~T5처럼).
- Sensor는 *짝으로* 설계 — PreToolUse(세션 내) + SessionStart/PostToolUse(세션 밖·사후). 하나로 완전하다고 가정 안 함.

## 인계 (살림 / 의심 / 버림)

- **살림**: `hypothesis-immutability.py`(작동하는 첫 Sensor), `hooks.json` wiring 패턴, plugin `hooks/` 구조, 도구 스키마 변종 테스트 습관
- **의심**: F2(세션 밖 편집 미방어) — SessionStart verify 없이는 구멍. H1 지지가 *부분적*임을 인지. fail-open(F3)의 우회 가능성
- **버림**: 없음

## 어긴 룰 / Anti-pattern (black box 대면)

`blackbox.jsonl` 비어 있음 — 이번 사이클 override/skip/강행 **0건**. invariant 위반 0건. 가설 chain 최종 verify intact (내가 가설을 손대지 않음 — 내가 만든 hook이 막을 행위를 나도 안 함).

## 다음 사이클 큐

1. **(F2)** SessionStart verify 짝 Sensor — active 사이클 가설 chain을 세션 시작 시 검증·경고
2. **(옵션 2)** deploy kill-check Sensor — metrics 자동 갱신과 묶어서
3. **(GOAL 앞단)** marketplace 등록 + `harness:install` 온보딩 + interactive user-rule(L1) — *설치해서 쓰는* 경로 (사용자가 (A) 내부 견고화 우선 선택 → 이후)
4. **(H1 측정 — #001 인계)** 다음 실제 프로젝트에서 `harness:cycle` 호출 여부 black box 기록
