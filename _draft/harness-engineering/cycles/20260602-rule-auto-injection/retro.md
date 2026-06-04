# Retrospective — rule auto injection

> 2026-06-04 작성.
> 참조: [SD-07](../../situational-rules/self-discipline.md#sd-07-사이클-종료는-명시적으로), [`think:retrospective`]

## 무엇을 배웠나

- **stage-injection이 키스톤**: 룰 슬라이싱(토큰 최소화)을 독립 리뷰가 "기능저해"로 반려하면서 stage-inject가 *기능보존 버전*으로 구체화됐다. 슬라이싱 아이디어가 stage-injection이라는 더 나은 해법을 강제했다.
- **B4 step 번호 표류**: B4 등록 시 "Step3"이 Step 0(python3 preflight) 추가로 Step 4로 밀렸다. 리뷰어가 정확히 포착 — 1줄 fix로 해소. 바 등록 시 파일 구조 변경을 함께 고려해야 함.
- **"측정 먼저, 압축 나중"(#004 연장)**: 자동주입을 먼저 깔아야 실측 토큰이 생기고, 그 실측치를 깎는 게 맞는 타깃임을 재확인. 766→620(lossless) → stage-injection으로 SessionStart 384 수준까지.

## 놀란 것 (예측 vs 실제)

- **독립 리뷰가 슬라이싱=기능저해를 정확히 포착**: lossless 압축으로 전환을 강제. 게이트가 예상대로 작동함을 dogfood로 입증.
- **test-rule-inject.sh의 vacuous 사각**: export populated L0 45룰 환경에서야 B2 실제 계약(inj==full)이 드러남. draft↔export 발산이 테스트 사각을 만들었다.

## 다음에 바꿀 것

- 바 등록 시 step 번호가 파일 구조 변경에 취약 — 라인 grep 대신 섹션 이름 기준으로 measure 작성.
- stage-injection 잔여(다른 단계 신호, compaction 후 재주입) → 별도 사이클.

## 인계 (살림 / 의심 / 버림)

- 살림: stage-inject 메커니즘(PreToolUse additionalContext, de-dup 마커), lossless 1줄/룰 포맷, token-profile.py, test-runtime-wiring.sh 2티어.
- 의심: `inject-tokens` ratchet 축 아직 미등재(현재값 620) — 다음 사이클에서 watermark lock 필요.
- 버림: 슬라이싱 단독 시도(기능저해로 확정 폐기). --dynamic 플래그는 stage-injection 빌딩블록으로만 남김.

## 어긴 룰 / Anti-pattern

- B4 measure를 파일 step 번호 기준으로 작성해 구조 변경에 취약하게 됨. 리뷰가 잡아서 fix — 게이트 작동 실증.
