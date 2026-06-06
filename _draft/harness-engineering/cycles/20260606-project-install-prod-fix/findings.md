# Dogfood Findings — project-install-prod-fix (#014b)

> 이 사이클은 #014 F5(게이트가 broken 산출물 pass)의 *수정* 사이클이다.

| # | 단계 | 발견 | 심각도 | 처리 |
|---|---|---|---|---|
| G1 | implementation | #014 F5 근본원인 = installer 가 _draft 전용 빌드도구(harness-export)에 subprocess 의존 + 그 둘이 글로벌 플러그인에서 제외 → 프로덕션 file-not-found. 교정: installer 가 *자기가 사는 평탄화 페이로드를 직접 재귀복사* → 빌드 산출물 안에서 자급. | (수정) | B1 pass |
| G2 | test | #014 의 진짜 갭 = *테스트가 dogfood 경로만 탐.* plugin/harness 는 평탄화 아님(06-rules.md 가 draft 루트). 교정: 테스트가 harness-export 로 *빌드된 harness/*(프로덕션 레이아웃) 생성 후 `--from` 으로 벤더링 → self-containment·자급hook 검증. + dogfood 비평탄화 소스 *거부* 테스트(#7)로 F5 재발 차단. | (수정) | B2 pass |
| G3 | validation | 독립 리뷰어가 자체 설계 프로덕션 프로브(빌드 installer를 --from 없이 fresh mktemp 설치) → exit0, self-sufficient. #014 와 달리 doer 주장 신뢰 대신 리뷰어가 직접 명령 실행 → CV-1(dogfood 사각) 실제 폐쇄. | (입증) | R1~R3 pass |
| G4 | validation | 리뷰어 지적(비차단): ⓐ 벤더링 페이로드가 installer 자기제외 → 대상 프로젝트는 재-vendoring 불가(의도된 설계). ⓑ test 의 `set -u`(≠`set -e`) — fail accumulator 가 모든 assertion 커버함을 확인했으나 향후 `\|\| fail=1` 누락 check 추가 시 silent pass 위험. ⓒ early-exit 시 mktemp leak(cosmetic). | low | ⓑ는 후속 시 `set -e`+trap 검토. ⓐⓒ 수용. |

## 살아있는 로그

### G2 상세 — production-vs-dogfood 경로 분리 (핵심 교훈)
#014 의 doer·리뷰어 모두 `plugin/harness/scripts/`(dogfood)에서 테스트했다. 거기엔 harness-export 가
존재해 subprocess 가 성공 → 게이트 pass. 그러나 *설치된 글로벌 플러그인*엔 harness-export 가 없어
프로덕션 install Step A 가 file-not-found. 교훈: **설치물(installer)의 테스트는 반드시 빌드 산출물(설치
레이아웃)에서 돌려야 한다.** test-project-install.sh #014b 가 이를 강제 — `harness-export --dest $BUILT`
후 `--from $BUILT` 로만 벤더링. cwd 가 설치맥락을 가리는 #007/#009 사각(CV-1)의 구조적 차단.
