# Gate Criteria — metrics honesty session count

> 사이클 *시작 전* 고정. 변경 시 ADR + 사유.
> Reference: [08-pass-criteria.md](../../08-pass-criteria.md)

## Gate 1 — 제품 가설 검증

### 정량

- 인터뷰 N: ≥ ___
- 가설 일치율: ≥ ___%
- 행동 약속 (지불/시간/전환): ≥ ___명
- Persona 외 발화: < ___%

### 정성

- [ ] Mom Test 위반 0
- [ ] 기각 라인 사전 정의 (hypotheses.jsonl에 등록)

## Gate 2 — 기술 가설 검증

### 정량

- P95 latency: < ___ms
- Error rate: < ___% (부하 테스트)
- N+1 / full-scan: 0건
- 부하 capacity: ≥ 예상 × ___

### 정성

- [ ] Failure mode ≥ 3개 식별
- [ ] High-reversibility 결정에 ADR
- [ ] 1인 운영 가능성 검토
