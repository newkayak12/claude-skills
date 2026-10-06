---
name: audit
effort: high
description: >-
  Use when you want to know what a workspace already has and what is missing. Triggers on: "뭘 더 설치하면 좋아?", "워크스페이스 점검", "what am I missing", "what skills or plugins do I have here".
scenarios:
  - "What am I missing in this workspace? Check what's installed before suggesting anything"
  - "Which plugins or MCP servers would help this repo, given what we already have?"
  - "뭘 더 설치하면 좋아? 지금 뭐가 깔려 있는지부터 봐줘"
  - "이 프로젝트 워크스페이스 점검해줘 — 빠진 게 뭐야?"
  - "우리 레포에 이미 있는 스킬로 해결되는지 먼저 확인해줘"
compatibility:
  optional:
    - think-tool
  remote_mcp_note: >-
    think-tool이 있으면 빈틈이 skill, hook, MCP 중 어느 모양인지 가르는 판단을 더 꼼꼼히 할 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
---

## Standing Mandates

- NEVER recommend a plugin, skill, or MCP server from memory. Names that sound right are the failure: a recommendation Claude can't point to in a file the user can open is a guess dressed as advice. Every row cites a source path read this run; no source path → drop the row or say `no match`.
- NEVER read or print a secret value. For `.env*` list key names only: `grep -o '^[A-Za-z_][A-Za-z0-9_]*=' <file> | tr -d '='`. For `.mcp.json` and `.claude/settings*` print server, hook, and key names only — never `env` values, `headers`, tokens, API keys, or URLs that carry them; say "env set". An audit output gets pasted into chats and issues — a value printed once is a leaked credential.
- NEVER invent a match. If neither the catalog nor `_reference/external-skills.md` has it, the answer is `no match`.
- NEVER write or edit a file. This skill only reads; fixes are handed off (step 6).
- Goal: every table row has a source path, and the Count line recounts to the table. One pass, then stop.

# Audit

Reads what this workspace has installed, matches the user's gap against the catalogs it can see, and says what is present, installable, or absent.

**Not for** installing the harness (`harness:install`) or authoring a skill (`skill:create`).

## Process

1. **Ask once if the question is open.** "Missing for what?" — one line, only if the request and the repo can't answer it. Then check the project `CLAUDE.md` skill-awareness or workflow table: if a row already answers it, point to that row and stop.
2. **Inventory, names only.** Repo root, `.claude/settings*.json`, `.mcp.json`, `CLAUDE.md` / `AGENTS.md`, hook entries, `~/.claude/plugins/installed_plugins.json`, and the skills listed in this session. Open a file's body only when the question needs it. A missing file is a finding ("no `.mcp.json`"), not an error.
3. **Env keys.** `ls -a | grep '^\.env'`, then key names via the mandate's command. Infer the service from the key name and mark it `implied`, not `configured`.
4. **Catalog.** Only what this install can see: the session skill list, `~/.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json` and the plugin READMEs beside them. Match each gap to an existing skill and quote its trigger line with the source path.
5. **No catalog match.** `_reference/external-skills.md`, only if it exists in the cwd. Label any hit `candidate, unverified — check SKILL.md/scripts before install`. Absent file or no hit → `no match`.
6. **Shape the gap, then hand off.** A skill-shaped gap → `skill:create`. A hook or permission → `update-config`. An MCP server → name the `.mcp.json` entry from a source read in step 4 or 5, never from memory.
7. **Recount.** Count the table's rows per column and write the Count line from that count; if it disagrees with the Verdict, fix the Verdict.

## Output Template

```
Verdict: <one line: what the workspace can already do about the question, and the biggest gap>

| Gap | Installed | In catalog, not installed | Absent |
|-----|-----------|---------------------------|--------|
| <capability> | <name — source path> | <plugin:skill — "trigger line" — source path> | <no match / candidate, unverified — source path> |

Next moves (≤5):
1. <action> — <source path>

Hand-off: <gap → skill:create | update-config | none>
Count: <i> installed · <c> catalog · <a> absent = <n> gaps
```

Do NOT add a recommendation without a source path, and do NOT pad Next moves to five.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Inventories names, matches against the catalogs, quotes trigger lines | Say what you are trying to get done, if the repo doesn't |
| Labels external candidates unverified and keeps secret values out of the output | Read the SKILL.md and scripts of any candidate before installing |
| Names the hand-off for each gap | Decide what to install, build, or skip |

## Related Skills

- `harness:install` — scaffolding the harness into the project; this skill only reports.
- `skill:create` — a gap that needs a new skill.
- `update-config` — a gap that is a hook, permission, or setting.
- `write:writing-skills` — fixing an existing skill that misfires.
