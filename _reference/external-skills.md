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

https://agentskill.sh — 스킬 27만 개 이상 카탈로그.

- 설치 CLI: `npx @agentskill.sh/cli@latest setup`
- 스킬 묶음: https://agentskill.sh/skillsets
- 직군별 목록: `https://agentskill.sh/for/<직군>`. JSON은 `https://agentskill.sh/api/skills?category=<직군>&page=N` (페이지당 20개, 스타순 고정, 정렬 옵션 없음)

2026-10-06 조사: 6개 직군(development, product, operations, project-management, support, hr)에서 각각 상위 200개, 중복 제거 후 929개. 품질점수 85 이상만 남기고 openclaw·feishu·qqbot 같은 저장소 전용 스킬과 같은 스킬의 복제본, 이미 설치된 외부 중복 스킬은 뺐다.

### HR

- [job-post-builder](https://github.com/anthropics/knowledge-work-plugins/tree/HEAD/small-business/skills/job-post-builder) — 채용 요청서 하나로 공고, 채점 기준이 붙은 면접 가이드, 오퍼레터 초안까지 작성
- [engineering-hiring-rubric](https://github.com/mohitagw15856/pm-claude-skills/tree/HEAD/plugins/pm-engineering/skills/engineering-hiring-rubric) — 레벨별 엔지니어 채용 기준표와 기술 면접 채점표
- [onboarding-plan](https://github.com/mohitagw15856/pm-claude-skills/tree/HEAD/plugins/pm-hr/skills/onboarding-plan) — 신규 입사자 30/60/90일 온보딩 계획
- [team-health-check](https://github.com/mohitagw15856/pm-claude-skills/tree/HEAD/plugins/pm-people/skills/team-health-check) — 여러 항목으로 팀 상태를 점검하는 진단 진행
- [team-composition-analysis](https://github.com/wshobson/agents/tree/HEAD/plugins/startup-business-analyst/skills/team-composition-analysis) — 초기 스타트업 조직 구조, 채용 계획, 보상·지분 설계
- [change-management](https://github.com/LeoYeAI/openclaw-master-skills/tree/HEAD/skills/c-level-advisor/change-management) — 스타트업용 ADKAR, 공지 템플릿, 저항 유형별 대응
- [difficult-workplace-conversations](https://github.com/softaworks/agent-toolkit/tree/HEAD/dist/plugins/difficult-workplace-conversations/skills/difficult-workplace-conversations) — 갈등, 성과 면담, 어려운 피드백을 준비·전달·후속 단계로 진행
- [resume-quantifier](https://github.com/davila7/claude-code-templates/tree/HEAD/cli-tool/components/skills/career/resume-quantifier) — 정확한 데이터가 없을 때 성과 수치를 추정해 이력서에 넣음
- [offer-comparison-analyzer](https://github.com/davila7/claude-code-templates/tree/HEAD/cli-tool/components/skills/career/offer-comparison-analyzer) — 여러 오퍼의 총보상(연봉, 지분, 복지) 비교

### Support

- [ticket-deflector](https://github.com/anthropics/knowledge-work-plugins/tree/HEAD/small-business/skills/ticket-deflector) — 고객 문의를 읽고 PayPal 주문·환불 상태와 HubSpot 이력을 조회해 답장 초안 작성
- [synthesize-research](https://github.com/anthropics/knowledge-work-plugins/tree/HEAD/product-management/skills/synthesize-research) — 인터뷰·설문·문의 내용을 구조화된 인사이트로 정리
- [incident-runbook-templates](https://github.com/wshobson/agents/tree/HEAD/plugins/incident-response/skills/incident-runbook-templates) — 장애 대응 런북 (절차, 에스컬레이션, 복구)
- [on-call-handoff-patterns](https://github.com/wshobson/agents/tree/HEAD/plugins/incident-response/skills/on-call-handoff-patterns) — 온콜 교대 시 맥락 인계와 기록
- [gh-review-requests](https://github.com/sickn33/antigravity-awesome-skills/tree/HEAD/plugins/antigravity-awesome-skills-claude/skills/gh-review-requests) — 내 팀에 리뷰 요청이 온 열린 PR을 GitHub 알림에서 추림
- [jira](https://github.com/davila7/claude-code-templates/tree/HEAD/cli-tool/components/skills/ai-research/jira) — Jira 이슈 조회·생성·수정, 스프린트 상태 확인

### Project management

- [product-capability](https://github.com/affaan-m/everything-claude-code/tree/HEAD/.agents/skills/product-capability) — PRD·로드맵 요청을 제약, 불변식, 인터페이스, 미결 사항이 드러난 구현 계획으로 바꿈
- [project-flow-ops](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/project-flow-ops) — GitHub 이슈·PR 분류와 Linear 작업 연결
- [task-coordination-strategies](https://github.com/wshobson/agents/tree/HEAD/plugins/agent-teams/skills/task-coordination-strategies) — 작업 분해, 의존성 그래프, 멀티 에이전트 작업 배분
- [parallel-feature-development](https://github.com/wshobson/agents/tree/HEAD/plugins/agent-teams/skills/parallel-feature-development) — 파일 소유권으로 충돌을 피하며 기능을 병렬 개발
- [orchestrate-batch-refactor](https://github.com/sickn33/antigravity-awesome-skills/tree/HEAD/skills/orchestrate-batch-refactor) — 대규모 리팩터링을 의존성 기준 작업 묶음으로 나눠 병렬 진행
- [final-release-review](https://github.com/openai/openai-agents-python/tree/HEAD/.agents/skills/final-release-review) — 직전 릴리스 태그와 비교해 breaking change 등 출시 전 위험 점검
- [postmortem-writing](https://github.com/wshobson/agents/tree/HEAD/plugins/incident-response/skills/postmortem-writing) — 비난 없는 포스트모템 (원인 분석, 타임라인, 후속 조치)
- [doc-coauthoring](https://github.com/anthropics/skills/tree/HEAD/skills/doc-coauthoring) — 제안서·기술 명세·결정 문서 공동 작성 절차
- [think-tank](https://github.com/davila7/claude-code-templates/tree/HEAD/cli-tool/components/skills/productivity/think-tank) — 설계·전략 결정 전에 여러 페르소나가 토론
- [cto-advisor](https://github.com/davila7/claude-code-templates/tree/HEAD/cli-tool/components/skills/business-marketing/cto-advisor) — 기술 리더십 조언, 기술 부채 분석, 팀 확장 계산

### Operations

- [automation-audit-ops](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/automation-audit-ops) — 고치기 전에 작업, 훅, 커넥터, MCP 서버가 살아 있는지, 깨졌는지, 겹치는지 목록화
- [sop-writer](https://github.com/mohitagw15856/pm-claude-skills/tree/HEAD/plugins/pm-operations/skills/sop-writer) — 표준 운영 절차서(SOP) 작성
- [aws-cost-optimizer](https://github.com/sickn33/antigravity-awesome-skills/tree/HEAD/skills/aws-cost-optimizer) — AWS CLI와 Cost Explorer로 비용 분석·절감안
- [ai-native-cli](https://github.com/sickn33/antigravity-awesome-skills/tree/HEAD/plugins/antigravity-awesome-skills-claude/skills/ai-native-cli) — 에이전트가 안전하게 쓰는 CLI 설계 규칙 98개 (JSON 출력, 오류, 입력 계약, 안전장치)
- [logistics-exception-management](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/logistics-exception-management) — 화물 지연·파손·분실, 운송사 분쟁 처리
- [inventory-demand-planning](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/inventory-demand-planning) — 다점포 수요 예측, 안전재고, 보충 계획
- [returns-reverse-logistics](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/returns-reverse-logistics) — 반품 승인, 검수, 처분, 환불, 보증 클레임

### Product

- [agent-architecture-audit](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/agent-architecture-audit) — LLM 앱 12계층 진단 (래퍼 회귀, 메모리 오염, 도구 사용 규율 등)
- [workspace-surface-audit](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/workspace-surface-audit) — 저장소, MCP, 플러그인, 하네스 설정을 점검하고 추가할 스킬·훅 추천
- [gateguard](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/gateguard) — 파일 수정·Bash 실행 전 조사(호출부, 스키마, 사용자 지시)를 강제하는 게이트
- [production-audit](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/production-audit) — 저장소 밖으로 데이터를 보내지 않는 출시 준비 점검 (보안점수 65)
- [one-three-one-rule](https://github.com/NousResearch/hermes-agent/tree/HEAD/optional-skills/communication/one-three-one-rule) — 문제 1개, 선택지 3개, 추천 1개로 기술 제안 정리
- [market-research](https://github.com/affaan-m/everything-claude-code/tree/HEAD/.cursor/skills/market-research) — 시장·경쟁 조사, 출처 표기, 의사결정용 요약
- [dashboard-builder](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/dashboard-builder) — 운영자가 실제로 묻는 질문에 답하는 Grafana·SigNoz 대시보드
- [mcp-server-patterns](https://github.com/affaan-m/everything-claude-code/tree/HEAD/.agents/skills/mcp-server-patterns) — Node/TS SDK로 MCP 서버 작성 (stdio, Streamable HTTP)

### Development

- [terminal-ops](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/terminal-ops) — 명령 실행, CI 실패 디버깅, 좁은 수정 푸시를 증거 우선으로 진행
- [agent-introspection-debugging](https://github.com/affaan-m/everything-claude-code/tree/HEAD/.agents/skills/agent-introspection-debugging) — 에이전트 실패를 포착, 진단, 제한된 복구, 보고 순서로 자가 디버깅
- [security-review](https://github.com/affaan-m/everything-claude-code/tree/HEAD/.agents/skills/security-review) — 인증, 입력 처리, 시크릿, 결제 기능 보안 점검 목록 (보안점수 62)
- [postgresql-code-review](https://github.com/github/awesome-copilot/tree/HEAD/plugins/database-data-management/skills/postgresql-code-review) — PostgreSQL 전용 코드 리뷰 (JSONB, 배열, 안티패턴)
- [kotlin-coroutines-flows](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/kotlin-coroutines-flows) — 구조적 동시성, Flow 연산자, StateFlow, 테스트
- [make-interfaces-feel-better](https://github.com/affaan-m/everything-claude-code/tree/HEAD/skills/make-interfaces-feel-better) — 간격, 타이포그래피, 모션 등 UI 마감 디테일

## 출처 목록

- https://github.com/BehiSecc/awesome-claude-skills
- https://github.com/travisvn/awesome-claude-skills
- https://github.com/ComposioHQ/awesome-claude-skills
- https://github.com/quemsah/awesome-claude-plugins
