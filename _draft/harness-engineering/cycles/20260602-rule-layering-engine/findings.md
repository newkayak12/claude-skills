# Dogfood Findings — rule layering engine

> 이 사이클을 돌리며 *하네스 자신* 또는 *작업 대상*에서 발견한 고장·갭.
> 사이클 종료 시 retro carryover의 원료. ([13 §7](../../13-operational-layer.md))

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| F1 | review | **stage 어휘 불일치** — `user-rules-init`가 `Stage: Micro/Macro`(12-layering §3 어휘) 출력, L0(06-rules.md §0.1)는 `code-writing/architecture/...`만. 생성된 L1 룰(FMT/WIP)이 *어떤 stage 필터에도 안 잡힘* → install이 만든 룰이 stage-filtered load에서 **죽음**. `*`인 LANG만 생존 | high | `user-rules-init`의 emit stage를 L0 어휘로 정렬(FMT→`code-writing`, WIP→`*`). test-rules-merge B4에 stage-filtered 생존 단언 추가 |
| F2 | review | WIP 룰이 **기만적 no-op** — Why는 "L0 Default WIP 조정"이라는데 매칭 id도 Overrides도 없어 아무것도 안 함. 게다가 06-rules.md엔 **WIP 룰이 코드화돼 있지 않음**(R-PG01은 "No code before design", WIP=1은 스펙에만 존재) → 내가 처음 단 `Overrides: R-PG01`은 *틀린 타깃* | high | 정직한 **additive** L1 선언으로 변경(거짓 Overrides 제거, Why에 "override 대상 없음" 명시). 허위 override_target_missing 충돌도 사라짐 |
| F3 | build | **invariant 판정이 섹션-단위**("(필수)" H2 마커) — 한 섹션 전체가 invariant. 진짜 overridable 룰이 (필수) 섹션에 있으면 unkillable, 반대도. 12-layering §1은 WIP=1을 *L0 Default(overridable)*라는데 코드화되면 (필수) 섹션 충돌 소지 | medium(설계) | MVE 근사로 *선언*하고 인정(추론 아님). 정밀 per-rule scope 태깅은 backlog(§4의 5개 Core 후보를 id로 고정) |
| F4 | build | **WIP=1이 06-rules.md에 룰로 없음** — 스펙(12-layering §1)은 L0 Default라는데 06-rules.md 어디에도 WIP 룰이 없다. 머지 엔진이 "스펙 주장 vs 실제 코드화"의 갭을 노출 | medium | finding. L0 Default 룰(WIP=1, 14일 상한)을 06-rules.md에 실제 코드화 = backlog |
| F5 | review | `rules-merge conflicts`는 `same_layer_dup`만 차단(exit2); invariant_protected/override_target_missing 등은 print만 exit0 → 이걸 게이트로 스크립팅하면 exit code로 못 잡음 | low | finding. 비차단 충돌도 exit 코드로 신호할지 backlog(지금은 stdout 파싱) |
| F6 | build | 같은-layer dup 탐지는 *단일 L1 파일 내*만(MVE는 L1 1개 로드). L2 도입 시 cross-file dup은 별도 | low(MVE 정상) | 후속 사이클(L2) 범위로 명시 |

## 살아있는 로그

- 머지 엔진은 `ruleslib.py`(importable 순수함수)+`rules-merge.py`(CLI)로 chainlog/ratchetlib 규약 답습. L0 파서는 ruleslib가 *자체 사본* 보유(rules-load와 중복) — R-CD04(DRY는 Rule of Three까지) 따라 2번째 등장이라 WET 허용, 3번째에 공유 검토.
- 독립 리뷰어가 5/5 pass 주면서 F1(stage 죽음)·F2(WIP no-op)를 *값을 갉는 갭*으로 포착 — 둘 다 *엔진 코어가 아니라 생성 L1 콘텐츠×L0 의미*의 상호작용. 엔진은 선언대로 정확. 원칙3가 또 콘텐츠 정합성 결함을 잡음.
- F4가 핵심 dogfood: 머지 엔진을 만들어 "L1으로 L0를 override"를 실제로 돌려보니, 그 override 대상(WIP L0 룰)이 *애초에 코드에 없다*는 걸 발견. 문서가 주장하는 L0 Default가 미구현.
