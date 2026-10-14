---
name: mod-shot
description: Use when a mod's UI (pane, band, card, toast) changed in this repo and must be checked live and shot for the README — opens it in a real Claude Code session, checks open/close and widths, writes PNGs. Internal maintenance skill, not shipped.
---

# mod-shot — see a mod live, shoot it, introduce it

Rule it serves: `.claude/rules/mod.md` "A UI change is done when".

## Process

1. **Demo folder** (outside the repo, e.g. the job tmp dir). Fictional, generic data only — no real
   project, task, company or person: a harness run under `.harness-run/<slug>/`, a graph run under
   `.harness-run/broker/runs/<id>.json`, a teams task under a folder passed as `HARNESS_TASKS_DIR`, a
   debate log under `.claude/brainstorming/<slug>.jsonl`. Include one reject + retry so the panes
   show their decision lines.
2. **Live session.**
   `tmux new-session -d -s shot -x 190 -y 36 -c <demo> "HARNESS_TASKS_DIR=<demo>/tasks claude --plugin-dir <repo>/<plugin> ..."`;
   wait ~15s; send the command with `tmux send-keys -t shot -l "/<name>-status"` then `Enter`
   (a bare letter typed before the prompt is ready lands in the prompt).
3. **Open/close check.** Open by the command and by the band line; close by `q`, `Escape`, and the
   command again; `tmux capture-pane -p` after each and count the pane's own marker text.
4. **Width check.** Shoot at 190 and at 110 columns (`tmux resize-window -t shot -x 110`). Fix any
   wrapped tab, label pushed under another, split word, or missing close button, then reshoot.
5. **Shoot.** `python3 _repo/scripts/mod-shot.py shot <plugin>/docs/images/<name>.png [--rows A:B] [--cols A:B]`
   (`--cols 95:` keeps the right-side pane at 190 columns). One image per surface that changed.
6. **README.** In `<plugin>/README.md` and `KOR.md`, each image with one or two lines: what feedback it
   gives the person and when. Read the PNGs before committing.
7. `tmux kill-session -t shot`.

## Output Template

```
mod-shot — <plugin>
  open/close: command ✓ band ✓ · q ✓ Esc ✓ command-again ✓
  widths: 190 ✓ 110 ✓ (fixed: <what>)
  images: <plugin>/docs/images/<a>.png, <b>.png
  README/KOR: <sections touched>
```

## What Claude Does / What You Do

| Claude | You |
|---|---|
| Builds fictional demo data, runs the live checks, fixes width breaks, shoots and writes the README lines | Look at the images; say if a surface reads wrong |

## Related Skills

- `.claude/rules/mod.md` — what a mod is and when its UI change is done
