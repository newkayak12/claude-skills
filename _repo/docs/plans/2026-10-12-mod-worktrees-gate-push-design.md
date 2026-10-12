# Worktrees tab (session) and gate-deny push (harness) — 2026-10-12

Asked by the user 2026-10-12 ("1. 좋고 2 -> 이건 푸시로 주면 좋고"). Status: approved 2026-10-12; shipped in session 0.6.0 and harness 1.28.0 (checked live: Worktrees tab cleaned a merged scratch worktree and its branch; a deny called PushNotification from the mod, not sent while at the terminal, so the toast showed).
Governing docs: `2026-10-10-mod-session-board-design.md` (board tabs, Ink views), `2026-10-08-mod-guard-design.md`
(fail open, interactive only), harness gate stays a command hook (review 2026-10-12: the mod only displays).

## 1. session: `/board` Worktrees tab

Why: cleaning worktrees by hand is the most repeated chore (merged? dirty? another session on it? copy
`.harness-run` first? `-d` not `-D`).

- New board tab `worktrees` (key `5`), also `/board worktrees`. Interactive only.
- One row per `git worktree list --porcelain` entry of the session's repo: path, branch (or detached),
  uncommitted count (`git -C <wt> status --porcelain`, ignored files not counted), merged into the
  main branch (`git merge-base --is-ancestor <head> main`), last commit age, **in use** when an open
  session on the board has its cwd inside that worktree.
- A **Clean** button only on rows that are: not the main checkout, merged, 0 uncommitted, not in use,
  path exists. It asks first (`$.ui.ask` Clean/Cancel), then:
  1. if `<wt>/.harness-run/` exists, copy each run folder to `<main>/.harness-run/<name>`; a name already in
     main, or any copy failure, stops the clean (ignored files go with the worktree, so nothing is skipped);
  2. `git worktree remove <wt>` (never `--force`);
  3. `git branch -d <branch>` (never `-D`; a refusal is reported, the worktree stays removed).
  Each step's result is one line in a toast; the tab refreshes.
- Rows that are not cleanable show why (`unmerged`, `3 changes`, `in use`, `main`). No other action.

## 2. harness: push when the gate denies

Why: agents and headless runs hit the gate while the user is away; the denial is only in the transcript.

- The gate already writes `.claude/.harness-last-decision.json`; the harness mod's tick (`mod.tsx:351`)
  reads it. On a new `deny` (newer than the last one seen) the mod calls
  `$.tool.call({ tool: 'PushNotification', message, status: 'proactive' })`, message ≤ 200 chars:
  `gate denied <Tool> <path>: open a harness run to edit it`.
- PushNotification skips itself when the user is at the terminal; then the mod shows the same line as a
  toast instead. One push per path per 10 minutes. Interactive sessions only (the mod is off headless).
- The gate's behaviour does not change.

## Done when

- session: tests for row facts (merged/dirty/in-use/main), Clean only on eligible rows, `.harness-run` copy
  before remove, no `--force`/`-D` anywhere, a failed copy stops the clean; `claude plugin test/validate session`.
- harness: tests for new-deny detection, rate limit, push → toast fallback; `claude plugin test/validate harness`.
- Live (pty): Worktrees tab lists this repo's worktrees and cleans a merged scratch worktree; a forced gate
  deny raises the toast (push not sent while at the terminal).
- README/KOR for session and harness; minor bumps (new features).

## Critique (author's)

- `$.tool.call('PushNotification')` from a mod is assumed to work like `TaskStop` did (measured for TaskStop
  only). First implementation step proves it live; if it fails, fall back to toast only and say so.
- "In use" depends on the board's session list; a session not on the board (other machine, crashed) is not
  seen — Clean still requires merged + clean, so the worst case is removing a clean merged worktree.
- Copying `.harness-run` can collide with a run of the same name in main: the clean stops and says which
  name, since `git worktree remove` deletes ignored files and a skipped copy would be lost.
