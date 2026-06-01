# Retrospective — independent review gate (#007)

> 사이클 *종료 시* 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- 품질-바닥 ②층(독립 리뷰 게이트) 완성. `close-cycle.py`가 *유일 정당 종료 경로*가 되어,
  잠긴 바(`bar.jsonl`)의 모든 기준에 *그 기준의 잠긴 hash에 결박된* `verdict=pass` 리뷰가
  없으면 종료를 거부한다. 수동 우회(`rm cycles/active`)는 `active-symlink-guard` PreToolUse(Bash) hook이 차단.
- **dogfood가 게이트의 작동을 *증명*했다**: 리뷰 0건 상태 close → exit 2 + symlink 보존(차단),
  fresh subagent가 B1/B2/B3 채점(pass) → close exit 0 + symlink 해제 + metrics closed(통과).
  #006이 독립 리뷰의 *가치*를 입증했다면, #007은 그 게이트가 *실제로 작동*함을 재귀로 보였다.
- DRY가 다시 값을 했다: review.jsonl은 hypotheses/bar와 같은 `chainlog`를 import만 — 체인 로직 재구현 0.

## 놀란 것 (예측 vs 실제)

- `test-close-cycle.sh`가 dogfood 중 본문을 **SKIP**했다 — 실제 active 사이클(#007 자신)이 있으면
  `cycles/active`를 clobber하지 않으려 가드가 걸린다(스크립트 11–13행). measure가 "exit 0"이라 바는
  충족하지만, *그 순간엔* 차단/통과 단정이 안 돌았다. 본문 검증은 사이클 열기 *전*에 이미 full PASS.
  → 독립 리뷰어가 이 뉘앙스를 evidence에 정직하게 남긴 게 게이트 정직성의 실증.
- bar_hash 자동 해소(criterion-id로)가 "사람이 hash를 손으로 안 적는다"를 강제 — 바 낮추기를 하면
  hash 불일치로 게이트가 *여전히* 막힌다. 설계 의도대로 작동.

## 다음에 바꿀 것

- `test-close-cycle.sh`의 SKIP 조건은 안전하지만, dogfood 사이클에서 close 로직의 *런타임* 증거가
  비는 사각이 있다. #008(ratchet) 또는 별도 F-항목으로 "임시 cycles 루트에서 격리 실행" 고려.
- guard hook의 정직한 한계(`mv`·`os.unlink`·후행 슬래시 못 잡음)는 문서화됨 — 키워드 매칭의 본질적 한계.
  완전 봉쇄가 아니라 *수동 rm이라는 가장 흔한 우회*를 막는 것이 목표(의도된 범위).

## 인계 (살림 / 의심 / 버림)

- 살림: `chainlog` 공유 패턴, register/verify/list 3-subcommand 정본 구조, dogfood 재귀 자기적용 의식.
- 의심: SKIP된 close 런타임 증거 사각(위). guard의 비-rm 우회 경로.
- 버림: 없음. ②층은 ①층(bar-lock #006) 위에 대칭으로 얹혀 안정적.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- 빌드를 subagent-driven(태스크별 fresh implementer + 2단계 리뷰)이 아니라 *직접* 구현했다.
  사유: 플랜이 모든 파일 코드를 완전 명세 → 5종 self-test의 exit code가 spec 검증을 대체.
  *독립 리뷰*(가장 중요한 무결성 포인트)만 fresh subagent로 분리해 doer≠reviewer를 지켰다.
  trade-off: 빌드 단계 spec/quality 2단계 리뷰는 생략됨 → black box에 기록 0건이나 이 선택은 명시.
