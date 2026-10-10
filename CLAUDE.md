# Claude Skills — Claude Instructions

This repository contains reusable skills organized into plugins. When working in this repo or when a user installs these plugins, follow the instructions below.

## Modifying This Repo

Every change to this repo is checked against the coding guidelines below (think before coding, simplicity first, surgical changes, goal-driven execution). Non-plugin material (design docs, repo scripts, deprecated plugins) lives under `_repo/`; every other top-level directory is a plugin.

@_repo/coding-guidelines.md

Mods (plugin `hooks/*.tsx` modules): anything a person reads in an interactive session is drawn with Ink, as a `ui.render` tree (Pane or AbovePrompt), opened by its command or a band button. A command's `{ text }` is the headless answer only; interactive, it opens the pane and returns one line at most.

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
| New feature, full dev cycle, quality process | `develop:dev-quality-workflow` |
| Job application, career transition, interview prep | `portfolio:job-application-workflow` |
| TDD, test coverage strategy, flaky CI | `develop:testing-workflow` |
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

## Skill Authoring Rules (for maintainers)

See `write/skills/writing-skills/SKILL.md` for the full authoring guide.

Founding principle: every skill starts from the four coding guidelines in `_repo/coding-guidelines.md`
(think before coding, simplicity first, surgical changes, goal-driven execution). Apply them when a skill
is created or next edited — no mass rewrite. teams-mounted skills stay frozen until teams decides.

Quick rules:
- `description` must start with `Use when` — this is the trigger
- `scenarios` must have EN + KR variants (2-3 each)
- Every skill needs: Process → Output Template → What Claude Does / What You Do → Related Skills
- No background explanations — skill name is the context
- Target: 70% of current average length

## Design Changes (harness rule for Claude's own work)

Before changing behaviour of a plugin (not typo/doc fixes):
1. **plan** — what changes and why, citing the governing design doc (`_repo/docs/plans/`).
2. **setgoal** — checkable done-criteria.
3. **critique** — check it against the doc's principles; show the user and get approval. No code before approval.
4. **implement → gate** — show the result against the done-criteria.

Never remove a stage, a gate, or a principle for cost or simplicity without the user's approval.
teams principles: `_repo/docs/plans/2026-09-28-teams-cards-everywhere.md`.

## Update Workflow

After any change: bump version in `.claude-plugin/marketplace.json` → update `<plugin>/README.md` **and** `<plugin>/KOR.md` (English default + Korean mirror; both must move together) → commit → `git push origin main`.

Maintainer bump tools (not user skills): `node _repo/scripts/patch-harness.mjs` and the teams `patch` skill's `node teams/skills/patch/patch.mjs '<json>'` (dry-run first, see its SKILL.md) bump a plugin's patch version and its status logs in one step (patch-harness writes README.md/KOR.md; the teams tool writes teams/CHANGELOG.md and CHANGELOG.KOR.md). Minor/major bumps are done by hand. Refreshing a project's installed harness copies is the `harness:update` skill.

### Repo version and tags

The repo (marketplace) version is `metadata.version` in `.claude-plugin/marketplace.json`; each release is the annotated tag `v<metadata.version>`, message `marketplace <version>`.

- **When:** only when the user asks for a release or tag. A plugin bump alone does not move the repo version.
- **Level, from the largest change since the last tag:** patch = any plugin bump (patch, minor or major) or doc change; minor = a new plugin added; major = a plugin removed or renamed, or a change to the marketplace layout that breaks existing installs.
- **Steps:** `git fetch` → bump `metadata.version` → commit `marketplace <version>: <what moved>` → `git push origin main` → `git tag -a v<version> -m "marketplace <version>"` on that commit → `git push origin v<version>`. Tag only commits that are on origin/main.
- **Never** move, delete, or re-point a pushed tag unless the user asks.

