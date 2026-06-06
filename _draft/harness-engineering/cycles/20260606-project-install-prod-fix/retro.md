# Retrospective — project-install-prod-fix (#014b)

> #014 가 게이트를 통과하고도 프로덕션-broken 산출물을 낸 F5 의 수정 사이클.

## 무엇을 배웠나

- **설치물(installer)의 테스트는 빌드 산출물(설치 레이아웃)에서 돌려야 한다.** dogfood(plugin/harness)는
  평탄화돼 있지 않고 빌드도구가 곁에 있어, 거기서 통과해도 *설치된 플러그인*에선 깨진다. 이번 테스트는
  `harness-export --dest $BUILT` → `--from $BUILT` 만 쓰도록 강제해 그 사각을 구조적으로 닫았다.
- **installer 는 의존을 줄여 자급해야 한다.** harness-export(subprocess) 의존을 버리고 *평탄화 페이로드
  직접 재귀복사*로 바꾸니, 빌드 산출물 안에서 외부 도구 없이 동작 → file-not-found 종류의 함정 제거.
- **독립 리뷰어가 직접 명령을 돌리면 CV-1 이 실제로 닫힌다.** #014 는 doer·리뷰어 둘 다 dogfood 맥락만
  봤다. 이번엔 리뷰어가 *자체 설계 프로덕션 프로브*(빌드 installer를 --from 없이 fresh mktemp 설치)를
  돌려 doer 주장과 무관하게 검증 → 독립 리뷰 게이트가 의도대로 작동.

## 놀란 것 (예측 vs 실제)

- 교정 비용이 작았다 — installer 가 이미 평탄화 페이로드 *안에* 살기 때문에, "자기 parents[1] 을 복사"면
  끝. 복잡한 재조립(harness-export 의 draft→평탄화 로직)을 installer 가 흉내 낼 필요가 없었다.
- 이번 사이클은 *파일을 추가하지 않았다*(기존 2파일 수정) → mechanism-count 28 유지, ratchet 차단 없음.
  #014 의 --force 부채를 더 키우지 않고 닫았다.

## 다음에 바꿀 것

- test-project-install.sh `set -u`→`set -e`+trap 전환 검토(G4ⓑ): assertion 누락 silent-pass 방지.
- **여전히 남은 P0 부채**: ⓓ deploy-kill-check 은퇴(27 복원 → mechanism-count --force 부채 해소,
  ADR-0001 인계), ⓔ close `--force` blackbox 미기록(#014 F2, high), ⓕ ratchetlib accept-new-baseline(#014 F3).

## 인계 (살림 / 의심 / 버림)

- 살림: project-install.py 직접복사 모델, `--from` 옵션, 비평탄화 소스 거부, 프로덕션경로 테스트,
  글로벌 플러그인에 installer 포함 규약(harness-export 제외목록 #014b 수정).
- 의심: ambient governance 가 *실제 AI 행동*을 바꾸는지는 여전히 N=0(실세계 per-project 채택 시 입증) —
  #014 retro 에서 인계된 의심 그대로 유지.
- 버림: installer 의 harness-export subprocess 의존(#014 의 broken 설계), #014 의 dogfood-only 테스트 경로.

## 어긴 룰 / Anti-pattern

> 분기 회고의 자료 ([SD-10](../../situational-rules/self-discipline.md#sd-10-분기별-자기-회고--내가-어기는-룰))

- 없음(이번 사이클은 --force 없이 정상 게이트로 닫힘). #014 의 force 부채는 별도 후속(ⓓ)으로 인계.
- 메타: #014 에서 "게이트 통과 = 동작"으로 *조기 만족*한 anti-pattern 을 이 사이클이 교정. verification
  -before-completion 이 #014 commit 전에 잡아낸 것이 broken 산출물의 publish 를 막았다.
