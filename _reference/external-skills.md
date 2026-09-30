# External Skills

외부 스킬 후보 모음 (2026-09-30 조사). 설치 전 SKILL.md와 스크립트를 직접 확인할 것.

## 선정

- https://github.com/sanjay3290/ai-skills/tree/main/skills/notebooklm — Google NotebookLM 조회·관리, 소스 동기화
- https://github.com/fractalmind-ai/agent-manager-skill — tmux로 여러 로컬 CLI 에이전트 시작·감시·작업 배정
- https://github.com/mattjoyce/kanban-skill — 마크다운 파일 기반 칸반 보드 (DB 없음)
- https://github.com/conorbronsdon/avoid-ai-writing — 21종 AI 문체 패턴을 찾아내 고쳐 씀

## agent-almanac

https://github.com/pjt222/agent-almanac — 스킬 373개, 에이전트 76개, 팀 22개. 대부분 관련 없는 분야(R, 화학, 등산 등).

- [coordinate-peer-sessions](https://github.com/pjt222/agent-almanac/tree/main/skills/coordinate-peer-sessions) — 한 git 작업 트리를 두 세션이 쓸 때 경로 선언, 인덱스 잠금 충돌 처리, 분업
- [write-continue-here](https://github.com/pjt222/agent-almanac/tree/main/skills/write-continue-here) — 세션 인계 파일 작성
- [read-continue-here](https://github.com/pjt222/agent-almanac/tree/main/skills/read-continue-here) — 세션 시작 시 인계 파일을 읽고 이어서 진행
- [memex](https://github.com/pjt222/agent-almanac/tree/main/skills/memex) — 세션 간 공유 메모리 (MCP + pgvector)
- [prune-agent-memory](https://github.com/pjt222/agent-almanac/tree/main/skills/prune-agent-memory) — 메모리 점검·분류, 보존 정책에 따라 선택 삭제
- [manage-token-budget](https://github.com/pjt222/agent-almanac/tree/main/skills/manage-token-budget) — 컨텍스트·API 비용 누적 감시, 상한, 복구
- [verify-agent-output](https://github.com/pjt222/agent-almanac/tree/main/skills/verify-agent-output) — 에이전트 간 인계물을 증거 기록과 함께 검증
- [evolve-skill-from-traces](https://github.com/pjt222/agent-almanac/tree/main/skills/evolve-skill-from-traces) — 실행 기록 기반으로 여러 에이전트가 SKILL.md 수정안을 내고 충돌 없이 병합
- [review-skill-format](https://github.com/pjt222/agent-almanac/tree/main/skills/review-skill-format) — SKILL.md의 agentskills.io 표준 준수 검사
- [unleash-the-agents](https://github.com/pjt222/agent-almanac/tree/main/skills/unleash-the-agents) — 가용 에이전트 전체로 단계별 가설 병렬 생성
- [choose-loop-wakeup-interval](https://github.com/pjt222/agent-almanac/tree/main/skills/choose-loop-wakeup-interval) — ScheduleWakeup 대기 시간을 캐시 고려해 선택
- [stale-proof-rendered-numbers](https://github.com/pjt222/agent-almanac/tree/main/skills/stale-proof-rendered-numbers) — 표시 수치를 렌더링 시점에 원본에서 가져오고, 키 누락 시 빌드 실패
- [run-copilot-review-loop](https://github.com/pjt222/agent-almanac/tree/main/skills/run-copilot-review-loop) — Copilot PR 리뷰가 깨끗해질 때까지 수정·답글·해결·재요청 반복
- [harden-github-repo-security](https://github.com/pjt222/agent-almanac/tree/main/skills/harden-github-repo-security) — 저장소 보호 단계별 적용 (규칙 세트, 시크릿 스캔, Dependabot 등)
- [guides](https://github.com/pjt222/agent-almanac/tree/main/guides) — 사람용 가이드 35편 (워크플로 작성, 에이전트·팀 구성 등)

## openpaw

https://github.com/daxaur/openpaw — 개인 비서용 스킬 38개, macOS CLI 기반. `npx pawmode`로 설치.

- [c-briefing](https://github.com/daxaur/openpaw/tree/main/skills/c-briefing) — 아침 메일·일정·할 일·날씨 요약, 예약 실행
- [c-obsidian](https://github.com/daxaur/openpaw/tree/main/skills/c-obsidian) — Obsidian 볼트를 영구 메모리로 사용
- [c-research](https://github.com/daxaur/openpaw/tree/main/skills/c-research) — URL, PDF, 유튜브, 팟캐스트 요약
- [c-secrets](https://github.com/daxaur/openpaw/tree/main/skills/c-secrets) — 1Password·Bitwarden CLI로 시크릿 조회 (화면에 표시 안 함)
- [c-cron](https://github.com/daxaur/openpaw/tree/main/skills/c-cron) — cron, macOS launchctl 작업 관리
- [c-screen](https://github.com/daxaur/openpaw/tree/main/skills/c-screen) — 스크린샷, OCR로 화면 분석
- [c-lockin](https://github.com/daxaur/openpaw/tree/main/skills/c-lockin) — 집중 모드 (방해 차단, 환경 세팅, 세션 기록)

## agentskill.sh

https://agentskill.sh — 스킬 27만 개 이상 카탈로그. 목록이 JS 렌더링이라 개별 추출 못 함; 직접 검색.

- 설치 CLI: `npx @agentskill.sh/cli@latest setup`
- 스킬 묶음: https://agentskill.sh/skillsets

## 출처 목록

- https://github.com/BehiSecc/awesome-claude-skills
- https://github.com/travisvn/awesome-claude-skills
- https://github.com/ComposioHQ/awesome-claude-skills
- https://github.com/quemsah/awesome-claude-plugins
