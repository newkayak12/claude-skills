# Mod — what it is

A mod is a plugin hooks module (`<plugin>/hooks/*.tsx`, named under `modules` in
`<plugin>/hooks/hooks.json`) that runs on Claude Code client events — `session.start`, `tool.call`,
`turn.complete`, `prompt.submit`, timers — whether or not a skill is running. It is the surface
around the model: what a person sees, and what the client adds on top.

## What a mod owns
- Panes, band lines (AbovePrompt), status line, toasts, push notifications.
- Tool-call guards and confirms (e.g. session guard), context injection (`prompt.context`, memo).
- One pane per plugin, opened by `/<name>-status` or its band line; closes on Esc, q and the command again.

## What a mod does not do
- Hold the source of truth: it reads the files a skill writes (`teams/scripts/view.mjs --once`, run
  JSON, `.harness-run/`), never writes them.
- Parse or decide: logic worth testing lives in node and the mod renders what it returns. A field
  the pane needs and no file records is added to the skill's engine, not inferred in the tsx.
- Decide an outcome a skill owns, or be the only enforcement of a rule (see `compat-claude.md`).

## Rules (shared, from `_repo/docs/plans/mod/README.md`)
1. **Never required.** Removing the `modules` line leaves the plugin fully working.
2. **Interactive only.** Timers, panes, bands and toasts start only when
   `(await $.session.surfaces()).length > 0`; headless `claude -p` runs load the plugin too.
3. **Guards fail open.** Every `tool.call` guard has `.catch(($, e, next) => next(e))`.
4. **State in `$.state`,** declared in `types/index.d.ts`; module variables only for caches a reload may lose.
5. **Release with the plugin.** A mod change bumps that plugin and its README/KOR (teams: CHANGELOG/CHANGELOG.KOR).
6. **Plugin files via `$.plugin.root`.** `CLAUDE_PLUGIN_ROOT` is not set in a `$.process.run` child.
7. **UI is Ink.** Anything a person reads is a `ui.render` tree (Pane or AbovePrompt). A command's
   `{ text }` is the headless answer only; interactive, it opens the pane and returns one line at most.
   No ASCII-art views in `{ text }`, no browser page.

Test: `cd <plugin> && claude plugin test .`, and one live session where the pane opens and closes.

## A UI change is done when
1. **Seen live.** In tmux, `claude --plugin-dir ./<plugin>`, open it by its command and its band
   line, close it by Esc, q and the command again.
2. **Not broken at any width.** Capture at 190 and at 110 columns: no wrapped tab row, no label
   pushed under another, no cut glyph, long text ends in `…`. Fix before shipping, not after.
3. **Shot for the README.** `python3 _repo/scripts/mod-shot.py <tmux-session> <plugin>/docs/images/<name>.png
   [--rows A:B] [--cols A:B]`, one image per surface that changed (pane tab, band, card, toast).
   Demo data is fictional and generic — never a real project, task, company, or person's work.
4. **Introduced in the README.** README.md and KOR.md show each image with one or two lines on what
   feedback it gives the person and when (e.g. "while a run is going, the band says which node is
   working; when it ends, a card offers the report").
