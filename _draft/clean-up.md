# 청소 대상 (clean-up targets)

작성일: 2026-07-08
기준: 등록된 플러그인 14개 (`develop, technique-write, pm, think, write, agents, planning, skill, completion, portfolio, leadership, cognition, self, harness`) 외의 잔여물 위주.

---

## 1. 중복 / 폐기(deprecated) 스킬 — 삭제 검토

| 대상 | 상태 | 조치 |
|------|------|------|
| `skill/skills/skill-validator/` | description에 `(deprecated — prefer skill-quality-assurance)` 명시됨. skill-quality-assurance가 상위호환. | 삭제 → marketplace `skill` 플러그인 설명·버전 갱신 |
| `portfolio/skills/portfolio-feedback/` | `portfolio-feedback-v2`가 대체. 두 스킬이 동시에 노출됨. | v1 삭제(또는 _deprecated 이동), v2를 정식화 |

## 2. 상위 레벨 잔여 디렉터리 — 플러그인 아님

| 대상 | git 추적 | 내용 | 조치 |
|------|:--------:|------|------|
| `_deprecated/harness-v0/` | 추적됨(77 files) | 구 harness. 현재 `harness` v1.0.0 릴리스로 대체됨. | 히스토리에 남아있으니 삭제 검토 (git log로 복구 가능) |
| `_draft/harness-engineering/` | 추적됨(272 files) | harness 설계/사이클 초안. v1.0.0 출시로 대부분 소진. | 살아있는 문서만 `harness/`로 승격, 나머지 삭제 |
| `docs/superpowers/specs/` | 추적됨 | gajae 팀-레저 설계 문서 1건. | 반영 완료 여부 확인 후 보관/삭제 |
| `reference/gajae.md`, `todo/gajae.md` | 추적됨 | gajae 작업 메모(반영 완료로 추정). | 소진 확인 후 삭제 |
| `cycles/` | 비어있음(untracked) | 빈 디렉터리. | 삭제 |
| `plan/`, `report/` | .gitignore 처리됨 | 오래된 작업물(4월). 디스크에만 존재. | 로컬 정리 |

## 3. 빌드/작업 산출물 — 추적에서 제외

| 대상 | 문제 | 조치 |
|------|------|------|
| `scripts/__pycache__/` | 파이썬 캐시. .gitignore에 `__pycache__/` 있으나 실디렉터리 잔존. | 로컬 삭제 |
| `portfolio/skills/portfolio-feedback-workspace/` | `*-workspace` gitignore 패턴 산출물. | 로컬 삭제 |

## 4. 문서 정합성(stale reference) — 수정

| 위치 | 문제 | 조치 |
|------|------|------|
| `CLAUDE.md:52` | `See \`skill/skills/writing-skills/SKILL.md\`` — writing-skills는 현재 `write/skills/writing-skills/`로 이동됨. 경로 깨짐. | `write/skills/writing-skills/SKILL.md`로 수정 |

---

## 우선순위 제안
1. **P0 (사용자 혼란)**: §1 중복 스킬 2건 — 노출되는 스킬이라 즉시 제거 효과 큼.
2. **P1 (정합성)**: §4 CLAUDE.md 경로 수정.
3. **P2 (리포 다이어트)**: §2 `_deprecated`, `_draft/harness-engineering` — 커밋 히스토리로 복구 가능하므로 안전.
4. **P3 (로컬)**: §3 캐시/워크스페이스 산출물.

> 참고: §1·§2 삭제 시 `.claude-plugin/marketplace.json` 버전 bump + 해당 `<plugin>/README.md` 갱신 필요 (CLAUDE.md Update Workflow).
