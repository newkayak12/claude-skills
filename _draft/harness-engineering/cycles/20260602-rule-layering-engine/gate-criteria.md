# Gate Criteria — rule layering engine

> 사이클 *시작 전* 고정. 변경 시 ADR + 사유.
> Reference: [08-pass-criteria.md](../../08-pass-criteria.md) · dev-tool 적응 [09 §9.1b](../../09-pre-cycle.md)

## Gate 1 — 도구 유용성 (dev-tool: self-dogfood)

### 정량

- L0+L1 머지 effective set stage별 산출: ≥ 1회
- override 적용 시 L0 Default 룰이 L1로 *대체*됨이 effective set에서 확인: 100%
- 각 effective rule에 provenance(layer) 표기 누락: 0
- invariant override 시도 거부 + 충돌 리포트 명시: 100%

### 정성

- [ ] 충돌 해소가 *declared layer*로만 결정 (해석 0 — §2)
- [ ] 기각 라인 사전 정의 (hypotheses.jsonl)

## Gate 2 — 기술 가설 검증

### 정량

- 신규 self-test exit 0: 100%
- 기존 9 self-test 회귀: 0건
- 기존 사이클 hash chain 무결(verify): 100%
- export 산출물에 엔진 포함 + self-contained 동작(merge가 export dir 안에서): exit 0

### 정성

- [ ] Failure mode ≥ 3개 식별 (pre-mortem 1·2·3)
- [ ] High-reversibility 결정에 ADR — MVE 경계(L0+L1)·invariant 근사("(필수)" 마커)·override 매칭(동일 id/명시 Overrides)은 사용자 결정+pre-mortem으로 고정
- [ ] 1인 운영 가능성 검토 (CLI 1개, 멱등)
