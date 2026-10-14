# Status panes: teams control panel, graph/harness "what the agent does", brainstorming debate (design)

Date: 2026-10-14. Governing docs: `_repo/docs/plans/mod/README.md` (shared mod rules 1-7),
`_repo/docs/plans/2026-09-28-teams-cards-everywhere.md` (cards are the human surface),
`_repo/docs/plans/mod/02-teams-live.md`, `06-teams-report.md`.

## Why
User, 2026-10-14: teams is a black box — the pane must be the whole control panel: each team,
each card's state, what each team is doing now, and the decisions (who proposed, who rejected,
why), in the same shape as a brainstorming debate. graph and harness share one shape and must say
what the agent is doing, more plainly than today's tabs. Names unify on `-status`. The 2026-10-12
"merge into /board" proposal was never answered; decided now: each plugin keeps its own pane,
board's role is decided later (out of scope).

## Decisions
1. Commands: `/teams-status`, `/graph-status`, `/harness-status`, `/brainstorming-status`. Old
   names (`teams-live`, `graph-live`, `harness-gate`) removed; README/KOR and tests move with them.
2. Every pane opens by its command or its band line; closes on Esc, q, and its command again —
   each covered by a test and tried once in a real session.
3. One layout for all four, top to bottom:
   - **Now**: one line per active actor — team/stage/node, agent (vendor·model where recorded),
     elapsed.
   - **Body tabs** (plugin-specific, below).
   - Band line while running, end-of-run card after (teams' existing card pattern).

### teams-status tabs
| Tab | Content | Source |
|---|---|---|
| 1 Teams | one row per team (planning PLAN-Fn, develop STORY, QA-Fn, AUDIT): cards with state, what it does now | task.json `planning_pkgs`, `nodes`, `board.jsonl` |
| 2 Decisions | timeline: proposal → verdict (accept/reject, score, blocking/problems/gaps) → retry/resplit/defect filed → human answer, each with actor and reason | node `result`, `feedback`, ledger `daemon_retry_*`, `daemon_rejudge`, `plan_integrate_*`, `tm_submit_human`, `decisions[]`, defects `evidence` |
| 3 Log | as today | |
| 4 Report | as today | |

Selecting a card (↑↓ Enter) shows its own decision thread.

### graph-status / harness-status tabs
| Tab | graph | harness |
|---|---|---|
| 1 Flow | stages with attempts; a reject shows its reason and the next attempt under it | run files; critique/gate/goal-gate rejects with reasons |
| 2 Detail | per node: vendor·model, feedback carried, timing | per subgoal: result, gates; harness Gate rules folded here |

### brainstorming-status
Debate mode in `think:brainstorming` (Claude proposes it for one-way/cross-functional/undecided
choices; the user says yes; or the user asks). 3 personas Claude picks and shows (user may swap),
independent subagents (model named), diverge → devils-advocate attack/rebut ≤2 rounds → Claude
cuts with kill-criteria. Each utterance is one line in a debate log the skill writes and the pane
only reads. Tab 1 Timeline (↑↓ scroll, Tab filters by persona, "speaking now"), 2 Options (for/against
per option), 3 Result. Under 2 agents left → falls back to normal mode and says so.

## Data: recorded vs. to add
Recorded and unused today (pane reads it, no engine change): critique `blocking/problems`,
accept `gaps/match_pct/reason`, `feedback`, `judge_attempts`, `board.jsonl`, defect `evidence`,
`decisions[]`, graph node `vendor/model/feedback`, superseded retry nodes.

To add (engine change, smallest form):
- teams: a ledger `verdict` line when a judge node settles — `{node_id, stage, actor (vendor·model),
  verdict, score, reason ≤300}` — so a re-judge does not erase the earlier verdict.
- teams: `tm_submit_human` carries the answer text (truncated).
- teams: vendor·model on judge/dispatch nodes (already on graph nodes).
- harness: none in this round; "Now" shows stage from files only, the agent column reads
  "—" (no ledger exists; adding one is a separate decision).

All parsing lives in node (`teams/scripts/view-*.mjs`, graph/harness equivalents) with node:test;
mods render what the CLI returns (mod rule: logic outside the mod).

## Out
board's new role; reviewer full reasoning from raw streams; harness ledger.
