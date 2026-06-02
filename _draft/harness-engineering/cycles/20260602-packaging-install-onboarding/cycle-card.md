# Cycle Card — packaging install onboarding

| Field | Value |
|---|---|
| Cycle ID | 20260602-packaging-install-onboarding |
| Start | 20260602 |
| Cycle type | Dev-tool  (Product / Dev-tool / Exploration — see [09 §9.1b](../../09-pre-cycle.md#91b-사이클-타입--게이트는-타입에-따라-적응한다)) |
| Time budget | appetite 3 sessions |
| Cost budget | n/a (관측 불가 — cycle-004) |
| Status | Active |

## 핵심 가설 (≤3)

- H1: draft(`_draft/harness-engineering`)에서 top-level `./harness`로 **export**하면 self-contained installable 플러그인이 되고 marketplace peer로 등록된다 (draft는 source-of-truth로 유지). → GOAL §3.1
- H2: `harness:install` skill이 사용자와 **대화로** `~/.harness/user-rules.md`를 12-rule-layering 포맷으로 생성한다 (수동 파일 작성이 *기본 경로*가 아니다). → GOAL §3.2

> 가설 *공식 등록*은 `scripts/hypothesis-register.py register` — tamper-evident.
> 위 H1~H2는 *사람이 보는* 요약일 뿐, 실제 통과/기각 라인은 hypotheses.jsonl이 SSOT.

## Persona 가설

- 솔로 dev(=나)가 *새 머신/새 프로젝트*에서 harness를 처음 설치·초기화하는 상황. self-dogfood (author=user, CV-1 편향 — H1/H2는 *기계적 검증*으로, 실사용 유용성 H는 GOAL 앞단 완성 후 새 프로젝트에서 black box).

## 성공 기준 (수치) — dev-tool 적응 (09 §9.1b)

- Gate 1 (도구 유용성, self-dogfood): export+install **시뮬 1회 완주** + install skill 대화 흐름으로 생성한 `user-rules.md`가 12-layering frontmatter 포맷으로 **유효** → [08 §8.2](../../08-pass-criteria.md#82-gate-1--제품-가설-검증-기준)
- Gate 2 (기술): 신규 self-test 전부 exit 0 + 기존 6 self-test **회귀 0** + 기존 사이클 체인 무결 → [08 §8.3](../../08-pass-criteria.md#83-gate-2--기술-가설-검증-기준)

## Kill 기준

- **Hard**: 재진입 3회 / 세션 > appetite_sessions × 2 (= 6 세션)
- **Soft**: 세션 > appetite_sessions (= 3 세션) → 재평가 트리거
- 시간=*작업 세션* 단위. 예산$은 관측 불가로 kill 제외.

## 이전 사이클 인계 (살림 / 의심 / 버림)

- 살림: ratchetlib/CLI 분리(chainlog 규약), hermetic tmp-cwd 테스트, close 유일경로 게이트(#007).
- 의심: review-blind `best_declared`(#008 backlog), cycle-init cwd 민감성(#008 F1 — 이번에도 적용 대상).
- 버림: 없음. 품질저하방지 3층은 안정.

## Pivot triggers (사전 정의)

- 신호 A: export가 컨셉 문서 중복을 강요하고 drift가 즉시 발생 → 산출물 최소화(런타임 필수 문서만) Pivot.
- 신호 B: install 대화가 한 세션에 안 끝남(스코프 과대) → user-rules MVE만 남기고 project-rules(L2)는 차기 사이클로.

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
