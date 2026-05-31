# Cycle Card — sessionstart-verify-sensor

| Field | Value |
|---|---|
| Cycle ID | 20260531-sessionstart-verify-sensor |
| Start | 20260531 |
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

- **Hard**: 재진입 3회 / 시간 200% / 예산 100%
- **Soft**: 시간 150% → 재평가 트리거
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
- Dogfood findings: ./findings.md
