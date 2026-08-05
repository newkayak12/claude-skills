# 스킬 큐레이션 원장

최초 분석: 2026-07-16 · 최종 갱신: 2026-08-04
기준: ① 중복/기능 겹침 ② 실제 안 씀 ③ 품질 미달
판정: **KILL** 삭제 · **MERGE** 병합 · **CONFIRM** 사용여부 유저 확인 · **KEEP** 유지 · **FIX** 유지+품질 보수

---

## ✅ 완료 (2026-08-04)

| 항목 | 조치 | 결과 |
|---|---|---|
| `skill:skill-validator` | KILL | 삭제. 참조 4곳 `skill-quality-assurance`로 repoint. skill 1.1.4→1.1.5 |
| `portfolio:portfolio-feedback` v1 | KILL+승계 | v1 삭제, v2(evals 보유)를 정식명으로 승격. portfolio 1.1.7→1.1.8 |
| 레포 위생 | CLEANUP | `_deprecated/`, `_draft/harness-engineering/`(v0 원장, `harness-v0` 태그 보존), gajae 메모, 워크스페이스/캐시 잔재 제거 |
| 정합성 | FIX | CLAUDE.md 경로, `.gitignore` 앵커링, harness-gate `templates` 커버, validate 스크립트 README-drift 검사 |

---

## 🔄 B. superpowers 중복 클러스터 — **개량하여 우리 것으로 (진행 중)**

repo가 superpowers와 같은 이름으로 둔 8개. **결정: KILL 아님 — 각 스킬을 개량해 독자
스킬로 재작성**(이름·슬롯 유지, 내용만 우리 관점으로). 부수 효과로 MIT "substantial
portions" 귀속 의무가 소멸(프로즈 중복 <30% 목표). 스킬은 하나도 사라지지 않음.

per-skill 흐름: brainstorm 방향 → 유저 확정 → 재작성 → overlap 측정 → 버전/README/마켓 갱신.

| # | repo 스킬 | 초기 overlap | 상태 |
|---|---|---|---|
| 1 | `completion:verification-before-completion` | 81% | ✅ 재작성 (verify-level + isolated subagent, prose 4%) |
| 2 | `agents:dispatching-parallel-agents` | 75% | ✅ 재작성 (persona allocator, parallel 코어 유지, prose 4%) |
| 3 | `planning:executing-plans` | 64% | ✅ 재작성 (pre-flight gate + persona router, prose 0%) |
| 4 | `develop:test-driven-development` | 38.84% | ✅ 재작성 (dual-mode evidence gate, prose 0.34%) |
| 5 | `write:writing-skills` | 61% | ✅ 재작성 (producer + 이중 위임 계약, dual-mode, prose 0.37%) |
| 6 | `write:writing-plans` | 52% | ✅ 재작성 (gate-ready 플랜 생산자 + production-time gap/ambiguity 검사 + step별 pass-bar + dual-mode, prose 2.96%) |
| 7 | `agents:subagent-driven-development` | 22% | 🔲 잔여 정리만 |
| 8 | `think:brainstorming` | 5% | 🔲 잔여 정리만 |

---

## 🔲 C. 병합 클러스터 — 내용 확인 후 확정 (기준①)

- **develop 테스트 (4→2 예상)**: `test-master`(140) · `testing-workflow`(인덱스) · `flaky-test-analyzer`(122) [+ `test-driven-development`는 B]
- **develop 아키텍처 (8→3~4)**: `architecture-designer` · `architecture-workflow`(인덱스) · `clean-architecture` · `domain-driven-design` · `microservices-architect` · `service-boundary-validator` · `event-storming` · `transaction-boundary-reviewer` — 페르소나형 다수
- **develop 운영/튜너 (다수→축소)**: `connection-pool-tuner` · `circuit-breaker-tuner` · `database-optimizer` · `database-workflow`(인덱스) · `performance-profiling-optimization` · `sql-pro` · `chaos-engineer` · `sre-engineer` · `incident-response-playbook` · `operations-workflow`(인덱스) · `dockerfile-optimizer` — `-tuner/-optimizer/-engineer` 페르소나 래퍼 비중 큼
- **develop 페르소나 (품질·중복 동시 의심)**: `kotlin-specialist` · `spring-boot-engineer` · `frontend-developer` · `cli-developer` · `code-documenter`
- **think ↔ cognition (19개, 미션 겹침)**: 두 플러그인이 "사고 도구"로 목적 중복 → 플러그인 통합 + 인덱스 1개 후보. `microinteractions`(UI)·`negotiation`은 think에 이질 → 재배치/독립

---

## 🔲 D. 사용여부 확인 — 유저만 판단 가능 (기준②)

마켓플레이스 배포용이면 "안 씀"은 본인 기준. 개인 사용 여부 확인 시 대량 킬 가능:

| 도메인 | 개수 | 비고 |
|---|---|---|
| `pm` | 22 | PM 실무 안 하면 대량 킬 후보 |
| `self` | 12 | 자기성찰 계열 — 개인 사용 아니면 킬 |
| `leadership` | 5 | 매니저 롤 여부에 종속 |
| `cognition` | 11 | C의 think 통합과 연동 판단 |

---

## 🔲 E. 품질 보수 (FIX) — 필수 섹션 결손 상위

`write:technical-blog-writer` · `pm:inspired-pm` · `pm:product-discovery` · `pm:roadmap-communication` · `pm:post-launch-retrospective` · `think:microinteractions` · `think:negotiation` · `skill:skill-quality-assurance` 등
※ 프록시(헤딩 매칭)는 변형에 취약 → FIX 착수 전 실제 파일 확인 필요.

---

## 다음 할 것 (우선순위)

1. **B 결정** — "이 마켓플레이스는 superpowers 설치를 전제하는가?" 한 줄 답이면 8개 처리 방향 확정.
2. **C 병합** — develop 32개가 최대 표적. 클러스터별로 실제 SKILL.md 읽고 인덱스 1 + 실질 N으로 축소.
3. **D 확인** — pm/self/leadership 사용 여부. 안 쓰면 39개까지 정리 가능.
4. **E 보수** — 살아남는 스킬만 대상으로 authoring 규칙대로 필수 섹션 채움.
