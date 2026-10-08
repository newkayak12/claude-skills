---
name: install
description: >-
  Use when installing teams into a project: team.json defaults, the dispatch gate, and
  conventions. Not for running a task; use teams:orchestrate.
scenarios:
  - "이 프로젝트에 teams 설치해줘"
  - "team.json이랑 dispatch 게이트 설정해줘"
  - "Install teams into this project"
  - "Set up team.json defaults and the dispatch gate here"
compatibility:
  required:
    - node-18+
related:
  - orchestrate
  - remove
  - patch
  - harness:install
---

# install — team.json, the dispatch gate, and conventions

Connect the node-graph engine already shipped by this plugin and scaffold the project-owned
files that give it defaults. Do not copy, regenerate, or fork the engine: `mcp/broker.mjs`,
`mcp/graph.mjs`, `mcp/taskmanager.mjs`, `mcp/teamconfig.mjs`, and the bundled Codex adapter
remain plugin-owned and are updated with the `teams` plugin. The deterministic file work —
`team.json`, the dispatch gate file, conventions, the CLAUDE.md block, `.gitignore` — is
delegated to `install.mjs` so it runs identically every time; this skill owns the judgment.

## What this buys you

A team already runs with no setup at all — every run skill's own "Running without install" note
(`../orchestrate/SKILL.md`) covers the bare `TEAM_DEFAULTS` a project gets with no
`.claude/team.json`. This skill buys three things that path does not have: the dispatch gate (a
write to a gated path is redirected into `tm_open` instead of landing directly — see "Dispatch
gate" below), defaults pinned to this project instead of the plugin's built-in ones, and
`.claude/conventions/` for plan/setgoal/implement/draft to read against. None of it has to
precede a run; add it whenever the project is ready to commit to it.

## Process

1. **Judgment, before running anything.** Inspect the project's languages and source roots and
   propose dispatch patterns (e.g. `src/**`, `packages/**`); confirm them with the user. Ask
   which `roles` to keep on (`qa`, `audit`) — both default ON. Planning is not a choice: it
   always runs (_repo/docs/plans/2026-09-28-teams-cards-everywhere.md C5; `planning: false` is refused
   with a note). The EPIC's plan stage splits the request by feature, one planning card per area
   (PRD investigate → draft → revise → gate) writes that area's section, and `plan-integrate`
   merges them into one PRD whose user stories feed shape's packages; `roles.planning` only picks
   the cards' chain (`true`, `"light"`, `"auto"`). `audit` adds a second planning pass
   (`audit → gate`) after integration, which cross-checks the built result against the merged
   user stories and files a STORY for each one still unmet. `qa` adds one QA card per feature
   area between `integrate` and `gate:goal`, each on the integration tree, to run a QA pass before
   the goal gate judges it; a round's defects are filed as STORYs too, and the EPIC loops back
   through integration (capped by `qa_rounds`, which caps audit rounds as well).
   If harness is already installed in this project, say so: `.claude/conventions/` and the
   session-marker directory are shared between the two plugins.
   Ask whether a reference project exists (a codebase whose style the team should follow;
   a path or repo). Default **No**.
2. Run:
   ```sh
   node "<plugin>/skills/install/install.mjs" '{
     "projectDir": "<abs project path>",
     "dispatch": {"paths": ["src/**"], "min_chars": 400, "allow": []},
     "team": {"goal_threshold": 90, "roles": {"qa": true}},
     "refresh": false
   }'
   ```
   Omit `dispatch` to skip the gate file entirely (no file means no gate).
3. Treat the printed report JSON as ground truth, not your own judgment. Report, per action,
   whether `team.json`, the dispatch file, each convention file, the CLAUDE.md block, and
   `.gitignore` came back `created`, `kept`, `present`, `appended`, `refreshed`, `unchanged`, or
   `skipped`.
   - If the user named a reference project in step 1 and the report confirms conventions were
     created or kept: when the `develop` plugin is available, run `develop:like-my-code` on it,
     writing into `.claude/conventions/`. If a convention file came back `missing-src` (the
     plugin lacks its template), skip like-my-code and report it; never fail the install.
     Tell it how teams folds `.claude/conventions/**`: plan/setgoal see each file's path and
     first heading only; implement/draft get a file's full text only when its path or first
     heading names an extension or directory of the subgoal's target files; planning/manager
     get all full text. The whole block is cut at 4000 chars (truncated with a marker, not
     dropped), so the total of all convention files must stay <= 4000 chars. Have it put the
     language extensions and source dirs in the `coding.md` first heading, so implement
     matches it, check the length after writing, and trim the lowest-ratio rules first;
     evidence stays in the chat report. If `develop` is not installed, skip and print
     `/plugin install develop@newkayak12-claude-skills`; never fail the install.
     Report the outcome: ran / declined / skipped: develop absent / skipped: missing-src.
4. **Tool discovery** — confirm all sixteen tools are visible: six `team_*` tools (`team_open`,
   `team_next`, `team_run`, `team_submit`, `team_retry`, `team_status`) and ten `tm_*`
   tools (`tm_open`, `tm_next`, `tm_submit`, `tm_retry`, `tm_status`, `tm_events`, `tm_board`,
   `tm_ticket`, `tm_docs`, `tm_clean`). If any are missing, tell the user to reload Claude Code — this is
   the install gate; do not open a real task just to test setup. Once a task is open, main
   watches it with `tm_status({task_id})` and never drives a node itself.
5. `"refresh": true` only backfills keys a newer plugin version introduced into an existing
   `team.json`; it never changes a value the project already set. Use it after bumping the
   plugin version, not on a routine install.

## Install modes

Prefer the marketplace plugin. Its `.mcp.json` already registers the `teams-engineering`
and `task-manager` stdio servers, so installation should not add project files beyond what
`install.mjs` writes. Ask the user to install or update `teams@newkayak12-claude-skills`
and reload Claude Code if needed.

Use a project-local connection only when the user explicitly wants to run from a source
checkout instead of the marketplace plugin. Merge this entry into the target project's
existing `.mcp.json`; preserve every unrelated server and use an absolute path:

```json
{
  "mcpServers": {
    "teams-engineering": {
      "command": "node",
      "args": ["/absolute/path/to/teams/mcp/broker.mjs"]
    },
    "task-manager": {
      "command": "node",
      "args": ["/absolute/path/to/teams/mcp/taskmanager.mjs"]
    }
  }
}
```

The task manager keeps its state under `~/.harness/tasks/` (override with `HARNESS_TASKS_DIR`),
never under a project. It needs the project to be a git repository: each package of a large
request runs in its own `git worktree` branched from HEAD.

Do not use `${CLAUDE_PLUGIN_ROOT}` in a project-owned `.mcp.json`; that variable belongs to the
plugin's own manifest. Do not register both marketplace and project-local copies: two servers
exposing the same `team_*` tools make routing ambiguous.

## Dispatch gate (optional)

The plugin ships a `PreToolUse` hook, installed with it — nothing to register. It does nothing
until `.claude/teams-dispatch.json` exists, which `install.mjs` now writes from the
`dispatch` argument (step 2) instead of by hand:

```json
{"paths": ["src/**", "packages/**"], "min_chars": 400, "allow": ["**/*.generated.*"]}
```

With that file present, a write to a gated path is denied **while no task is open**, and the
message tells the session to call `tm_open` instead. Once a task is open every write passes —
nodes have to write. The point is the handoff at the start: the driving session dispatches the
work rather than doing it inline, which keeps its context flat and puts every change through a
gate, a reviewer of a different identity, and its own branch. Every field is optional, no file
means no gate, and the hook fails open on any error.

## Verification

1. Confirm `node --version` is 18 or newer.
2. Validate the selected server path exists when using project-local mode, then complete step 4
   of Process above.
3. If a later task uses a named vendor, verify that vendor separately. `orchestrate` uses
   balanced allocation: reasoning prefers the driving host/model, Implement/Test prefer the
   other vendor's efficient model. It declares `host_vendor`, `host_model`, and supported
   `native_models`; external executors pass readiness checks. Fable/Astra require explicit
   model requests. Verify that role isolation is available before running work; an MCP
   connection alone does not provide new AI sessions. A bare `tm_open({vendor: "auto"})` call
   stays on `self`; a named vendor fails instead of silently degrading.

## What Claude Does / What You Do

| Claude | You |
|--------|-----|
| Proposes dispatch patterns and role toggles; optionally runs `develop:like-my-code` for a reference project | Confirm the dispatch patterns and roles; say whether a reference project exists |
| Runs `install.mjs` for every deterministic file op, confirms tool discovery | Commit `.claude/team.json`, `.claude/teams-dispatch.json`, `.claude/conventions/`, and the CLAUDE.md block so the gate applies team-wide |
| Reports honestly from the script's JSON | After a plugin version bump, re-run with `"refresh": true` to backfill new `team.json` keys |

## Related

- `orchestrate` — drive a request through the connected graph
- `remove` — uninstall what this skill wrote
- `patch` — prepare a teams plugin source release
- `develop:like-my-code` — optional: derive conventions from a reference project
- `harness:install` — the harness's own project installer (shares conventions and marker dir)
