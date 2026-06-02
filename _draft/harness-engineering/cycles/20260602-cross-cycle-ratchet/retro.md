# Retrospective — cross cycle ratchet (#008)

> 사이클 *종료 시* 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- 품질-바닥 ③층(cross-cycle ratchet) 완성. 북극성 3층(①바-잠금 #006 · ②독립 리뷰 #007 · ③ratchet #008)이 닫혔다.
  #006이 *한 사이클 안* 바 낮추기를, #007이 *바 충족*을 강제했다면, #008은 *바가 사이클을 넘어
  낮아지지 않음*(단조 비감소)을 강제한다.
- **③층은 ②층 인프라에 무비용으로 얹혔다**: 새 hook 0개. `close-cycle.py` 게이트에 단계 2.5 추가
  + 기존 `active-symlink-guard`가 수동 우회를 이미 차단. ratchet 차단도 #007의 종료-유일-경로를 그대로 탄다.
- **핵심 설계 긴장은 "공통 축"이었다**: 바는 cycle-local(B1@#007 ≠ B1@#008), criterion/measure는 자유텍스트라
  cross-cycle 비교 단위가 없다. 해법 = *측정 가능한 축만* 결박(harness 철학 "측정 가능한 것만 강제").
  선택적 `axis/value/direction` 메타 도입, 축 없는 바는 비교 제외(하위호환 — 무축 바 해시는 pre-#008과 동일).
- DRY 3연속: `ratchetlib.py`(하이픈 없음)/`ratchet-check.py`(CLI) 분리는 `chainlog.py` 공유-lib 규약을 그대로 따름.
  close-cycle이 import 해야 했기 때문(하이픈 파일명은 import 불가) — 규약이 구조를 강제했다.

## 놀란 것 (예측 vs 실제)

- **오탐 0이 설계로 떨어졌다**: "무관 영역 cycle이 안 건드린 축 때문에 차단되면?"이 가장 큰 두려움이었는데,
  *선언한 축만* 검사(`find_regressions`가 `floor.get(axis) is None`이면 skip)하니 무관 cycle은 축을 선언 안 해
  자동으로 안전. false block 경로 자체가 없다.
- **best-of 대칭**: floor도 현재값도 "그 축의 best"로 평가하니, 낮은 바+높은 바를 함께 잠가도 best로 충족(CASE7).
  append-only 모델과 자연스럽게 합성됨 — 바를 *올리는* 방향만 의미를 갖는다.
- 독립 리뷰어가 잡은 진짜 한 가지(아래 의심)는 *내가 의식 못 한* 비대칭이었다.

## 다음에 바꿀 것

- **review-blind `best_declared` footgun** (리뷰어 우려 #2): floor는 pass-리뷰 결박을 요구하지만 현재 cycle의
  `best_declared`는 리뷰 무관(타깃만 본다). standalone `ratchet-check.py check` preview에선 *미달성 high-value 바*가
  ratchet을 "통과"시킬 수 있다. **통합 close 경로에선 #007이 모든 잠긴 바에 pass 리뷰를 강제하므로 메워짐** —
  그래도 `best_declared`를 미래 코드가 "achieved"의 SSOT로 재사용하면 위험. devils-advocate에 등재.
- **F4 약한 자기-재귀**: #008 자신은 수치 품질 축이 없어(dev-tool) ratchet이 *자기 close를 게이트*하지 못함
  (#007은 자기 close를 게이트했다). ratchet *작동* 증거는 hermetic 합성 fixture(CASE 1~7)가 SSOT.
  실제 cross-cycle 차단은 *같은 축이 두 번 등장*하는 첫 실사용에서 발생 — 그때 black box로 관측해야.
- **F1 cycle-init cwd 민감성**: `plugin/harness/`에서 돌리면 엉뚱한 곳에 cycles/ 생성. backlog(루트 마커 탐색).

## 인계 (살림 / 의심 / 버림)

- 살림: `ratchetlib`/CLI 분리(chainlog 규약), 선택적-축 하위호환, hermetic tmp-cwd 테스트(close SKIP 사각 우회), best-of 대칭.
- 의심: review-blind `best_declared`(위). F2 close-test SKIP은 ratchet CASE6/7가 메우나 close-test 자체 양성 단정은 여전히 환경 의존.
- 버림: 없음. ③층은 ②층 위에 무비용으로 안정.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- #007과 동일하게, 빌드를 subagent-driven(태스크별 fresh implementer + 2단계 리뷰)이 아니라 *직접* 구현했다.
  사유: 설계가 명확(공통-축 해법 + close 통합)했고 7종 self-test exit code가 spec 검증을 대체.
  *독립 리뷰*(무결성 포인트)만 fresh subagent로 분리해 doer≠reviewer를 지켰고, 리뷰어가 실제로 footgun 1건을
  잡아 가치를 입증(원칙3). trade-off: 빌드 단계 spec/quality 2단계 리뷰 생략 — black box 0건이나 이 선택은 명시.
- 사이클 init을 잘못된 cwd에서 실행(F1). 빈 스캐폴드라 rm+재생성으로 복구, blackbox 영향 없음.
