# Cycle Card — entropy gc

| Field | Value |
|---|---|
| Cycle ID | 20260602-entropy-gc |
| Start | 20260602 |
| Cycle type | Dev-tool  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | 1–2 sessions (appetite) |
| Cost budget | 관측 불가 (kill 제외, cycle-004) |
| Status | Active |

## 핵심 가설 (≤3)

- H1: **결정론적 스캐너(`gc-scan.py`)가 하네스 자신의 실제 엔트로피를 탐지한다** — 고아 README(삭제된 파일 가리킴)·미참조 문서·중복 파서 함수(`ruleslib`↔`rules-load` WET)·죽은 코드. 선언된 golden-principles 기준으로 스캔 → ≥4개 실제 항목 발견 → 정리. (= 원칙6 "scan→cleanup PR"을 *우리 코드에 처음* 적용; 스캐너가 *반복가능* 산출물.)
- H2: **정리가 표면을 줄이되 아무것도 안 깨뜨린다** — 정리 후 기존 self-test 전부 통과(rules-merge 9/9 · harness-export · rules-load >5룰), 스캐너 멱등(정리 후 재실행 → high-confidence 0 = fixpoint).
- H3: **스캔 기준은 선언이지 추론이 아니다** — gc-scan의 룰은 *선언된* golden-principles 목록에서 파생(ad-hoc 아님). 하네스의 "비해석" 원칙(#010 §2)을 GC에도 적용.

> 가설 *공식 등록*은 `scripts/hypothesis-register.py register` — tamper-evident.
> 위 H1~H3는 *사람이 보는* 요약일 뿐, 실제 통과/기각 라인은 hypotheses.jsonl이 SSOT.

## Persona 가설

- "무겁다"고 한 솔로 dev. 하네스 표면이 줄어야 채택 가능. 스캐너가 월 1회 "뭐가 죽었나" 리포트를 줌(gc.md §6 시작점). GC는 *증상*(표면)을 깎고, 다음 경량화 사이클이 토큰을 깎는다 — 분리.

## 성공 기준 (수치)

- Gate (Dev-tool, [09 §9.1b]): `gc-scan.py`가 실제 하네스 트리에서 **선언 golden-principle 위반 ≥4건** 탐지 → 각 항목 *제거 or 명시적 deferral(이유 기록)*; 정리 후 **재스캔 fixpoint**(high-confidence → 0 또는 명시 whitelist); **회귀 0**(기존 self-test 전부 통과).
- 합성 fixture: planted 고아 README + 죽은 함수 → 정확히 그것만 탐지(거짓음성 0), clean fixture → 0건(거짓양성 0). hermetic self-test PASS.

## Kill 기준

- **Hard**: 재진입 3회 / 세션 > appetite_sessions × 2 (박스를 두 배 넘김)
- **Soft**: 세션 > appetite_sessions (박스 초과) → 재평가 트리거
- 시간=*작업 세션* 단위 (wall-clock 아님 — 방치 오탐 방지, cycle-004). 예산$은 관측 불가로 kill 제외.
- (사이클별 조정 시 ADR 필요)

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림 (#010): ruleslib/CLI 분리, 비해석 원칙, hermetic 합성 fixture + 비-vacuous 단언(#009 F8 교훈), self-test 게이트.
- 의심 (#010): `ruleslib`↔`rules-load` L0 파서 WET (R-CD04 Rule of Three까지 의도적). **이 사이클이 3번째 등장 여부 판정 + GC 후보 1순위.**
- 버림: 없음(이전 사이클이 명시 버림한 거짓 Overrides는 이미 처리).

## Pivot triggers (사전 정의)

- 신호 A: 스캐너가 *결정론적으로* 잡을 수 있는 엔트로피가 <4건 (트리가 이미 깨끗) → Pivot: GC 범위를 *문서 비대/토큰*으로 이동(경량화 사이클 선당김).
- 신호 B: WET 파서 통합이 동작 변경/회귀 유발 → Pivot: 통합 보류(WET 유지), 스캐너는 *탐지·리포트만*(자동 수정 안 함).

## 관련 문서

- Pre-mortem: ./pre-mortem.md
- Gate criteria: ./gate-criteria.md
- Hypotheses: ./hypotheses.jsonl
- Retro: ./retro.md
- Activity log: ./activity.log
- Black box (어긴 것 기록): ./blackbox.jsonl  → [13 §4](../../13-operational-layer.md#4-black-box--막지-말고-기록)
- Quality bar (잠금): ./bar.jsonl  → bar-register.py 로 등록 (#006)
- Reviews (독립 채점): ./review.jsonl  → review-register.py 로 등록 (#007)
- Dogfood findings: ./findings.md
