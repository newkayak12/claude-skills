# teams pane — Home dashboard on every surface (card 84, teams 0.61.0)

Written after the fact: the user asked for the work done without stopping ("나한테 묻지말고 해라"), so
this records what shipped and why, for the next mod that takes the same bar.

## Bar
User, 2026-10-26: "캐릭터를 그리라는 소리는 아냐 무조건 내가 준것같은 퀄리티 높은 UI를 제공하란거야 기본으로".
References: a metrics board (tiles), a harness diagram (stages as columns), a terminal agent dashboard,
munder-difflin's kanban command center, harness-animation's numbered pipeline with fan-out/fan-in.
No avatars. This quality is the default for mod UI, not an option.

## What the Home tab shows (one model, three renderings)
`teams/scripts/lib/view-dashboard.mjs` builds one model from `summarize()`; the mod decides nothing.

| Part | Model field | Terminal (Ink) | desktop · mobile · vscode (Svg) | Remote Control (text) |
|---|---|---|---|---|
| EPIC, state, % | `key title state pct` | pane header + `RUNNING ████░░ 17%` | header, chip, bar | first two lines |
| what runs now | `now` | `▸ Build · …` | under the bar | `▸` line |
| tiles | `tiles` (progress, stories, cost, needs you, drivers) | round boxes; one line each below 15 cells a tile | tiles | one line |
| pipeline | `stages`, `packages` | `✔ 1 Plan ━━ ◉ 2 Build ┄┄ …` + package tree | numbered cards, Build fans out to packages and back into Integrate | `✔ Plan → ◉ Build → …` |
| lanes | `lanes` (in progress, needs you, up next, done) | four boxes; one line each below 18 cells a lane | four card columns | one line per non-empty lane |
| waiting | `waiting` | pane header ⚑ line (not repeated) | highlighted bar | ⚑ lines |
| activity | `activity` (6, newest first) | aligned rows | list | last 4 |

A stopped EPIC (cancelled, failed, blocked) shows the stage it stopped in as failed and no `now`.
An EPIC opened from several requests is titled by the backlog cards they name (`deriveTitle`).

## Surfaces
- Svg exists on desktop, mobile and vscode, not the terminal (2.1.310); `$.ui.resolve(e)` still hands
  `Svg` to the terminal, so the choice reads `e.surface`.
- The Claude app over Remote Control does not attach (`$.session.surfaces()` = `["terminal"]`, no
  `session.attach`, checked 2026-10-26), so `/teams-status` answers with `view.mjs --once --format board`.

## Not done
The Svg has not been seen in the Claude desktop app; the phone text has no screenshot yet; the user has
not approved the demo render (`mod.md` UI rule 0).
