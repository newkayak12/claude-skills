# Claude Skills — Claude Instructions

This repository contains reusable skills organized into plugins. When working in this repo or when a user installs these plugins, follow the instructions below.

## Modifying This Repo

The rules live in `.claude/rules/` (Claude Code loads them; Codex reads them via `AGENTS.md`):

| File | Covers |
|---|---|
| `repo.md` | how a change is made: the four guidelines, plan → setgoal → critique → approval, layout |
| `maintaining.md` | checks, versions and release, agents, benches, leaving it clean |
| `skill.md` | what a skill is and how one is written |
| `mod.md` | what a mod is and its rules |
| `compat-claude.md` | older Claude Code builds |
| `compat-codex.md` | Codex |

Memory for this repo is the private vault `../claude-skills-knowledge`: search it before planning,
and add notes to it as things happen (`maintaining.md` "Maintenance vault").

@_repo/coding-guidelines.md

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
| New feature, full dev cycle, quality process | `teams:develop` (code through the graph); `develop:clean-code` for the review gate |
| Job application, career transition, interview prep | `portfolio:job-application-workflow` |
| TDD, test coverage strategy, flaky CI | `develop:testing-workflow` |
| Spec first, spec-driven development, acceptance criteria before code | `develop:spec-driven-development` |
| DB performance, slow query, connection pool, transactions | `develop:database-workflow` |
| System architecture, DDD, service boundaries, MSA | `develop:architecture-workflow` |
| Production readiness, SRE, chaos testing, incident response | `develop:operations-workflow` |
| Critical thinking, stress-test a plan or argument | `cognition:critical-thinking-workflow` |
| Mentoring in any field — career, craft, study, life decisions | `think:mentor` |
| Knowledge vault build, retrieval quality loop, eval not improving | `knowledge:workflow` |

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
