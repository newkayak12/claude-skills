# Dogfood Findings — cross cycle ratchet

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | init | `cycle-init.py`가 cwd 기준 `Path("cycles")` — `plugin/harness/`에서 돌리면 거기에 cycles/ 생성. 잘못된 위치에 스캐폴드됨 | medium | 빈 스캐폴드라 rm 후 repo 루트에서 재생성. backlog: cwd 강건성(루트 마커 탐색) |
| F2 | test | `test-close-cycle.sh`는 실제 active 사이클 있으면 SKIP → close 런타임 증거 사각(#007 retro 지적) | medium | `test-ratchet-check.sh`를 tmp cwd로 완전 hermetic화 + CASE 6/7에 close 통합 검증 → 이 사각을 *우회로* 메움 |
| F3 | build | ratchet 비교 단위가 자유텍스트 바엔 없음 — "공통 축"이 설계의 핵심 긴장 | (설계) | 선택적 axis/value/direction 메타 도입. 축 없는 바는 cross-cycle 비교 제외(하위호환) |
| F4 | dogfood | #008 자신은 수치 품질 축이 없어(dev-tool) ratchet이 *자기 close를 게이트하지 못함* — #007의 재귀보다 약함 | low | 정직히 인정. ratchet *작동* 증거는 hermetic 합성 fixture(CASE 1~7)가 SSOT. 실제 cross-cycle 차단은 같은 축 2회 등장 시 발생 |

## 살아있는 로그

- close-cycle 통합은 새 hook 없이 기존 `close-cycle.py` 게이트에 1단계(2.5) 추가 + `active-symlink-guard`가 수동 우회를 이미 막음 → ③층은 ②층 인프라에 무비용으로 얹힘.
- `ratchetlib.py`(하이픈 없음)/`ratchet-check.py`(CLI) 분리는 `chainlog.py` 공유-lib 규약을 그대로 따름 — close-cycle이 import 가능해야 했기 때문(하이픈 파일명은 import 불가).
