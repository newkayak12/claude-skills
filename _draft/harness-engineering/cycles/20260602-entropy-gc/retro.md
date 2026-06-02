# Retrospective — entropy gc

> 사이클 *종료 시* 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **원칙6(엔트로피 GC)을 *우리 코드에 처음* 적용**. `gc-scan.py`(결정론적 표면 스캐너)+`GOLDEN-PRINCIPLES.md`(선언된 GP-1/2/3)+hermetic self-test. 원칙6의 "golden principles 정의→스캔→정리 PR"이 *반복가능 산출물*로 코드화됨. ratchet 축 2개 등록 → 미래 사이클이 엔트로피 재유입 시 close 게이트가 차단(원칙6를 #008 ratchet에 결박).
- **GC는 "측정 먼저, 압축 나중"의 측정 단계**. 표면(죽은 링크·relic·중복·stale 문서)을 *먼저 줄이고*, 토큰 압축은 다음 사이클로 분리(사용자 "원래대로 진행하고 그다음 경량화"). 묶지 않은 게 주효 — 표면 정리만으로 한 세션 완주.
- **dead link 4개·stale 상태 1개·signpost 오탐 2개·docstring drift 1개**를 실제 트리에서 노출. 사소해 보이나 *에이전트가 지도(원칙1)를 따라가다 막다른 길*에 빠지는 종류 — 누적되면 신뢰 붕괴.

## 놀란 것 (예측 vs 실제)

- **내 relic 탐지기(GP-1)가 0/2 정밀도**(F1). "README+코드0+canonical존재 = relic, 삭제"라 예측했으나 *실제로 내용을 읽어보니* 2건 다 삭제하면 안 됐다 — `scripts/README.md`는 살아있는 설계 가이드(signpost), `hooks/README.md`는 13이 위임하는 설계 카탈로그(상태만 stale). **구조 휴리스틱은 signpost↔relic을 원리적으로 못 가른다.** #009 F1·#010 F1의 3연속 — "실적용 전엔 맞아 보이는 탐지기". GC조차 자기 검증이 필요.
- **stale가 *역방향*이었다**(F2). hooks/README는 "전부 미구현"이라 주장하는데 현실은 5개 구현. 내가 처음 가정한 "13개 이름이 dead라 README가 orphan"과 정반대 — 문서가 *덜* 주장하는 게 아니라 *틀리게* 주장. dead link보다 나쁜 적극적 오정보. 그리고 이건 결정론적 스캔이 *못 잡는* 의미적 드리프트라, mandatory 사람 내용검토가 포착.
- **GC 첫 패스가 얕았다**(F4, 리뷰어 지적). high-confidence 4건이 알고 보니 1 root cause(없는 retro.md)를 4회 링크. 바는 정직히 충족하나 "구별된 4문제"는 아님.

## 다음에 바꿀 것

- **GC 표면을 넓힌다**(F4): 다음 GC/경량화는 plugin SKILL.md 링크·문서 토큰 비대·미사용 hook spec(hooks/README의 11개 unbuilt)까지. 지금은 draft 루트 .md만 깊게 봄.
- **의미적 stale 탐지는 사람/LLM에 위임**(F1·F2): 결정론은 GP-2(dead link)까지. "문서 주장 vs 코드 현실" 같은 의미 드리프트는 GC 의식의 *mandatory 내용검토* 단계로 명문화(gc.md §6.4 표면판).
- **rules-load standalone 소스 실행 미지원**(F6) → export-drift 자동탐지(TODO) 항목에 묶기.

## 인계 (살림 / 의심 / 버림)

- 살림: `gc-scan.py`+`GOLDEN-PRINCIPLES.md`+hermetic self-test(3-sabotage 검증 통과), GP-2 high-only fixpoint 게이트, ratchet 축 2개, "내용판단 필요=watch" 원칙.
- 의심: GP-1 watch의 *실용 가치*(0/2 정밀도였으니 그냥 noise일 수도 — 다음 적용에서 진짜 relic 한 번 잡으면 입증). WET 파서 GP-3(2멤버 watch, 3번째 등장 감시). B2 thinness(F4).
- 버림: "구조 휴리스틱으로 relic 자동삭제" 가설(F1) — 폐기. GP-1은 advisory로만.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- #007~#010과 동일하게 빌드를 *직접* 수행, *독립 리뷰만* fresh subagent로 분리(doer≠reviewer, 원칙3). 리뷰어가 self-test에 sabotage 3건 주입해 비-vacuous 입증 + low 2건(docstring drift·--root 에러) 포착 → 값 입증. trade-off: 빌드 2-pass 리뷰 생략 — 명시.
- 이번엔 SendMessage 도구 *있음* → 리뷰어 채널 유지(adad2bbe). 단 low-fix 후 재확인은 self-test 재실행 + fixpoint 재확인으로 갈음(리뷰어 재호출은 토큰 절약 위해 생략) — 무결성 경로 명시.
- "삭제 전에 대상을 직접 보라"를 *지킴*: GP-1 2건을 자동삭제 직전에 내용을 읽어 둘 다 살림 — 하네스 자신의 원칙이 자기 도구의 오탐을 막은 사례(F1). 만약 안 읽고 스캐너 high를 믿었으면 살아있는 가이드를 지웠을 것.
