# TODO — gajae-code 패턴 흡수 (Option B: 기존 harness 위 추가 레이어)

근거: `reference/gajae.md`, 설계: `docs/superpowers/specs/2026-06-17-gajae-style-team-ledger-design.md`
현재 harness 버전: `0.3.10` (`harness/skills/{install,cycle,plan,work,review}` — 변경하지 않음, 이 작업은 전부 *추가*)

## P0 — 신규 skill 3개 (진입점)

- [ ] `harness/skills/interview/SKILL.md` 작성
  - Planner persona, Socratic 질문, ambiguity 임계치 없이도 "충분히 명확해졌다" 판단 기준 정의
  - 출력: `.claude/harness/specs/<slug>.md`
  - 기존 `harness:cycle`과의 순서 관계 명시 (인터뷰 → cycle 진입 또는 독립 실행 가능?)
- [ ] `harness/skills/goals/SKILL.md` 작성 (이름 확정: `harness:goals`, 기존 `plan` skill과 분리 — `plan`은 active cycle 내 spec/design/plan 담당, `goals`는 최종 goal → sub-goal 분해 담당)
  - Planner: goal → sub-goals + acceptance_criteria + skill_hints
  - Critic: devils-advocate 검토, 최대 3회 revise (Verifier와 동일 cap으로 통일)
  - 출력: `.claude/harness/goals.json` (스키마는 spec §5 참조)
- [ ] `harness/skills/run/SKILL.md` 작성 (가제, `harness:execute`도 고려)
  - `Workflow` tool 호출 — pipeline 스크립트는 별도 `.js` 파일이 아니라 Workflow script 인라인으로 (스킬 문서에 박아두지 말고 실행 시점에 생성하거나 `scripts/` 아래 템플릿화)
  - 3회 실패 시 자동 중단 + 사용자 보고 로직 필수

## P0 — Workflow 스크립트

- [ ] pipeline 스켈레톤 구현 (spec §3) — Planner(phase:Plan) → Critic(phase:Critique, 최대 3회 revision) → [Executor(phase:Execute) ↔ Verifier(phase:Verify)] 최대 3회 루프
- [ ] Verifier 3-layer 검증 프롬프트 작성: acceptance criteria / plan-adherence / work-product 각각 독립 판정 후 AND 결합
- [ ] 3회 실패 시 `status.json`에 `failed` + blocker 기록, Workflow 결과로 사용자에게 명시적 보고 (skill 쪽에서 silent continue 금지)

## P0 — State/스키마

- [ ] `.claude/harness/goals.json` 스키마 확정 및 read/write 유틸 (`harness/scripts/`에 Python 헬퍼 추가할지, Workflow 내부 JS로만 처리할지 결정 — 기존 harness는 전부 Python 스크립트 컨벤션)
- [ ] `.claude/harness/cycles/<goal-id>/` 디렉토리 템플릿 (`plan.md`, `critic-review.md`, `work-evidence.md`, `verification.md`, `rationale.md`, `status.json`)
- [ ] 기존 `cycles/active/`(harness 기존 cycle 단위)와 신규 `cycles/<goal-id>/`(goal 단위) 두 디렉토리가 이름이 겹쳐 혼동 가능 — 네임스페이스 분리 필요 (예: 신규는 `.claude/harness/goal-cycles/<id>/`)

## P1 — Persona × Skill 매핑 구현

- [ ] `skill_hints` 매핑 테이블을 코드/문서 어디에 둘지 결정 (spec §4 표를 `harness/skills/` 내부 reference 파일로 승격할지)
- [ ] Executor 프롬프트에 "skill_hints에 있는 skill을 invoke하라"는 지시를 Agent 호출 시 명시적으로 주입
- [ ] Critic/Verifier가 쓰는 기존 skill(`think:devils-advocate`, `completion:verification-before-completion`, `write:writer-verification`)이 subagent 컨텍스트에서도 Skill tool로 정상 invoke되는지 확인 (서브에이전트가 Skill tool 접근 가능한지 검증 필요 — agents 문서 확인)

## P1 — 기존 harness와의 통합 지점

- [ ] `harness:cycle`의 RFC/Design Doc/ADR 작성 단계에 Critic(devils-advocate) 검증 끼워넣기 — `--confirm-user` 게이트 *통과 전에* Critic agent가 독립적으로 한 번 검토 (spec §2 결정#10, 실사용 중 발견된 gap: 현재 RFC는 검증 단계 자체가 없고, Design Doc/ADR은 사용자 확인만 있을 뿐 독립 agent 점검이 없음)
- [ ] `harness:cycle`이 phase-guard로 코드 수정을 막는 것과, 신규 `harness:run`의 Executor가 실제로 파일을 쓰는 것 사이의 권한 충돌 검토 (`phase-guard.py`, `active-symlink-guard.py`)
- [ ] `phase-advance.py`와 신규 goal 상태머신(`pending|running|passed|failed`)의 관계 정의 — 별개로 두는지, goal 완료가 cycle phase 전진의 evidence가 되는지
- [ ] README/마켓플레이스 설명에 신규 흐름 반영 여부 결정 (`INSTRUCT.md` 업데이트 워크플로우 따라 버전 bump)

## P2 — 문서/버전

- [ ] `marketplace.json`의 `harness` 플러그인 description에 신규 capability 반영, patch/minor bump 판단 (신규 skill 3개 추가는 기존 컨벤션상 minor bump 후보)
- [ ] `harness/README.md` Skills 표에 `interview`/`goals`(or 확정명)/`run` 추가
- [ ] 기존 `00-overview.md` 등 concept 문서에 "Section 14: Goal decomposition + Team + Verification" 추가 여부 결정 (문서 12개 체계와의 정합성)

## 확정된 결정 (2026-06-17)

- [x] Skill 이름: `harness:goals` (goal 분해 전용, 기존 `harness:plan`과 분리)
- [x] Critic revise 루프: 3회 (Verifier와 통일)

## 확정된 결정 (2026-06-18)

- [x] RFC/Design Doc/ADR 자체 검증 gap → Critic 재사용으로 보강 (spec §2 결정#10, 신규 역할 추가 없음)
