# Gate Criteria — packaging install onboarding

> 사이클 *시작 전* 고정. 변경 시 ADR + 사유.
> Reference: [08-pass-criteria.md](../../08-pass-criteria.md) · dev-tool 적응 [09 §9.1b](../../09-pre-cycle.md)

## Gate 1 — 도구 유용성 (dev-tool: self-dogfood)

> Product "인터뷰 5명"을 self-dogfooding으로 적응 (09 §9.1b).

### 정량

- export+install 시뮬 완주: ≥ 1회 (hermetic tmp)
- 생성된 `user-rules.md`가 `rules-load.py`/포맷 검증 통과: 100%
- install skill 대화 흐름 단절(수동 작성 강요) 지점: 0

### 정성

- [ ] install이 "설치 후 *언제 무엇을 로드*하는지" 사용자에게 명시 (CA-1 / GOAL §3.3)
- [ ] 기각 라인 사전 정의 (hypotheses.jsonl에 등록)

## Gate 2 — 기술 가설 검증

### 정량

- 신규 self-test exit 0: 100%
- 기존 6 self-test 회귀: 0건
- 기존 사이클 hash chain 무결(verify): 100%
- export 산출물 self-containment smoke (CLAUDE_PLUGIN_ROOT=export dir): exit 0

### 정성

- [ ] Failure mode ≥ 3개 식별 (pre-mortem 1·2·3)
- [ ] High-reversibility 결정에 ADR — 플러그인 위치(top-level ./harness, draft=source)는 사용자 결정으로 고정
- [ ] 1인 운영 가능성 검토 (export 1커맨드, 멱등)
