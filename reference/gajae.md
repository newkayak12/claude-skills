# Gajae-Code 비교 — 일치점 / 차이점

비교 대상: [Yeachan-Heo/gajae-code](https://github.com/Yeachan-Heo/gajae-code) (`gjc`) vs 이 레포의 `harness/` + 신규 설계(`docs/superpowers/specs/2026-06-17-gajae-style-team-ledger-design.md`)

## 일치점

| 개념 | gajae-code | 우리 harness |
|---|---|---|
| 인터뷰 단계 | `deep-interview` — Socratic 질문 + ambiguity scoring, `.gjc/specs/`에 spec 작성 | `harness:interview` — Planner agent가 Socratic 질문, `.claude/harness/specs/`에 spec 작성 |
| 합의 기반 계획 | `ralplan` — Planner/Architect/Critic 합의 루프, `pending approval`로 게이트 | `harness:plan` — Planner 분해 + Critic 검토, 승인 전 실행 금지 |
| 다단계 실행 원장 | `ultragoal` — goal을 작은 단위로 쪼개 사이클당 실행, `goals.json` + `ledger.jsonl`로 영속 | 동일 패턴 — `goals.json` + per-goal `cycles/<id>/` 디렉토리로 영속 |
| 역할 기반 실행 | 4개 role agent: `planner / architect / executor / critic`, 각자 read-only 경계 명확 | 4개 persona: `Planner / Critic / Executor / Verifier`, Critic·Verifier는 read-only |
| 계획-실행 경계 | "명시적 승인 전에는 mutation 금지" (`Planning/Execution Boundary`) | 동일 — Critic 승인 전 Executor 미실행 |
| 실패 시 처리 | `checkpoint --status failed --evidence` | 3회 verifier 실패 → `status: failed` + blocker evidence, 사용자에게 보고 |
| 격리 실행 | tmux 기반 worker (`team` skill, `.gjc/state/team/`) | Claude Code `Agent`/`agent()` 기반 독립 context (파일시스템 격리 아님) |

## 차이점

| 항목 | gajae-code | 우리 harness | 이유 |
|---|---|---|---|
| 설치 방식 | `bun install -g gajae-code`, 별도 CLI(`gjc`) 바이너리 | Claude Code skill plugin, marketplace install | 사용자가 bun 설치 단계를 명시적으로 제외 요청 |
| 실행 런타임 | tmux 창 분기 + 실제 OS 프로세스 worker | `Workflow` tool의 `pipeline()` — Claude Code 세션 내부 | tmux/CLI 불필요, 세션 안에서 완결 원함 |
| 격리 단위 | 파일시스템 worktree 또는 tmux pane | **context만 격리** (worktree 명시적으로 거부됨) | "격리된 context를 가지는 환경"이라는 사용자의 정정 |
| Architect 역할 | 코드/아키텍처 리뷰에 한정 | `Critic`으로 대체, 도메인 중립 (코드 구조 *및* 글의 논리 구조 모두 검토) | 이 레포가 개발 + 테크니컬 라이팅을 모두 다루기 때문 |
| Executor 스킬 선택 | gjc 내부 프롬프트에 고정 | 이 레포의 기존 skill 목록(`develop:*`, `write:*`, `pm:*` 등)에서 goal 유형별로 `skill_hints` 매핑 | 레포에 이미 100+ skill이 있어 재사용이 핵심 가치 |
| 검증 기준 | 명시적 3단계 분리 없음 (ledger에 evidence 기록 위주) | acceptance criteria / plan-adherence / work-product를 **3개 독립 레이어로 명시** | 사용자가 인터뷰에서 명확히 3가지로 분리 요구 |
| 기존 자산과의 관계 | 해당 없음 (gjc는 처음부터 신규 제품) | 기존 `harness/skills/{install,cycle,plan,work,review}` 위에 **추가 레이어**로만 적용 (대체 아님) | Option B 선택 — 흡수 아니라 보강 |
| 패키지/배포 단위 | npm 패키지(`gajae-code`, `@gajae-code/coding-agent`) | 레포 내 plugin (`harness/`), marketplace.json으로 버전 관리 | 이 레포의 기존 배포 컨벤션 |
| 다중 worker 동시성 | tmux pane 수에 따라 OS 레벨 동시 실행 | `Workflow`의 `pipeline()`/`parallel()` — 토큰/agent 수 캡(워크플로우당 동시 16개) 내에서 동시 실행 | 플랫폼 제약, tmux 없음 |

## 추가로 가져온 것 (2026-06-18, 실사용 중 발견)

기존 `harness:cycle`의 RFC/Design Doc/ADR 작성 단계를 다시 보니, "검증 = 사용자 확인(`--confirm-user`)"뿐이고 독립 agent의 자체 점검이 빠져 있었다 — RFC는 검증 단계 자체가 없고, Design Doc/ADR은 `draft → review → finalize` 게이트가 있지만 그 review가 사용자 본인 검토일 뿐이다. 이건 §1에서 지적한 "문서만 만들고 self-verification이 없다"는 문제가 새 goal 실행 흐름 바깥, 기존 cycle 안에도 그대로 있다는 뜻이다.

→ 새 역할을 만들지 않고 기존 Critic persona를 재사용해, `harness:cycle` Design phase의 `--confirm-user` 게이트 **이전에** 한 단계를 끼워 넣는다: Critic이 RFC/Design Doc/ADR 초안을 devils-advocate 관점으로 독립 검토하고, 그 결과를 초안에 첨부한다. 사용자 확인 게이트는 그대로 유지하되, 사용자는 이제 "이미 한 번 비판받은 초안"을 보게 된다. 새 레이어가 `harness:cycle`에 직접 손대는 유일한 지점이며, cycle/plan/work/review의 나머지는 그대로 둔다 (spec §2 결정#10).

## 의도적으로 가져오지 않은 것

- `gjc team` 명령어 자체나 tmux pane 조작 — 우리는 `Agent`/`Workflow`로 대체.
- `.gjc/` 네이밍 — 우리는 `.claude/harness/`를 그대로 사용 (기존 harness delivery model과 일치).
- bun/npm 설치 흐름 — marketplace plugin install로 대체.
