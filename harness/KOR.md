# harness — 한국어

[English](README.md) · **한국어**

큰 요청을 위한 **추론 바닥선(floor)** 입니다. 품질의 천장을 올리는 도구가 아니라, 모든 요청을
여섯 단계 역할로 통과시켜 **반복**과 **기준 미달 답변**을 걸러내는 필터예요. 판정자와 실행자를
분리하는 게 핵심입니다. 계획과 판정은 Opus로 고정하고, 코드 실행과 결정론적 검증은 로컬 Codex
CLI가 있으면 그쪽으로 라우팅합니다.

```
Plan(opus) → SetGoal(opus) → Implement(Codex 사용 시) → Test(Codex 사용 시) → QualityGate(opus, loop) → Report(sonnet)
```

프로젝트가 원하는 경로를 건드리기 전에 하네스 사용을 요구할 수 있도록, opt-in PreToolUse 편집
게이트도 함께 제공합니다.

## 설치 / 제거

```bash
/plugin install harness@newkayak12-claude-skills
/plugin uninstall harness@newkayak12-claude-skills
```

마켓플레이스 설치만으로는 아무것도 강제되지 않습니다 — 스킬이 쓸 수 있게 될 뿐이에요. 대상
프로젝트 안에서 `install` 스킬을 돌려야 거버넌스가 상시화됩니다
([프로젝트에 설치하기](#프로젝트에-설치하기) 참고).

## 오케스트레이션 경로

| 경로 | 언제 | 어떻게 |
|---|---|---|
| **그래프 (기본)** | `graph-engineering` MCP 연결됨 | `graph:orchestrate` — 그래프 엔진이 흐름을 소유하고, 메인 세션은 `graph_next` / `graph_run` / `graph_submit` 루프만 돕니다. 전송용 서브에이전트도, 폴링도 없습니다. |
| Workflow 엔진 | 그래프 MCP 없음, Workflow 도구 있음 | `Workflow({ scriptPath: "harness/engine/pipeline.js", ... })` |
| 에이전트 팀 | 둘 다 없음 | `engine/fallback.md` |

그래프 엔진이 생긴 이유: Workflow 경로는 CLI를 Bash로 몰기 위해 Implement/Test 노드마다 서브에이전트를 하나씩 써야 했고, 프로세스를 기다리는 서브에이전트는 폴링밖에 못 합니다. 실측 한 번에서 전송 계층이 추론 계층보다 비쌌습니다(입력 토큰 6.87M vs 2.06M, 전송 계층의 편집은 0건). `graph/README.md` 참고.

## 어떤 스킬을 쓰나

| 하고 싶은 것 | 스킬 |
|---|---|
| 큰 요청을 계획·실행·검증·게이트까지 거쳐서 받고 싶다 | `harness` |
| 기본 그래프 오케스트레이션 경로를 연결하거나 확인하고 싶다 | `graph:install` |
| 프로젝트에 게이트·훅·컨벤션·CLAUDE.md 블록을 심고 싶다 | `install` |
| 프로젝트에서 하네스 거버넌스를 걷어내고 싶다 | `remove` |
| 하네스 플러그인 소스의 패치 릴리스를 준비하고 싶다 | `patch` |
| 설치 형태와 무관하게 Implement/Test를 로컬 Codex CLI에 위임하고 싶다 | `codex-control` |

## 스킬

### `harness`

엔진 진입점입니다. 원문 요청을 `engine/pipeline.js`에 그대로 넘기면, 엔진이 스스로 계획을 세우고
goal-spec을 작성·비평한 뒤, 각 subgoal을 스킬이 붙은 실행자로 처리하고, 별도의 Test 에이전트가
결정론적으로 검증하고, subgoal 단위와 전체 결과물 양쪽을 게이트한 다음 리포트를 씁니다.
"그럴듯한" 게 아니라 "검증된" 결과가 필요할 때 쓰세요. 사소한 수정이나 단순 질문에는 쓰지
마세요 — 여섯 단계 비용이 답변 가치보다 큽니다.

```
하네스 돌려줘: 주문 동기화 잡이 업스트림 페이지 크기가 바뀌면 행을 조용히 흘려. 제대로 고치고
각 부분 독립적으로 검증한 다음 보고해줘.
```

기본 모드 B 호출:

```js
Workflow({ scriptPath: "harness/engine/pipeline.js", args: {
  request: "<요청 원문>",
  context: "<선택: 알고 있는 제약>",
  max_retries: 2,
  codex_provider: "off"      // default "off"; "auto" | "required" opt in to Codex
}})
```

`report`, `all_passed`, `failed[]`, `goal_gate`를 돌려주고, 실패도 숨기지 않고 그대로 전달합니다.
엔진이 항상 물리는 세 스킬(Plan의 `agents:agent-task-decomposer`, 스펙 비평·QualityGate의
`think:devils-advocate`, Test의 `completion:verification-before-completion`) 외에, SetGoal이
필요하면 하네스 대응 스킬(`write:writing-plans`, `planning:executing-plans`,
`agents:subagent-driven-development`, `develop:test-driven-development`, `write:writing-skills`,
`agents:dispatching-parallel-agents`, `think:brainstorming`)을 subgoal에 매핑할 수 있습니다.
전부 선택이고, 하나도 안 써도 정상 실행입니다.

### `install`

플러그인이 계속 깔려 있지 않아도 강제가 유지되도록, 프로젝트가 소유하는 하네스 거버넌스 파일을
스캐폴딩합니다. 판단(게이트 패턴, 임베드 여부, 컨벤션, CLAUDE.md 블록)은 스킬이 맡고, 결정론적인
파일 작업은 `install.mjs`가 처리합니다. 전부 멱등이고 비파괴적이라 기존 파일은 `kept`로 보고될
뿐 덮어쓰지 않습니다. 엔진 실행은 이 스킬이 아니라 `harness` 스킬입니다.

```
이 프로젝트에 하네스 설치하고 게이트 켜줘 — Kotlin 소스만 게이트 대상으로.
```

```sh
node "<plugin>/skills/install/install.mjs" '{
  "projectDir": "<프로젝트 루트 절대경로>",
  "gate": { "patterns": ["src/.*\\.kt$"], "window_hours": 2 },
  "embed": { "runtime": true, "skills": [ { "name": "...", "src": "<abs>" } ] }
}'
```

`gate`를 빼면 게이트 파일을 안 쓰고, `embed`를 빼면 standalone 임베드를 건너뜁니다. 플러그인
버전을 올린 뒤에는 `"refresh": true`로 다시 실행하세요 — 플러그인 소유 파일(`goal-gate.mjs`,
`.claude/harness/**`)만 다시 복사하고, 게이트·컨벤션·CLAUDE.md·`settings.json`은 건드리지 않습니다.

### `remove`

프로젝트에 설치된 하네스 거버넌스를 걷어냅니다: 훅, `settings.json` 등록,
`.claude/harness-gate.json`, `.claude/harness/`, `.claude/.harness-markers/`, CLAUDE.md의 펜스
블록, `.gitignore` 한 줄. `.claude/conventions/`는 프로젝트 소유라 **기본적으로 보존**되고, 지우려면
명시적 확인이 필요합니다. 깨진 `settings.json`이나 짝이 안 맞는 CLAUDE 마커는 완료를 억지로
만들려고 통째로 지우지 않고, 그대로 두고 수동 정리 대상으로 보고합니다.

```
이 프로젝트에서 하네스 지워줘. 단 .claude/conventions/ 는 우리가 고친 거라 남겨줘.
```

```sh
node "<plugin>/skills/remove/remove.mjs" '{
  "projectDir": "<프로젝트 루트 절대경로>",
  "purgeConventions": false
}'
```

멱등합니다 — 두 번째 실행은 실패가 아니라 `absent`로 보고합니다.

### `patch`

하네스 플러그인 **소스**의 패치 릴리스를 준비합니다. 두 매니페스트의 `x.y.Z`를 올리고 Status
로그 맨 위에 한 줄짜리 노트를 넣어요. 이 마켓플레이스 체크아웃용이지, 애플리케이션 프로젝트에
설치된 파일을 갱신하는 용도가 아닙니다. 기능/브레이킹 릴리스에도 쓰지 마세요 — 그건 minor/major를
직접 올려야 합니다.

```
하네스 패치 릴리스 준비해줘 — 이번 diff 요약해서 Status에 한 줄 넣고 버전 올려줘.
```

```sh
node "<plugin>/skills/patch/patch.mjs" '{
  "repoRoot": "<claude-skills 체크아웃 절대경로>",
  "summary": "<간결한 status 한 줄>",
  "dryRun": true
}'
```

먼저 dry-run으로 이전/다음 버전을 확인하고, 그다음 `"dryRun": false`로 다시 돌립니다. 플러그인과
마켓플레이스 버전이 다르거나, Status 헤딩이 없거나, summary가 비었거나 여러 줄이면 쓰기를
거부합니다. 건드리는 파일:

| 파일 | 변경 |
|---|---|
| `harness/.claude-plugin/plugin.json` | `version` 패치 증가 |
| `.claude-plugin/marketplace.json` | `harness` 항목의 `version` |
| `harness/README.md` | `## Status`의 새 첫 항목 |

### `codex-control`

Codex를 쓰는 Implement/Test 단계가 사용하는 어댑터 탐색 규약입니다. 프로젝트가
`.claude/harness/**`를 임베드했다고 가정하지 않고도 위임이 되게 해줍니다. 존재하는 첫
`codex-exec-adapter.mjs`를 찾아 쓰고, 하나도 없으면 Codex 사용 불가로 기록한 뒤 평소의 Claude
경로로 계속 진행합니다.

```
Implement 단계에서 plugin 모드로 Codex 돌려야 해 — 어댑터부터 찾아줘.
```

탐색 순서:

| # | 형태 | 경로 |
|---|---|---|
| 1 | 명시 인자 | `args.codex_adapter_path` |
| 2 | repo-local | `harness/engine/codex-exec-adapter.mjs` |
| 3 | 임베드 설치 | `.claude/harness/engine/codex-exec-adapter.mjs` |
| 4 | plugin 모드 | 프로젝트 CLAUDE.md Harness 블록의 `scriptPath`에서 유도 |

실행 규약: 위임 전에 반드시 `--detect`, Implement와 Test는 **별개** Codex 프로세스, Implement는
`--sandbox workspace-write` 사용 가능, Test 프롬프트는 검증 전용이라 구현 파일을 고쳐서도 안 되고
명령/파일 증거 없이 Implement의 서술을 믿어서도 안 됩니다.

## 동작 방식

1. **원문 요청을 그대로 넘깁니다.** `Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: "..." } })`
2. **엔진이 직접 계획하고 goal-spec을 작성합니다** (Opus + 적대적 비평 패스). 그래서 스펙 품질이
   메인 세션 모델에 좌우되지 않습니다. 스키마: [`goal-spec.md`](goal-spec.md).
3. **각 subgoal은 Implement → Test → QualityGate를 반복합니다** (`max_retries`로 상한):
   실행자는 이 저장소의 스킬을 부르고, 별도 Test 에이전트가 명령을 돌리고 산출물을 읽어
   결정론적 증거를 만들고, 별도 Opus 판정자가 그 증거로만 게이트합니다.
4. **goal 레벨 게이트가 조립된 전체를 목표 대비로 채점합니다** (0-100 `match_pct`, 통과 기준
   90% 이상. 미달이면 리페어 패스 후 재게이트) — 그다음 Report 단계가 종합합니다.

`codex_provider: "auto"` 또는 `"required"`면 모든 Implement/Test 단계의 **기본** 경로가 Codex입니다.
최소한의 Sonnet 컨트롤러가 `codex-control`로 어댑터를 찾아 별도 `codex exec --json` 프로세스를
돌리고, 그 출력을 평소의 `HANDOFF`나 증거 JSON 형태로 변환만 합니다 — 성공했는데 자기가 다시
작업하면 안 됩니다. `auto`는 경로 실패 시 Sonnet으로 명시적 강등이 가능하고, `required`는 강등
대신 provider 실패를 보고합니다. `off`면 순수 Sonnet입니다. goal-spec의 `implement_provider` /
`test_provider`는 전제 조건이 아니라 추적용 힌트입니다.

## 모드

- **B (기본):** 원문 요청 + 고정 엔진.
- **DW-off 폴백:** Dynamic Workflow가 꺼져 있거나 Workflow 도구가 없으면, 역할이 분리된 Agent
  Team을 구성해 같은 여섯 역할을 파일 기반 폴백 규약으로 돌립니다
  ([`engine/fallback.md`](engine/fallback.md)). 팀 리드는 조율만 하고 Implement, Test,
  QualityGate는 각각 별개 팀원으로 남아 run 디렉터리의 파일 경로만 주고받습니다. 완료 신호는
  [`engine/fallback-check.mjs`](engine/fallback-check.mjs)라는 객관적 체크입니다.
- **M (메타):** 고정 단계로 표현할 수 없는 제어 흐름(토너먼트, 단계적 에스컬레이션,
  loop-until-dry)이 필요하면 하네스가 전용 Workflow를 *생성*합니다 —
  [`templates/meta-skeleton.js`](templates/meta-skeleton.js)를 복사해 `[META]` Work 블록만
  다시 쓰고 실행합니다. 스켈레톤의 계약(판정자 ≠ 실행자, provider 라우팅, 유한 루프, 결정론적
  Test, goal 레벨 게이트)은 그대로 둡니다.
- **A (수동):** 전용 Workflow를 직접 작성해서 넘깁니다 — [`templates/`](templates/) 참고.

오케스트레이터가 Codex 자신일 때는 `codex`, `codex-exec-adapter.mjs`, `codex-runner.mjs`로 재귀
호출하지 말고, 저장소의 `AGENTS.md` 규약대로 네이티브 Codex 도구로 여섯 단계를 직접 수행하세요.

## 프로젝트에 설치하기

마켓플레이스 설치만으로는 강제되는 게 없습니다. 대상 프로젝트에서 **`install` 스킬**
([`skills/install/SKILL.md`](skills/install/SKILL.md))을 돌려야 거버넌스가 상시화됩니다 —
프로젝트가 소유하는 사본을 만들고, 기존 파일은 절대 덮어쓰지 않습니다:

- `.claude/harness-gate.json` — 확인된 경로 패턴에 편집 게이트를 활성화
- `.claude/hooks/goal-gate.mjs` + `.claude/settings.json`에 머지된 PreToolUse 항목 —
  자기완결적 게이트 훅. 커밋해두면 플러그인 설치 여부와 무관하게 팀 전체에 적용됩니다
  (엔진은 여전히 플러그인에 있습니다 — install 스킬의 gap 노트 참고)
- `.claude/conventions/{coding,verification,boundaries}.md` — 엔진이 읽는 기본 룰셋
  (SetGoal → 승인/테스트 기준, Implement → 준수)
- 프로젝트 `CLAUDE.md`에 덧붙는 펜스 처리된 `## Harness` 섹션
- `.gitignore`의 `.claude/.harness-markers/`

이후 사본은 프로젝트 소유입니다. 라이프사이클 스킬은 명시적으로 부를 때만 건드립니다:
`install`을 `refresh:true`로 돌리면 플러그인 소유 사본을 갱신하고, `remove`는 설치를 정리합니다.

**강제**는 opt-in PreToolUse 게이트입니다([`hooks/`](hooks/)). 프로젝트가
`.claude/harness-gate.json`에 게이트 대상 경로를 적으면, 그 경로에 대한
`Write|Edit|MultiEdit|NotebookEdit`는 하네스 사용을 요구합니다. 어디서든 fail-open이고
(v0의 교훈), 보안이 아니라 넛지입니다.

## 라이프사이클 헬퍼

- **`harness:remove`** — 설치된 훅, 등록, 게이트, 임베드 런타임, 마커 캐시, CLAUDE.md 블록,
  gitignore 항목을 제거합니다. 프로젝트 소유 컨벤션은 명시적으로 요청하지 않는 한 보존됩니다.
- **`harness:patch`** — 소스 패치 릴리스를 준비합니다. 두 매니페스트의 패치 버전을 올리고,
  전달받은 한 줄 릴리스 노트를 Status 섹션 맨 위에 넣습니다. 먼저 dry-run하고, 버전이 어긋나면
  거부합니다.

버전별 변경 이력은 [README의 Status](README.md#status) 섹션에 있습니다.

진입점: [`harness`](skills/harness/SKILL.md), [`install`](skills/install/SKILL.md),
[`remove`](skills/remove/SKILL.md), [`patch`](skills/patch/SKILL.md),
[`codex-control`](skills/codex-control/SKILL.md).
