# Cycle Card — rule layering engine

| Field | Value |
|---|---|
| Cycle ID | 20260602-rule-layering-engine |
| Start | 20260602 |
| Cycle type | Dev-tool  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | appetite 3 sessions |
| Cost budget | n/a (관측 불가 — cycle-004) |
| Status | Active |

## 핵심 가설 (≤3)

- H1: 엔진이 L0(06-rules.md 카탈로그)과 L1(`~/.harness/user-rules.md` per-rule)을 *각각의 파서로 읽어 통합 모델*로 만들고, stage별로 **우선순위(L1 > L0 Default) 머지** + 각 effective rule에 **provenance(layer)** 를 붙여 출력한다. → #009 F4 해소 (install이 만든 user-rules가 *적용*됨)
- H2: **invariant 보호 + 비해석** — L0 Core(invariant) 룰은 L1이 override 시도해도 *거부*(declared layer로 결정, 해석 없이). 같은 layer 같은 id 충돌은 자동선택 안 하고 **에러**(AP-26 차단).

> 가설 *공식 등록*은 `scripts/hypothesis-register.py register`.

## Persona 가설

- 솔로 dev(=나)가 install로 L1 user-rules를 만든 뒤, 사이클 작업 단계에서 "이 stage에 *실효* 룰이 무엇인가(L0+L1 머지)"를 한 번에 보고 싶은 상황. self-dogfood (CV-1 — 머지 *정확성*은 기계 검증, 실사용 유용성은 측정 대기).

## 성공 기준 (수치) — dev-tool 적응 (09 §9.1b)

- Gate 1 (도구 유용성): `user-rules-init`로 만든 L1을 엔진이 읽어 L0와 머지한 effective set을 stage별로 **1회 산출**, override·provenance가 눈으로 정확 → [08 §8.2](../../08-pass-criteria.md#82-gate-1--제품-가설-검증-기준)
- Gate 2 (기술): 신규 self-test 전부 exit 0 + 기존 9 self-test **회귀 0** + 기존 사이클 체인 무결 + export self-contained 동작 → [08 §8.3](../../08-pass-criteria.md#83-gate-2--기술-가설-검증-기준)

## Kill 기준

- **Hard**: 재진입 3회 / 세션 > 6
- **Soft**: 세션 > 3 → 재평가
- 시간=작업 세션 단위. 예산$ kill 제외.

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림: ratchetlib/chainlog 공유-lib 규약(하이픈 없는 importable + CLI 분리), hermetic 테스트, export self-contained 스모크(끝까지 동작 단언).
- 의심: rules-load 파서가 06-rules 구조에 *겨우* 맞음(#009 F8 크래시 전력) — 머지 엔진이 이 파서를 재사용하니 신중. L0 invariant 태깅 SSOT 부재(§4는 5개 나열, per-rule 태그 없음).
- 버림: 없음.

## Pivot triggers (사전 정의)

- 신호 A: invariant 판정 소스(어느 L0 룰이 Core인가)가 모호해 머지가 임의 해석 → MVE는 "(필수)" 섹션 마커를 invariant 근사로 쓰고 *정밀 태깅은 backlog*로 축소(해석 금지 원칙 유지).
- 신호 B: override 의미(같은 id vs topic)가 한 세션 안 정리 안 됨 → `Overrides: <id>` 명시 필드만 지원(topic 추론 금지), 나머지 backlog.

## 관련 문서

- Pre-mortem / Gate criteria / Hypotheses / Retro / Activity / Black box / Quality bar / Reviews / Findings — 동일 디렉토리.
- 설계 근거: [12-rule-layering.md](../../12-rule-layering.md) §1(4-layer)·§2(충돌=declared layer)·§4(L0 Core 후보).
