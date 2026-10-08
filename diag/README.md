# diag (beta)

Records failures of this marketplace's skills and MCP tools in interactive sessions, shows them in a `/diag` pane, and, only when trophy's telemetry consent (v2) is yes, sends fixed error codes and counts. Beta: version `0.1.0-beta.2`. Requires Claude Code 2.1.292+ (hooks module, interactive sessions only).

## Install
```
/plugin install diag@newkayak12-claude-skills
```

## What is collected automatically (local only)
Events are kept on your machine in the plugin store (newest 500; the same reason + skill/tool + session within 5 s counts once):
- an owned skill failed to load or returned an unsuccessful result (also forked skills);
- an owned MCP tool call failed (`mcp_error`); an interrupt is yours, not a bug;
- harness run outcomes (subgoal or goal gate failed);
- `/diag bug <note>` reports.

"Owned" means a skill or tool of a plugin from this marketplace; a bare skill name is not owned. Raw error text and your notes stay local.

## /diag
- `/diag` opens the pane: the local failures with details, and whether sending is on or off.
- Above the prompt, a one-row band `✘ N diag <last failure>` with a `보기` button shows failures recorded since you last opened the pane. Opening the pane clears it. Your own `/diag bug` reports do not count. Local display only; nothing is sent.
- `/diag bug <note>` records a report. The note stays local; only the fixed code `user_report` can be sent.

## What is sent
Only when trophy's consent is **yes at consent text version 2** (a v1 yes is asked once more; no is never re-asked). A send is tried once per session, on the first main-loop turn, for days not yet sent up to yesterday (UTC), to PostHog `https://us.i.posthog.com/batch/`. One event per day, reason, plugin and skill/tool, with `count`:

| Event | Properties |
|---|---|
| `diag_skill_error` | `skill`, `plugin`, `reason` (`is_error`, `unsuccessful`, `forked_unsuccessful`), `count`, `day` |
| `diag_mcp_error` | `tool` (MCP tool name), `plugin`, `reason` (`mcp_error`), `count`, `day` |
| `diag_user_report` | `reason` (`user_report`), `count`, `day`, plus `skill` and `plugin` when known |

Each event also has a `timestamp` (the event's day at 12:00 UTC) and `$process_person_profile: false`. Every event also carries a random install id (made on first run, not derived from you or your machine). The first consented send includes earlier local days (codes only), not just yesterday. A failed send is kept and retried in a later session. The body is exactly what the pane previews.

Correlation note: diag sends to the same PostHog project as trophy. Its install id is separate from trophy's, but diag and trophy events from the same machine can still be matched server-side (by day and skill/plugin names). Neither carries anything that identifies you.

## What is never sent
Local error text, your `/diag bug` notes, file paths, run slugs, subgoal names, session ids, harness outcomes (subgoal/goal results), prompts, working directory, project or file names, username or email.

## Turning it off
`/trophy-telemetry off` stops sending for both trophy and diag. Without trophy installed, diag never sends.

Note: in a non-interactive session `/trophy-telemetry status` can show a v2 yes as "v1 yes"; the stored consent is unchanged.

## Pending live checks (L1-L7)
Not yet verified in a live session:
- L1 a failed Skill call raises `PostToolUseFailure` (it may be refused earlier, so only load failures are certain);
- L2 a subagent `Write` raises the parent module's `tool.call`;
- L3 a Bash `tool.call` result exposes `stdout` for the `COMPLETE ... goal-gate FAIL` line;
- L4 marketplace candidates resolve for `--plugin-dir` and installed copies; MCP server names are readable;
- L5 `/diag` registers unshadowed;
- L6 diag reads trophy's consent live (and gets `undefined` without trophy);
- L7 the live report query against the PostHog project.

## Maintainer
`POSTHOG_PERSONAL_KEY=<key> node _repo/scripts/diag-report.mjs [--days 30]` ranks `diag_*` events by distinct installs, then count.
