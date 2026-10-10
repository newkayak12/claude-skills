# session plugin, Bundle G: session board and main-moved broadcast (design)

Status: DESIGN, awaiting approval (CLAUDE.md "Design Changes": plan, setgoal, critique, approval, then code). No code yet.
Plugin `session` (0.3.0). Picked on 2026-10-10 from the G list: G3 (main-moved broadcast) and G6 (session board). User decisions the same day: the board is the default place to see things; it shows harness, graph and teams as their current panes do; every mod UI is drawn with Ink (CLAUDE.md "Mods" line; local `plan/mod/README.md` rule 7).
Principles: `plan/mod/README.md` (interactive-only UI, every hook fails open, no plugin depends on a mod); API facts: the `plugin-authoring` types (engine 2.1.294).

## Context
Several sessions run at once on this repo, each in its own worktree. Today:
- harness, graph and teams each show **their own session's** run only: `/harness-gate` (reads `.harness-run/<run>/`), `/graph-live` (`.harness-run/broker/runs/*.json`), `/teams-live` (`teams/scripts/view.mjs`, `.teams_output/broker/runs/*.json`). None shows other sessions.
- The mod API has **no session list**: `$.session.send` needs a name or id, and nothing enumerates sessions. A board therefore needs each session to write its own row somewhere shared.
- origin/main moves from other sessions; the person and the model learn it only on the next `git fetch` (memory "fetch before editing claude-skills").

## Problem
1. No one place shows which sessions are open, on which branch, how full, how costly, and whether a harness/graph/teams run is live in them.
2. A push to main in one session is invisible to the others until they fetch, so they edit and bump versions on a stale base.

## Design

### Shared piece: the heartbeat row
- Each interactive main session writes one row `board.session:<sessionId>` = `{ sessionId, name?, root, branch, repo, context %, cost usd, task?, runs, ts }`.
  - `repo` = `git rev-parse --git-common-dir` resolved to an absolute path, so all worktrees of one repo share it.
  - `runs` = harness, graph and teams state for this session's root, **read the way each plugin's own pane reads it today** (user decision 2026-10-10), so the board and `/harness-gate`, `/graph-live`, `/teams-live` never disagree:
    - harness: `.harness-run/<run>/`, the newest live run else the newest; `running` / `stalled` / `finished` · `done/total`; live = not finished and touched within 2 h (`harness/hooks/mod.tsx` `LIVE_MS`, lines 133-153).
    - graph: the newest `.harness-run/broker/runs/*.json`; `running` / `blocked` / `finished` · `done/total` (`graph/hooks/mod.tsx` `runState`, `LIVE_MS` 2 h).
    - teams: its pane calls the teams plugin's `view.mjs`, which the session plugin cannot locate; the board reads the newest `.teams_output/broker/runs/*.json` and maps it like graph (`running` / `stalled` / `finished` / `failed`). Checked against `view.mjs --format summary` in the spike.
    - The readers are copied into `session/hooks/runs.ts` with an origin comment, as `draw.tsx` is copied today ("copies may drift, so change one and diff the other"); no import across plugins.
- Written at `session.start` and each `turn.complete` (the hooks mod.tsx already has, no new unmatched hook). Rows older than 24 h are dropped on read; a row is "idle" past 30 min.
- Storage: `$.store` (already used for the cross-session recap record). If `$.store` turns out to be per-session (see Critique 1), fall back to one JSON file per session under `~/.claude/session-board/` via `$.fs`.

