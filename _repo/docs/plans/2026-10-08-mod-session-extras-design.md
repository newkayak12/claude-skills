# session plugin, Bundle E: flow extras around smart-compact (design)

Status: DESIGN, awaiting approval (CLAUDE.md "Design Changes": plan, setgoal, critique, approval, then code). No code yet.
Plugin `session` (0.2.0) already ships the ledger/retro, guard, memo and `/smart-compact`. This doc covers eight small additions picked on 2026-10-08.
Principles: `plan/mod/README.md` (interactive-only UI, every hook fails open, no plugin depends on a mod); API facts: the `plugin-authoring` types (engine 2.1.294).

## Context
`/smart-compact` (session 0.2.0, shipped without a design doc) forks one recap over the transcript and compacts with it. The recap is the most useful artefact the plugin makes, and it is thrown away after the compact. Several asks reuse it (resume, handoff, lessons); the rest are small session-awareness signals (cost, time, idle, big diffs, vague prompts).

## Problem
1. A recap made at compact time is lost: the next session and other sessions cannot read it.
2. The person cannot see what the session costs or how long a task took without leaving the terminal.
3. Large unattended edits get no second look until the person reads the diff.

## Design

### Shared pieces
- `recap.ts`: the recap prompt (moved out of `compact.ts`) plus one new section, `6. Corrections: things the user had to correct more than once`. One fork serves smart-compact, `/handoff` and lessons.
- Recap record in `$.store`: `recap.project:<root>` = `{ text, ts, sessionId }`, last one only. Written by smart-compact and `/handoff`.
- Registration rule found while shipping 0.2.0: a module graph may hold **one unmatched hook per event**, and `$` cannot be passed into an imported function. New modules therefore use matched hooks (`{ reason: 'answer' }`, `{ command }`, `{ component, requestId }`) or live in `mod.tsx`'s existing unmatched hooks.
- New userConfig rows (all visible in `/config`): `cost_budget_usd` (number, 0 = off), `review_lines` (number, 0 = off, default 300), `prompt_hint` (boolean, default false), `idle_minutes` (number, 0 = off, default 0).

### Components
| # | Name | Seam | Behaviour |
|---|---|---|---|
| E1 | Cost in status | `turn.complete` (mod.tsx), `$.session.usage()` | status line gains `$1.23 · 5h 42%` (cost.usd, highest `rateLimits.percentUsed`); one toast per session when `cost_budget_usd` is crossed |
| E2 | Resume briefing | `session.start`, existing AbovePrompt band, Pane `recap` | if a recap record exists for this root and is newer than 7 days, the band shows `last recap <age>` with a `Recap` button that opens a read-only pane with the text; `/recap` prints it |
| E3 | Idle reminder | `turn.complete` + `$.clock.sleep`, `turn.start` | `idle_minutes` after an answered main turn with no new turn: one toast `session waiting <n>m`; a new turn cancels it |
| E4 | Big-diff review | `turn.complete`, ledger numstat, `$.agent.spawn` | when lines changed this turn ≥ `review_lines`, spawn one background review subagent (model `sonnet`, prompt: review `git diff` of the touched files, report blocking issues only); toast its first line; `/review-last` prints the whole answer. At most one review in flight; cooldown 10 min |
| E5 | Lessons | recap section 6, `$.store` `lessons.project:<root>` | each recap's Corrections lines are appended (exact-dup dropped, cap 20); `/lessons` lists them with a "move to CLAUDE.md?" hint; `/lessons clear`. Never writes CLAUDE.md |
| E6 | Task timer | `/task`, status line, `$.clock` | `/task <name>` starts, `/task` shows, `/task done` stops and logs `{ name, ms, day }`; status line shows `⏱ <name> 12m`, refreshed each minute from the stored start (survives reload); `/task log` prints today's totals |
| E7 | `/handoff` | `/handoff [to]`, `$.model.fork`, `$.session.send` | makes a recap now, saves it as the recap record (feeds E2, E5), prints it; with `to` (a session name or id) also sends it there |
| E8 | Prompt hint | `prompt.submit` (observe only) | when `prompt_hint` is on and a prompt is ≤ 20 chars, holds a task verb (만들/고쳐/추가/fix/add/make…) and no path or code: one toast `scope or check missing?`, at most once per 10 min; the prompt is never changed |

