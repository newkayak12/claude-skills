# Cycle Card — deploy-kill-check-retire

| Field | Value |
|---|---|
| Cycle ID | 20260606-deploy-kill-check-retire |
| Start | 20260606 |
| Cycle type | Dev-tool  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | ___ (Product: weeks / Dev-tool·Exploration: sessions·appetite) |
| Cost budget | ___ |
| Status | Active |

## 핵심 가설 (≤3)

- H1: ___
- H2: ___
- H3: ___

> 가설 *공식 등록*은 `scripts/hypothesis-register.py register` — tamper-evident.
> 위 H1~H3는 *사람이 보는* 요약일 뿐, 실제 통과/기각 라인은 hypotheses.jsonl이 SSOT.

## Persona 가설

- ___

## 성공 기준 (수치)

- Gate 1: ___ → [08 §8.2](../../08-pass-criteria.md#82-gate-1--제품-가설-검증-기준)
- Gate 2: ___ → [08 §8.3](../../08-pass-criteria.md#83-gate-2--기술-가설-검증-기준)

## Kill 기준

- **Hard**: 재진입 3회 / 세션 > appetite_sessions × 2 (박스를 두 배 넘김)
- **Soft**: 세션 > appetite_sessions (박스 초과) → 재평가 트리거
- 시간=*작업 세션* 단위 (wall-clock 아님 — 방치 오탐 방지, cycle-004). 예산$은 관측 불가로 kill 제외.
- (사이클별 조정 시 ADR 필요)
- **Exploration 타입 defer 허용**: 학습형 사이클은 Kill 기준이 사이클 중 구체화되는 경우가 많다.
  초기엔 위 세션 기반 Hard/Soft만 두고, 도메인 Kill은 `TBD (사이클 중 확정)`로 남길 수 있다.
  단 **종료 게이트 전까지는 반드시 확정** — TBD인 채로 close 불가.

## Phase 진행 (현재 단계 추적 — SSOT는 metrics.json `current_phase`)

> 사이클 내 작업은 단계로 진행된다. AI는 *행동 전에 현재 phase를 확인*하고, 단계를 건너뛰거나 섞지 않는다.
> 산출물은 *채팅이 아니라 아래 저장 위치의 파일*로 남긴다 — 채팅은 휘발성(다음 세션 유실).
> collaborative 산출물은 **사용자 확인 게이트** 통과 전엔 다음 phase로 못 넘어간다 (R-PG01 "No code before design").

| Phase | 산출물 (저장 위치) | 유형 | 상태 |
|---|---|---|---|
| Analysis | 분석 노트 → `docs/**` 또는 `./findings.md` | solo | ☐ todo |
| Design | Design Doc·ADR → `docs/**` | **collaborative** (draft→review→finalize) | ☐ todo |
| Planning | 로드맵·플랜 → `docs/**` | **collaborative** | ☐ todo |
| Implementation | 코드·테스트 → repo | solo | ☐ todo |
| Validation | 독립 리뷰 → `./review.jsonl`, 회고 → `./retro.md` | solo + 독립리뷰 | ☐ todo |

> 상태 표기: `☐ todo` → `▶ in-progress` → `✅ done`. Phase 완료 시 "산출물이 지정 위치 파일로 존재하는가" 검증 후 다음으로.

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림: ___
- 의심: ___
- 버림: ___

## Pivot triggers (사전 정의)

- 신호 A → Pivot 타입 X
- 신호 B → Pivot 타입 Y

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
