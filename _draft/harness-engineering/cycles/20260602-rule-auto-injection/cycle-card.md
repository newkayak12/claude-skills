# Cycle Card — rule auto injection

| Field | Value |
|---|---|
| Cycle ID | 20260602-rule-auto-injection |
| Start | 20260602 |
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
