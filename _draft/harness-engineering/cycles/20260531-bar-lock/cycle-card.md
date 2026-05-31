# Cycle Card — bar lock

| Field | Value |
|---|---|
| Cycle ID | 20260531-bar-lock |
| Start | 20260531 |
| Cycle type | Dev-tool  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | appetite 2 sessions (실측 1) |
| Cost budget | n/a (관측 불가 — kill 제외, #004) |
| Status | Closed |

## 핵심 가설 (≤3)

- H1: bar-register가 품질 바를 hash chain으로 등록 + hook이 bar.jsonl 직접편집 차단 + 정당 append 통과 + verify 변조탐지, chainlog 추출 후 기존 가설 체인 회귀 0 (SSOT: hypotheses.jsonl)
- H2: —
- H3: —

> 가설 *공식 등록*은 `scripts/hypothesis-register.py register` — tamper-evident.
> 위 H1~H3는 *사람이 보는* 요약일 뿐, 실제 통과/기각 라인은 hypotheses.jsonl이 SSOT.

## Persona 가설

- ___

## 성공 기준 (수치)

- Gate 1: n/a (dev-tool — 제품 게이트 없음)
- Gate 2: self-test 전항목 PASS + spec/quality 리뷰 4 chunk 전부 승인 → 잠긴 바 B1/B2/B3 충족 (./bar.jsonl)

## Kill 기준

- **Hard**: 재진입 3회 / 세션 > appetite_sessions × 2 (박스를 두 배 넘김)
- **Soft**: 세션 > appetite_sessions (박스 초과) → 재평가 트리거
- 시간=*작업 세션* 단위 (wall-clock 아님 — 방치 오탐 방지, cycle-004). 예산$은 관측 불가로 kill 제외.
- (사이클별 조정 시 ADR 필요)

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림: #005의 Sensor→script subprocess 골격, exit-코드↔행동 매핑 패턴
- 의심: hook 통합 테스트 미수행(#005), appetite 정확도(#004)
- 버림: 없음

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
- Dogfood findings: ./findings.md