### Components
| # | Name | Seam | Behaviour |
|---|---|---|---|
| G6 | Session board | `/board`, band button `Board`, Pane `board` (Ink), heartbeat rows | the default place to see what the session plugin knows. One row per live session: name or short id, branch, context %, cost, task, then one cell per plugin in that plugin's own words and marks (`harness ● running 3/5 · graph – · teams ✔ finished`); this session first, then by `ts`. A row with a live run names the command that opens its detail in that session (`/harness-gate`, `/graph-live`, `/teams-live`). Read-only; a row's `Send` button prompts for text and calls `$.session.send({ to: { sessionId } })` |
| G3 | Main-moved broadcast | `tool.call` after-result on Bash, `$.session.send` | when a Bash call in this session ran `git push` whose target is `main` (`origin main`, `HEAD:main`, or a bare push on branch `main`) and exited 0: send `origin/main moved to <short sha> by <this session>: <subject>. Fetch before editing.` to every other row with the same `repo` and `ts` ≤ 30 min. One toast here: `told N sessions`. |
| G0 | Ink for the 0.3.0 views | Pane `board` tabs | per the CLAUDE.md Ink rule: `/recap`, `/lessons`, `/task log` and `/handoff` show their text as a tab of the board pane (Recap, Lessons, Today) interactively; their `{ text }` stays for headless. The 0.3.0 `recap` pane folds into the Recap tab |

### Data flow
start / turn end → heartbeat row → `/board` reads all rows → pane. Bash push to main (exit 0) → read rows with the same repo → `session.send` each → their transcript gets the message (they read it on their next turn).

### Error handling
- Every hook ends in `.catch(($, e, next) => next(e))`; a failed git call leaves the field empty, a failed send is skipped (counted in the toast as `N of M`).
- Headless (`surfaces().length === 0`): no row is written, no broadcast, `/board` still answers `{ text }`.
- A send to a session that has ended is refused by the engine; that row is deleted.

### Testing (`claude plugin test session`)
1. heartbeat: row written at start and turn end with branch, repo, %, cost, runs; headless writes none.
2. runs: newest entry per dir and live flag from a mocked `fs.list`; a missing dir gives none.
3. board: rows sorted, this session first, rows > 24 h dropped, idle marked; `/board` text in headless.
4. G3: push to main (three spellings) exit 0 → one send per same-repo fresh peer, none to other repos, stale peers or itself; push to a feature branch or exit ≠ 0 → no send.
5. Existing tests still pass; `claude plugin validate session` clean.

## Done-criteria
- Two live sessions in two worktrees of this repo: each sees the other on `/board`, with a harness/graph/teams run marked live while it runs (checked by hand once).
- A push to main in one session puts the fetch message in the other's transcript (checked by hand once).
- Nothing blocks a tool call or turn; headless draws and sends nothing.
- `/recap`, `/lessons`, `/task log`, `/handoff` open board tabs interactively; headless text unchanged.
- README.md and KOR.md describe all three; session bumped to 0.4.0.

## Critique
1. **Half proven:** the types say `$.store` is "kept between sessions", one JSON file per plugin under the config dir, so E2 and the board can read across sessions. Not said: whether two **concurrent** sessions see each other's writes live or overwrite each other from a cached copy. Check it first; one file per session under `~/.claude/session-board/` via `$.fs` is the plan B.
2. **Assumed, not proven:** `$.session.send({ to: { sessionId } })` reaches a sibling top-level session (the types word it as SendMessage recipients: ListAgents names). If it only reaches subagents/teammates, G3 and the board's Send button fall back to a toast-only board (G3 then shows `main moved` on the *other* session's next turn by reading a `board.main:<repo>` record instead of sending).
3. **Overlap:** the board does not replace `/harness-gate`, `/graph-live`, `/teams-live`; it shows one line per run and names the detail command. The price of matching their words is three copied readers that can drift; each copy names its origin, and a board test feeds the fixtures the originals' tests use. `mods` feature 5 already fetches at session start and toasts when origin/main is ahead; G3 covers the mid-session case it misses.
4. **Noise (G3):** a burst of pushes sends a burst of messages; one message per peer per 2 min (latest sha wins).
5. **YAGNI:** the Send button is extra; cut if the board alone is enough.

## Open questions
1. Board scope: this repo's sessions only, or every session on the machine (rows carry `repo`, so both are cheap)? Proposal: all, this repo's first.
2. Keep the Send button?
3. Build order proposal: verify Critique 1–2 and the teams reader with a two-session spike → heartbeat → G6 → G0 → G3.
