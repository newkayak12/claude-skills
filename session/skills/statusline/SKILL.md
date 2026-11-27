---
name: statusline
description: >-
  Use when the session status line must be installed, inspected or removed by command, e.g. where a policy plugin skips session's status-line hook; writes or removes one statusLine entry in settings.json.
scenarios:
  - "/session:statusline"
  - "상태줄 설치해줘"
  - "session 상태줄 꺼줘"
  - "Install the session status line into my settings"
  - "Remove the session status line (statusline off)"
compatibility:
  optional: []
---

# Statusline

Install or remove session's status line as a `statusLine` entry in the user's `settings.json`. A stable copy of the scripts lives in the plugin data dir. Every decision is made by `statusline-install.mjs`; this skill relays it and asks the person when it exits 3.

## Process

1. **Split `$ARGUMENTS`.** Take the first word. If it is `on`, `off` or `show` (any case), that is the mode and the remaining words are `<rest>`. Otherwise the mode is empty and `<rest>` is all of `$ARGUMENTS`. The CLI must get exactly one mode word: never pass a second one. The words of `<rest>` (e.g. `--settings` and its path) are passed as separate arguments, never joined into one quoted word or a shell variable.
2. **Show.** Run:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline-install.mjs" show --data "${CLAUDE_PLUGIN_DATA}" <rest>`
   If `${CLAUDE_PLUGIN_ROOT}` is empty, use `../../scripts/statusline-install.mjs` relative to this SKILL.md. An empty or literal `--data` value is fine: the script derives the data dir. Tell the person the settings path, the data dir and the current `statusLine`.
3. **Choose the action.** Mode `show`: stop after step 2. Mode `off`: run `off`. Mode `on` or empty: run `on`.
4. **Run it once** with the same `--data` and `<rest>`:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/statusline-install.mjs" <on|off> --data "${CLAUDE_PLUGIN_DATA}" <rest>`
   A `statusLine` that is not there yet is added without asking.
5. **Exit 3** (the person's own `statusLine` is set): show it, and ask in so many words: "Your own status line will be replaced by session's; the old value is saved to `previous.json` in the data dir. Replace it?" Rerun `on --replace` with the same arguments only after an explicit yes. With no person to answer (headless), do not replace; report it.
6. **Exit 2**: relay the usage or error line; change nothing.
7. **Report** what the script printed (written, refreshed, removed, kept) and tell the person:
   - the line takes effect on the next refresh or in a new session;
   - rerun `/session:statusline` after a plugin update to refresh the copy;
   - run `/session:statusline off` before uninstalling the plugin.

## Output Template

```
settings: <path>
data: <dir> (<given|derived-cache|derived-inline>)
before: <statusLine or none>
result: <added | refreshed | replaced (old saved to previous.json) | removed | left alone>
next: takes effect on the next refresh / new session; rerun after a plugin update; `off` before uninstall
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Splits the mode word off `$ARGUMENTS`, runs `show`, then one of `on` / `off` | Say `on`, `off` or `show` (empty = show, then on) |
| Reports settings path, data dir, current and new entry | Read it |
| On exit 3, asks before replacing your own `statusLine` | Answer yes or no; `--replace` runs only on yes |
| Reminds you to rerun after updates and to `off` before uninstall | Do so |

## Related Skills

- Hook behind the same line: `session/hooks/statusline.ts` (a mod, skipped under some policy plugins).
