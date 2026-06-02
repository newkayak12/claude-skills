# Retrospective — rule layering engine

> 사이클 *종료 시* 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **#009의 가치 완성**: install이 만든 L1 user-rules가 *실제 적용*된다. `ruleslib.py`(파서+머지 순수함수)+`rules-merge.py`(CLI)가 L0(카탈로그)+L1(per-rule)을 stage별 우선순위(L1>L0)로 머지하고 provenance를 붙인다. install 스킬 Step3 표에 `rules-merge effective` 추가.
- **충돌 해소를 declared layer로만**(§2, 해석 금지) 코드화: 같은 id→높은 layer 승, 명시 Overrides, invariant 보호, 같은-layer 중복은 *자동선택 거부*(exit2, AP-26). invariant 판정은 "(필수)" 섹션 마커 = *선언된* 근거(추론 0).
- **MVE 경계를 사용자 결정으로 좁힌 게 주효**: L0+L1만 + L1/L2/L3 포맷 1개 통일(L0 카탈로그는 그대로, 엔진이 두 파서). 한 세션 완주 + churn 0(06-rules 45룰 재작성 안 함).

## 놀란 것 (예측 vs 실제)

- **WIP=1이 룰로 존재하지 않았다**(F4): 머지 엔진을 만들어 "L1으로 L0 Default(WIP) override"를 *실제로 돌려보니*, override 대상이 06-rules.md에 **없다**. 12-layering §1은 WIP=1을 L0 Default라 선언하지만 코드화 안 됨. 문서 주장과 실제 코드의 갭을 *엔진이 실행으로 노출*. 내가 처음 단 `Overrides: R-PG01`은 R-PG01이 "No code before design"이라 틀린 타깃이었다.
- **stage 어휘가 두 개였다**(F1): 12-layering §3은 Macro/Meso/Micro, 06-rules §0.1은 code-writing/architecture/... — 머지 엔진이 같은 stage로 필터하려는 순간 둘이 disjoint. user-rules-init이 §3 어휘를 써서 생성 룰이 stage-filtered load에서 *전부 죽어 있었다*. unfiltered만 보면 안 보이는 죽음 — #009 F8(vacuous)의 사촌.

## 다음에 바꿀 것

- **L0 Default 룰 코드화**(F4): WIP=1·14일 상한 등 스펙상 L0 Default를 06-rules.md에 실제 룰로. 그래야 L1 override가 *대상을 갖는다*. backlog.
- **per-rule scope 태깅**(F3): "(필수)" 섹션 근사 대신 §4의 5개 Core를 id로 고정 → invariant 정밀화. backlog.
- **stage 어휘 SSOT**(F1 잔여): §3과 §0.1을 한 어휘로 수렴(또는 매핑표). 지금은 user-rules-init을 §0.1로 정렬해 *증상*만 막음. backlog.
- **conflicts exit 코드**(F5): 비차단 충돌도 게이트로 쓸지.

## 인계 (살림 / 의심 / 버림)

- 살림: ruleslib/CLI 분리, invariant 보호(양 경로), 같은-layer 비해석 차단, stage-filtered 비-vacuous 단언, export self-contained 머지 스모크.
- 의심: 섹션-단위 invariant(F3), stage 어휘 이원화(F1 근본 미해결, 증상만), L1 단일 파일 dup만(F6 — L2에서 확장).
- 버림: 거짓 `Overrides: R-PG01`(WIP) — additive로 교체. L0 파서는 rules-load와 중복 보유(R-CD04 Rule of Three 전이라 의도적 WET).

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- #007~#009과 동일하게 빌드를 *직접* 수행, *독립 리뷰만* fresh subagent로 분리(doer≠reviewer). 리뷰어가 F1/F2를 포착해 값 입증. trade-off: 빌드 단계 2-pass 리뷰 생략 — 명시.
- 리뷰 후 F1/F2 수정을 같은 리뷰어에 재확인 못 보냄(SendMessage 도구 부재, #009와 동일). 바 불변 + B4 테스트에 stage-생존/거짓-override-부재 단언 추가 + 전체 재실행(9/9)으로 갈음. 무결성 경로 명시.
- L0 파서 중복(WET)은 R-CD04(DRY는 Rule of Three까지)를 *따른* 의도적 선택이나, 하네스 자신의 룰을 인용해 정당화한 것이므로 기록.
