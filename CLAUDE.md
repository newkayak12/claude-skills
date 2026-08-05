# Claude Skills — Claude Instructions

This repository contains reusable skills organized into plugins. When working in this repo or when a user installs these plugins, follow the instructions below.

## Skill Awareness

Before responding to any user request, check whether a relevant skill exists:

1. **Identify intent** — Is the user asking for analysis, writing, planning, coding, or thinking?
2. **Match to a skill** — Check the plugin that covers that domain
3. **Invoke the skill** — Use the skill rather than responding ad hoc

When a skill matches, invoke it explicitly. Don't silently use skill content without telling the user which skill is running.

## Workflow Entry Points

For complex multi-step tasks, use these workflow skills as entry points:

| User says | Invoke |
|-----------|--------|
| PM strategy, product planning, GTM from scratch | `pm:pm-strategy-workflow` |
| Deep thinking, structured ideation, decision | `think:deep-thinking-workflow` |
| New feature, full dev cycle, quality process | `develop:dev-quality-workflow` |
| Job application, career transition, interview prep | `portfolio:job-application-workflow` |
| TDD, test coverage strategy, flaky CI | `develop:testing-workflow` |
| DB performance, slow query, connection pool, transactions | `develop:database-workflow` |
| System architecture, DDD, service boundaries, MSA | `develop:architecture-workflow` |
| Production readiness, SRE, chaos testing, incident response | `develop:operations-workflow` |
| Critical thinking, stress-test a plan or argument | `cognition:critical-thinking-workflow` |
| Self-reflection, life transition, understanding myself | `self:self-discovery-workflow` |
| Career leveling, 1-on-1 prep, manager/IC growth | `leadership:leadership-workflow` |

Each workflow skill guides through sub-skills step by step. Ask the user which step to start from if they're mid-process.

## MCP Tool Usage

When MCP tools are available, use them proactively — do not wait for the user to ask:

- **think-tool**: Use for any analytical judgment, trade-off evaluation, or complex reasoning step
- **sequential-thinking**: Use for multi-step workflows where each step builds on the previous
- **mcp-reasoner**: Use for high-stakes decisions with multiple competing options

If a skill's `compatibility` block lists MCP tools, treat `recommended` as "use by default if available."

### Remote MCP Setup

If MCP tools are not available, prompt the user to connect them:
> "이 스킬은 think-tool / sequential-thinking MCP 도구가 연결되면 품질이 높아집니다. Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가해보세요."

## Skill Authoring Rules (for maintainers)

See `write/skills/writing-skills/SKILL.md` for the full authoring guide.

Quick rules:
- `description` must start with `Use when` — this is the trigger
- `scenarios` must have EN + KR variants (2-3 each)
- Every skill needs: Process → Output Template → What Claude Does / What You Do → Related Skills
- No background explanations — skill name is the context
- Target: 70% of current average length

## Update Workflow

After any change: bump version in `.claude-plugin/marketplace.json` → update `<plugin>/README.md` → commit → `git push skills main`.

See `INSTRUCT.md` for full details.

<!-- harness:begin v1 -->
## Harness

This project uses the harness plugin for substantial changes (dogfooded here — this is the
harness's own source repo, so the engine path is repo-relative).

- **Substantial or risky changes** (multi-file, gated paths, anything with a quality
  bar) go through the six-stage engine — do not hand-roll the flow:
  `Workflow({ scriptPath: "harness/engine/pipeline.js", args: { request: "<the request>" } })`
- **Conventions are law:** read `.claude/conventions/**` before implementing; they feed
  the engine's acceptance criteria and verification commands.
- **Gate:** edits matching the patterns in `.claude/harness-gate.json` are blocked by a
  PreToolUse hook unless the harness is engaged this session (fail-open on errors). Gated
  here: the harness engine/hooks `.mjs`/`.js`, **and every project `*.md`** (skills, READMEs,
  this file, docs) except those under `.claude/`. Skill/doc authoring is the substantial-change
  surface in this repo, so it goes through the engine. If blocked, run the harness instead of
  retrying.
- Only trivial **non-`.md`** edits (a single-line code fix, a config value) skip the engine.
  Any `*.md` change — even a typo — is gated; engage the harness first.
<!-- harness:end -->