### Data flow
smart-compact or `/handoff` → fork recap → store recap record (+ lessons from section 6) → next `session.start` reads it → band/pane (E2). Turn end → usage (E1), numstat (E4), idle timer (E3). Commands write their own store keys; nothing touches the transcript except the review answer, which stays in the store.

### Error handling
- Every hook ends in `.catch(($, e, next) => next(e))`; a failed fork, spawn, send or store call is a toast in interactive mode and silence headless.
- Headless (`surfaces().length === 0`): E1, E3, E4, E8 do nothing; commands still answer `{ text }`.
- E4 spawn refused or failed: no retry, the cooldown still starts. E7 send to an unknown session: the recap is still saved and printed, the toast names the failure.
- Store over its cap: recap and lessons are trimmed to their caps before write (recap ≤ 8 KB).

### Testing (`claude plugin test session`)
1. recap record written by smart-compact and by `/handoff`; E2 band shows it on the next start, hides it past 7 days.
2. lessons: Corrections lines appended, duplicates dropped, cap 20 holds.
3. E1: status text with cost and rate limit; budget toast fires once.
4. E3: toast after the sleep; a `turn.start` in between cancels it (mock clock).
5. E4: spawn only at ≥ `review_lines`; none while one is in flight or inside cooldown; `review_lines: 0` never spawns.
6. E6: start/show/done/log; elapsed computed from the stored start after a reload.
7. E7: `/handoff` saves + prints; `/handoff x` calls `session.send` with `to: 'x'`.
8. E8: fires only on short task prompts, only when on, rate-limited, prompt text unchanged.
9. Existing 365 tests still pass; `claude plugin validate session` clean.

## Done-criteria
- Each of E1–E8 behaves as in the table in a live terminal session (checked by hand once) and in its tests.
- New userConfig rows appear in `/config`; defaults keep E3, E8 off and E4 at 300 lines.
- No hook can block a prompt, a tool call or a turn; headless runs draw nothing.
- README.md and KOR.md describe all eight; session bumped to 0.3.0.

## Critique
1. **Native overlap (E3).** Claude Code already notifies when it waits for input (terminal bell / notification channel). E3 only adds a repeat reminder after N minutes; hence default off. Candidate to cut.
2. **Noise (E8).** The heuristic will misfire on terse but clear prompts (this user's own style). Default off, rate-limited, observe-only. Candidate to cut.
3. **Cost (E4).** One subagent per big turn; bounded by threshold, cooldown and one-in-flight, and `review_lines: 0` turns it off. Still the only feature that spends tokens unasked.
4. **Recap quality drives three features (E2, E5, E7).** A weak recap degrades all three; section 6 is extra prompt length on every smart-compact.
5. **YAGNI.** Eight features in one bundle is a lot; E1, E2, E7 carry most value, E6 is independent, E3/E8 are the weakest.
6. **Assumed, not proven:** `$.agent.spawn` runs while the main loop is idle; `$.clock.sleep` long waits survive (a reload drops them, acceptable); `$.session.send` addresses a session by name.

## Open questions
1. Keep E3 and E8 at all, given Critique 1–2? (default proposal: keep, off by default)
2. E4 reviewer: plain `$.agent.spawn` with a prompt, or a registered `session:reviewer` agent type?
3. E6 log: today only, or a `/task log week`?
4. Build order proposal: E7+E2 (recap record) → E5 → E1 → E6 → E4 → E3 → E8.

## Decisions (2026-10-08, approved by the user)

- E3 (idle reminder) and E4 (big-diff review) are on hold: not built in this round, their userConfig rows (`idle_minutes`, `review_lines`) are not added.
- E8 stays, off by default (`prompt_hint: false`), matched on `origin.kind: 'composer'` so it sits beside memo's unmatched `prompt.submit`.
- E6 log shows today only.
- Build order: E7+E2 (recap record) → E5 → E1 → E6 → E8; ships as session 0.3.0.
- No separate plan/mod file: the table above is the plan; the user asked to move fast.
