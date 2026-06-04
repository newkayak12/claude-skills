# Retrospective — gc-surface-expansion

> 2026-06-04 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **GP-6는 결정론적으로 잡을 수 있는 엔트로피**: hooks.json 파싱 → wired set 추출 → hooks/ .py 대조는 경로 resolve처럼 확실한 판정. GP-1 signpost↔relic 판별(사람 필요)과 달리 오탐 0. "결정론이 닿으면 high-confidence"를 GP-6에서 재확인.
- **measure 안정성**: B4 measure를 마지막 줄 grep으로 고정했더니 스크립트 리팩터 시에도 stable. #012 B4 step-번호 표류 교훈이 여기서 적용됨.
- **GC 표면 확장의 누적 구조**: GP-2 plugin/ 확장(#011) → rule-inject README 누락(#012 후속 B1) → GP-6 orphan 탐지(이 사이클 B2). 각 사이클이 이전 사이클의 검사 사각을 드러냄.

## 놀란 것 (예측 vs 실제)

- **컨텍스트 단절(compact) 후 재진입이 매끄러웠다**: B1 작업물(rule-inject README 섹션)이 정확히 완료 상태로 인계됨 — 요약 충실도 확인.
- **GP-6 현재 코드베이스 오탐 0**: 7개 hook이 hooks.json에 정확히 배선돼 있어 처음부터 clean. GP-6 추가가 회귀를 일으키지 않음(--high-confidence-only exit 0 유지).

## 다음에 바꿀 것

- gc-scan.py GP-4 리마인더가 gc.md §6.5 체크리스트 항목을 직접 출력하도록 연결하면 스캔 후 즉시 확인 가능 — 다음 GC 사이클 후보.
- inject-tokens ratchet 축(#012 인계 '의심') 아직 미등재 — 별도 사이클.

## 인계 (살림 / 의심 / 버림)

- 살림: GP-6 scan_gp6_orphan_hooks()(hooks.json wired set 추출 패턴), gc.md §6.5 mandatory 체크리스트(4항목), test-gc-scan.sh GP-6 fixture 패턴(orphan·wired·test-*.py 3종).
- 의심: gc-scan GP-4 리마인더 ↔ gc.md §6.5 체크리스트 간 연결 끊김 — 스캔만으로 체크리스트까지 안내 안 됨.
- 버림: 없음(추가만).

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- 없음.
