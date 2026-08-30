# harness

**English** · [한국어](#한국어)

A reasoning floor for substantial requests. Not a quality maximizer — a filter that removes
**repetition** and **below-threshold answers** by forcing every request through six staged roles
with the judge separated from the actor. Planning and judging are pinned to Opus; code execution
and deterministic verification are provider-routed to the local Codex CLI when it is available.

```
Plan(opus) → SetGoal(opus) → Implement(Codex when enabled) → Test(Codex when enabled) → QualityGate(opus, loop) → Report(sonnet)
```

The plugin also ships an opt-in PreToolUse edit gate, so a project can require harness engagement
before anyone edits the paths it cares about.

## Install & Uninstall

```bash
/plugin install harness@newkayak12-claude-skills
/plugin uninstall harness@newkayak12-claude-skills
```

Marketplace install alone enforces nothing — it makes the skills available. Run the `install`
skill inside a target project to make governance ambient (see
[Installing into a project](#installing-into-a-project)).

## Orchestration paths

| Path | When | How |
|---|---|---|
| **Graph (default)** | `graph-engineering` MCP connected | `graph:orchestrate` — the graph engine owns the flow; the main session only loops `graph_next` / `graph_run` / `graph_submit`. No transport subagents, no polling. |
| Workflow engine | Graph MCP absent, Workflow tool available | `Workflow({ scriptPath: "harness/engine/pipeline.js", ... })` |
| Agent team | Neither | `engine/fallback.md` |

The graph engine exists because the Workflow path had to spend a subagent per Implement/Test node
just to drive a CLI through Bash, and a subagent waiting on a process can only poll.
Measured on one real run the transport layer cost more than the reasoning layer
(6.87M vs 2.06M input tokens, zero edits by the transport). See `graph/README.md`.

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Get a substantial request planned, executed, verified, and gated before it comes back | `harness` |
| Connect or verify the graph-owned default orchestration path | `graph:install` |
| Make the harness ambient in a project — gate, hook, conventions, CLAUDE.md block | `install` |
| Take harness governance back out of a project | `remove` |
| Cut a synchronized patch release of the harness plugin source | `patch` |
| Delegate an Implement/Test stage to the local Codex CLI from any install layout | `codex-control` |

## Skills

### `harness`

The engine entry point. Hands the raw request to `engine/pipeline.js`, which plans, authors and
critiques its own goal-spec, executes each subgoal with skill-equipped executors, verifies each
one with a separate deterministic Test agent, and gates both the subgoals and the assembled whole
before writing a report. Reach for it when the bar is "verified, not plausible". Not for trivial
edits or Q&A — the six stages cost more than the answer is worth there.

```
Run the harness on this: our order-sync job silently drops rows when the upstream page
size changes. Fix it properly and prove each part independently before reporting.
```

Invocation, mode B (the default):

```js
Workflow({ scriptPath: "harness/engine/pipeline.js", args: {
  request: "<the request>",
  context: "<optional constraints>",
  max_retries: 2,
  codex_provider: "auto"     // "auto" | "required" | "off"
}})
```

Returns `report`, `all_passed`, `failed[]`, and `goal_gate` — relayed to you as-is, failures
included. Beyond the three statically mounted skills (`agents:agent-task-decomposer` at Plan,
`think:devils-advocate` at the spec critic and QualityGate,
`completion:verification-before-completion` at Test), SetGoal *may* map harness-aware repo skills
(`write:writing-plans`, `planning:executing-plans`, `agents:subagent-driven-development`,
`develop:test-driven-development`, `write:writing-skills`, `agents:dispatching-parallel-agents`,
`think:brainstorming`) onto subgoals. All optional; a run using none of them is valid.

### `install`

Scaffolds project-owned harness governance so enforcement does not depend on the plugin staying
installed. Judgment (gate patterns, embedding choice, conventions, the CLAUDE.md block) stays with
the skill; the deterministic file work runs through `install.mjs`. Everything is idempotent and
non-destructive — existing files are reported `kept`, never overwritten. It does not run the
engine; use the `harness` skill for that.

```
이 프로젝트에 하네스 설치하고 게이트 켜줘 — Kotlin 소스만 게이트 대상으로.
```

```sh
node "<plugin>/skills/install/install.mjs" '{
  "projectDir": "<abs project root>",
  "gate": { "patterns": ["src/.*\\.kt$"], "window_hours": 2 },
  "embed": { "runtime": true, "skills": [ { "name": "...", "src": "<abs>" } ] }
}'
```

Omit `gate` to skip the gate write, `embed` to skip standalone embedding. After a plugin version
bump, re-run with `"refresh": true` — it re-copies only plugin-owned files (`goal-gate.mjs`,
`.claude/harness/**`) and never touches your gate, conventions, CLAUDE.md, or `settings.json`.

### `remove`

Uninstalls project-local harness governance: the hook, its `settings.json` registration,
`.claude/harness-gate.json`, `.claude/harness/`, `.claude/.harness-markers/`, the fenced
CLAUDE.md block, and the `.gitignore` line. `.claude/conventions/` is project-owned and is
**preserved by default** — purging it requires explicit confirmation. A malformed `settings.json`
or unmatched CLAUDE markers are left in place and reported for manual cleanup rather than deleted
to force completion.

```
Uninstall the harness from this project, but keep .claude/conventions/ — we've edited those.
```

```sh
node "<plugin>/skills/remove/remove.mjs" '{
  "projectDir": "<abs project root>",
  "purgeConventions": false
}'
```

Idempotent: a second run reports `absent` rather than failing.

### `patch`

Prepares a patch release of the harness plugin **source** — it increments `x.y.Z` in both
manifests and inserts a one-line note at the top of the Status log. For a source checkout of this
marketplace, not for refreshing files installed into an application project, and not for
feature- or breaking-sized releases (use an explicit minor/major bump instead).

```
하네스 패치 릴리스 준비해줘 — 이번 diff 요약해서 Status에 한 줄 넣고 버전 올려줘.
```

```sh
node "<plugin>/skills/patch/patch.mjs" '{
  "repoRoot": "<abs claude-skills checkout>",
  "summary": "<concise status entry>",
  "dryRun": true
}'
```

Dry-run first, confirm the reported previous/next versions, then re-run with `"dryRun": false`.
It refuses to write when plugin and marketplace versions differ, the Status heading is missing, or
the summary is empty or multiline. Files touched:

| File | Change |
|---|---|
| `harness/.claude-plugin/plugin.json` | `version` patch bump |
| `.claude-plugin/marketplace.json` | the `harness` entry's `version` |
| `harness/README.md` | new first entry under `## Status` |

### `codex-control`

The adapter-discovery contract used by Codex-enabled Implement/Test stages, so delegation works
without assuming the project embedded `.claude/harness/**`. It resolves the first existing
`codex-exec-adapter.mjs`, and when none exists it records Codex as unavailable and lets the stage
continue on the normal Claude path.

```
Harness Implement stage needs to run Codex from plugin mode — resolve the adapter first.
```

Resolution order:

| # | Layout | Path |
|---|---|---|
| 1 | Explicit arg | `args.codex_adapter_path` |
| 2 | Repo-local | `harness/engine/codex-exec-adapter.mjs` |
| 3 | Embedded install | `.claude/harness/engine/codex-exec-adapter.mjs` |
| 4 | Plugin mode | derived from the `scriptPath` in the project's CLAUDE.md Harness block |

Run contract: always `--detect` before delegating; separate Codex processes for Implement and
Test; Implement may use `--sandbox workspace-write`; Test prompts are verification-only and must
never edit implementation files or trust the Implement narrative without command/file evidence.

## How it works

1. **You pass a raw request.** `Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: "..." } })`
2. **The engine plans and authors the goal-spec itself** (Opus, with an adversarial critic
   pass), so spec quality doesn't depend on the main-session model. Schema: [`goal-spec.md`](goal-spec.md).
3. **Each subgoal loops Implement → Test → QualityGate** (bounded by `max_retries`):
   executors invoke this repo's skills; a separate Test agent produces deterministic
   evidence (runs commands, reads artifacts); a separate Opus judge gates on evidence.
4. **A goal-level gate scores the assembled whole against the goal** (0-100 `match_pct`,
   pass requires >= 90%; below threshold triggers a repair pass and re-gate), then a
   Report stage synthesizes.

With `codex_provider: "auto"` or `"required"`, Codex is the **default** route for every
Implement/Test stage: a minimal Sonnet controller resolves the adapter via `codex-control`, runs a
separate local `codex exec --json` process, and converts its output into the normal `HANDOFF` or
evidence JSON — it must not redo the work itself on success. `auto` may explicitly degrade to
Sonnet on route failure; `required` reports provider failure instead. `off` forces plain Sonnet.
`implement_provider` / `test_provider` in the goal-spec are trace hints, not prerequisites.

## Modes

- **B (default):** raw request + the fixed engine.
- **DW-off fallback:** when Dynamic Workflow is disabled or the Workflow tool is absent, form a
  role-isolated Agent Team and run the same six roles through the file-backed fallback contract
  ([`engine/fallback.md`](engine/fallback.md)). The team lead only coordinates; Implement, Test,
  and QualityGate remain separate teammates exchanging file paths through a run directory, and
  [`engine/fallback-check.mjs`](engine/fallback-check.mjs) is the objective done-signal.
- **M (meta):** the harness *generates* a bespoke Workflow when the request needs control
  flow the fixed stages can't express (tournament, escalation, loop-until-dry) — it copies
  [`templates/meta-skeleton.js`](templates/meta-skeleton.js), rewrites only the `[META]`
  Work block, and runs it. The skeleton's contract (judge ≠ actor, provider routing,
  bounded loops, deterministic Test, goal-level gate) stays verbatim.
- **A (manual):** you author the bespoke Workflow yourself — see [`templates/`](templates/).

When the active orchestrator is Codex itself, do not recurse through `codex`,
`codex-exec-adapter.mjs`, or `codex-runner.mjs` — run the six-stage contract directly with native
Codex tools per the repository `AGENTS.md`.

## Installing into a project

Marketplace install alone enforces nothing. Run the **`install` skill**
([`skills/install/SKILL.md`](skills/install/SKILL.md)) from the target project to make
governance ambient — it scaffolds project-owned copies (never overwrites existing files):

- `.claude/harness-gate.json` — activates the edit gate on confirmed path patterns
- `.claude/hooks/goal-gate.mjs` + a merged `.claude/settings.json` PreToolUse entry —
  the self-contained gate hook, committed so it enforces team-wide without depending on
  the plugin install (engine still lives in the plugin — see the install skill's gap note)
- `.claude/conventions/{coding,verification,boundaries}.md` — default ruleset the engine
  reads (SetGoal → acceptance/test, Implement → follows)
- a fenced `## Harness` section appended to the project's `CLAUDE.md`
- `.claude/.harness-markers/` in `.gitignore`

The project owns the copies afterward. Lifecycle skills only change them when explicitly
invoked: `install` with `refresh:true` refreshes plugin-owned copies, and `remove` cleans up
the installation.

**Enforcement** is an opt-in PreToolUse gate ([`hooks/`](hooks/)): a project lists gated paths in
`.claude/harness-gate.json`, and `Write|Edit|MultiEdit|NotebookEdit` there requires harness
engagement. Fail-open everywhere (v0 lesson) — a nudge, not security.

## Lifecycle helpers

- **`harness:remove`** removes the installed hook, registration, gate, embedded runtime,
  marker cache, CLAUDE.md block, and gitignore entry. Project-owned conventions are preserved
  unless their removal is explicitly requested.
- **`harness:patch`** prepares a source patch release: it increments the harness patch
  version in both manifests and inserts the supplied one-line release note at the top of this
  Status section. It dry-runs first and refuses mismatched versions.

## Status
- v1.22.0 — **Graph plugin separation**: the graph-engineering MCP moved from the
  short-lived `broker` namespace to the independently versioned `graph` plugin. Harness now
  discovers `graph-engineering` and delegates its default loop to `graph:orchestrate`; setup
  and connection verification live in `graph:install`. The Workflow and Agent Team paths
  remain fallbacks.
- v1.20.0 — **Lifecycle helpers**: added `harness:remove` for deterministic, idempotent
  project cleanup with user-owned conventions preserved by default, and `harness:patch` for
  synchronized patch-version bumps across both manifests plus the README Status entry. Fixture
  tests cover mixed-setting preservation, malformed-file safety, idempotence, dry-run, and
  mismatch refusal.
- v1.19.0 — **DW-off Agent Team fallback**: when Dynamic Workflow is disabled or the Workflow
  tool is absent, the fallback now explicitly requires a role-isolated Agent Team. A thin team
  lead declares Plan, SetGoal/Critic, Implement, Test, QualityGate, and Report ownership in the
  run manifest; teammates exchange only file paths through the run directory, and actor/judge
  separation remains mandatory. Native team primitives are preferred, with an explicit logical
  team of role-separated agents as the portable equivalent. `pipeline.js` is unchanged.
- v1.18.0 — **Codex-first Implement/Test routing**: `codex_provider: "auto"` / `"required"`
  now routes every Workflow Implement/Test stage through the Codex controller by default.
  `implement_provider: "codex"` and `test_provider: "codex"` remain optional trace hints in the
  goal-spec, but missing fields no longer keep a subgoal on Sonnet. This makes the graph shape
  explicit: Claude plans, sets goals, judges, and reports; Codex owns leaf implementation and
  deterministic verification whenever the local CLI route is available. Fallback mode documents
  the same default-provider rule when `RUN/providers.json` says Codex is ready.
- v1.17.0 — **Workflow Codex provider routing semantics**: `implement_provider: "codex"` and
  `test_provider: "codex"` now mean runtime delegation, not trace hints. The Workflow path still
  uses a tiny Sonnet controller because Workflow scripts cannot spawn providers directly, but that
  controller only resolves the adapter, invokes Codex, and converts Codex output into the normal
  handoff/evidence shape. On Codex success it must not redo implementation or verification with
  Sonnet. `codex_provider: "auto"` allows an explicit degraded Sonnet fallback; required mode
  reports provider failure instead of silently falling back. Goal-level repairs also
  prefer the Codex route when delegation is enabled.
- v1.16.2 — **Codex session compatibility boundary**: added `AGENTS.md` guidance that an
  active Codex session must run the harness contract directly with native Codex tools, not
  recurse through `codex`, `codex-exec-adapter.mjs`, or `codex-runner.mjs`. The Codex CLI
  adapter remains only for Claude-orchestrated Workflow/fallback delegation and external
  automation. The Claude Workflow path (`engine/pipeline.js`) is unchanged.
- v1.16.1 — **Codex plugin-mode adapter discovery**: added `harness:codex-control` and
  mounted it in Workflow Implement/Test Codex delegation. `pipeline.js` now honors an explicit
  `args.codex_adapter_path` before repo-local and embedded paths, then uses the skill's
  plugin-mode fallback to derive the adapter beside the plugin-root `pipeline.js` referenced
  from the project's Harness block. The install template now includes `codex_adapter_path` in
  the plugin-mode Workflow example, so non-embedded projects can use Codex without symlinks or
  copying `.claude/harness/**`.
- v1.16.0 — **Workflow Implement/Test Codex delegation**: when `codex_provider` is not off,
  the fixed `pipeline.js` path now has both Sonnet Implement and Sonnet Test agents try the
  local Codex CLI bridge at the start of their stages. Implement uses Codex for code/repo work
  before emitting the normal `HANDOFF`; Test uses a separate Codex call for verification-only
  evidence before producing the normal evidence JSON. Both stages fall back to direct Sonnet
  work if the adapter or Codex CLI is unavailable or returns non-zero.
- v1.15.0 — **Workflow Implement Codex bridge**: the fixed `pipeline.js` path can now keep
  Implement as a Sonnet stage while letting that Sonnet agent call the local Codex CLI through
  `engine/codex-exec-adapter.mjs`. SetGoal may mark code-oriented subgoals with
  `implement_provider: "codex"` when `codex_provider` is not off; the Implement agent runs
  detection, invokes `codex exec --json`, reads the result, and emits the normal `HANDOFF`.
  If Codex is unavailable or fails, the same Sonnet agent falls back to direct implementation.
- v1.14.0 — **Codex solo runner**: added `engine/codex-runner.mjs`, a Codex-only harness
  entrypoint that reproduces the file-artifact fallback contract without touching the Claude
  Workflow path. It runs Plan, SetGoal, Implement, Test, QualityGate, and Report as separate
  `codex exec --json` stages, writes the same `.harness-run/<slug>/` artifacts checked by
  `fallback-check.mjs`, and keeps `pipeline.js` unchanged. Added root `AGENTS.md` so Codex can
  work in this repo without relying on `CLAUDE.md`.
- v1.13.0 — **fallback Codex CLI provider spike promoted**: Workflow-less fallback runs now
  have a documented CLI straight-control path for Codex. At run open, the fallback may call
  `engine/codex-exec-adapter.mjs --detect` to write provider readiness; SetGoal can then mark
  code-oriented subgoals with `implement_provider: "codex"` / `test_provider: "codex"`.
  Implement and Test stay separate `codex exec --json` processes, with JSONL event artifacts
  plus final summary JSON, and Claude still owns Plan, SetGoal, QualityGate, and Report.
  `pipeline.js` remained Claude Workflow-native in this release; v1.15.0 adds a Sonnet-driven
  CLI bridge for Implement, still not a native Workflow provider abstraction.
- v1.12.1 — **Plan skill-namespace hint fix**: the Plan stage's `skills fit (plugins: …)` hint
  in `engine/pipeline.js` now includes `planning:*` and `completion:*`, so the optional executor
  the docs recommend (`planning:executing-plans`) and the statically-mounted
  `completion:verification-before-completion` are actually surfaced to the SetGoal author. Prompt
  hint only — no control-flow change. (Design notes for an upcoming SetGoal review-checkpoint +
  per-subgoal parallel authoring live in `_draft/graph-engineering/`.)
- v1.12.0 — **loop-convergence hardening** (all three execution paths: `pipeline.js`,
  `templates/meta-skeleton.js`, `engine/fallback.md`). SetGoal authoring + the spec critic now
  reject two unwinnable-gate patterns that could burn the whole retry budget without ever passing:
  (1) acceptance/test criteria keyed to **global/shared repo state** (whole-repo `git diff/status`,
  aggregate counts) instead of the subgoal's own artifacts — concurrent work makes those
  non-deterministic; (2) **aspirational / arbitrary-threshold** targets (a chosen % reduction,
  subjective quality words) written as hard pass/fail bars. And both the per-subgoal and goal-level
  QualityGate loops gain a **no-progress early stop**: if a repair attempt reproduces the previous
  attempt's exact gaps/reason, the loop breaks early instead of spending the rest of its
  `max_retries` on an identical gap (still hard-capped by `max_retries` — only exits sooner).
- v1.11.1 — documented the **optional** harness-aware skill integrations: SetGoal may map the
  repo's dual-mode cluster-B skills (`writing-plans`, `executing-plans`, `subagent-driven-development`,
  `test-driven-development`, `writing-skills`, `dispatching-parallel-agents`, `brainstorming`) as
  subgoal executors when the task fits — none required, each also runs standalone. See the harness
  skill's "Optional skill integrations".
- v1.11.0 — **re-introduced** the Workflow-less fallback ([`engine/fallback.md`](engine/fallback.md)),
  redesigned to fix what sank v1.9.0. No transcript sentinel and no edit-gate coupling (those
  false-positived on quoted occurrences). Instead: the six stages run as **fresh per-stage Agent
  subagents** that exchange work through files in a **run directory**, so the orchestrator stays a
  thin dispatcher and a long run can't pollute its context; completion is an **objective, resumable
  check** ([`engine/fallback-check.mjs`](engine/fallback-check.mjs)) that names any missing or
  degenerate stage artifact. Selected only when the Workflow tool is absent; `pipeline.js` (Workflow
  path) unchanged. Honest ceiling: still fail-open — the check makes a skipped stage detectable,
  not impossible.
- v1.10.0 — removed the original Workflow-less fallback: its sentinel was a plain documented string
  that leaked into transcripts and false-positived Workflow-capable sessions.
- v1.9.0 — (superseded) first Workflow-less fallback attempt via the Agent tool + a sentinel gate.
- v1.8.0 — `install.mjs` gains a `refresh: true` mode: after a plugin version bump it
  re-copies only the plugin-owned files (`goal-gate.mjs`, embedded `.claude/harness/**`),
  reporting `refreshed`/`unchanged`, and never touches user-owned files (gate, conventions,
  CLAUDE.md, settings.json). Default stays non-destructive. Corrects the earlier inaccurate
  "re-run to refresh" note (a plain re-run keeps everything).
- v1.7.0 — Planner now mounts `agents:agent-task-decomposer` with a systems-analyst persona
  (crisp, dependency-mapped, independently-verifiable units); Report gains an honest
  status-reporter persona (sonnet unchanged). Standalone embedding's static-skill set updated
  to three (decomposer + devils-advocate + verification-before-completion).
- v1.6.0 — `install` delegates its deterministic file work (gate write, hook copy +
  `.claude/settings.json` merge, standalone embedding, `.gitignore`) to
  [`skills/install/install.mjs`](skills/install/install.mjs); the skill keeps only
  judgment/dialogue. Idempotent JSON merge (never clobbers existing hooks, leaves
  unparseable settings untouched). Skill descriptions front-loaded for trigger matching.
- v1.5.0 — `install` now embeds the gate hook into the project: copies the self-contained
  `goal-gate.mjs` to `.claude/hooks/` and merges a PreToolUse entry into committed
  `.claude/settings.json`, so enforcement is project-owned (no plugin dependency for the
  gate). Idempotent merge. It also **asks whether to embed the engine + statically-referenced
  skills into `.claude/harness/`** for plugin-less environments (air-gapped/CI) — opt-in,
  with the dynamic-`skills[]` boundary called out (SetGoal picks those from the whole
  catalogue and they can't be pre-enumerated).
- v1.4.0 — Mode M: the harness generates request-shaped bespoke Workflows from
  `templates/meta-skeleton.js` (contract-preserving meta-scripts).
- v1.2.0 — `install` skill: per-project scaffolding (gate + conventions + CLAUDE.md section).
- v1.1.0 — six-stage engine; restores separate Plan/SetGoal/Test stages, spec critic,
  goal-level gate, and structured handoffs on top of the v1.0.0 lightweight rebuild
  (v0 preserved in git history at tag `harness-v0`; its situational rulesets were
  recycled into the install skill's optional conventions).
- Enforcement: **opt-in PreToolUse gate** ([`hooks/`](hooks/)) — a project lists gated
  paths in `.claude/harness-gate.json`; edits there require harness engagement.
  Fail-open everywhere (v0 lesson); a nudge, not security.

Entry points: [`harness`](skills/harness/SKILL.md),
[`install`](skills/install/SKILL.md), [`remove`](skills/remove/SKILL.md),
[`patch`](skills/patch/SKILL.md), and [`codex-control`](skills/codex-control/SKILL.md).

---

# 한국어

[English](#harness) · **한국어**

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
  codex_provider: "auto"     // "auto" | "required" | "off"
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

버전별 변경 이력은 위의 [Status](#status) 섹션에 있습니다.

진입점: [`harness`](skills/harness/SKILL.md), [`install`](skills/install/SKILL.md),
[`remove`](skills/remove/SKILL.md), [`patch`](skills/patch/SKILL.md),
[`codex-control`](skills/codex-control/SKILL.md).
