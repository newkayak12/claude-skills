# Older Claude Code builds

Mods need Claude Code 2.1.292+ (early-access hooks module API). Everything else in a plugin —
skills, MCP servers, command hooks in `hooks.json`, CLIs — must work on builds without it.

- A plugin's function never depends on its mod. Removing `modules` (or a build that ignores it)
  loses only the surface: panes, bands, toasts.
- A gate or deny a person must not skip is a command hook (`hooks.json` `"type": "command"`), an
  MCP refusal, or an engine check — not only a mod `tool.call` guard.
- Every status a mod shows has a non-mod way to read it (a CLI such as `teams/scripts/view.mjs
  --once`, an MCP tool, the run files).
- A change to a mod API usage is checked with `claude plugin validate` and `claude plugin test`;
  a hook that changes behaviour is also tried once without the mod (remove `modules` locally).
