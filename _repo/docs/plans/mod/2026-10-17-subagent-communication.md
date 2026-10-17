# Subagent communication through mods — draft (card 49)

Status: approved 2026-10-17 (decisions in §6). Backlog card 49.

User, 2026-10-17: "mod 추가로 subagent 간 의사소통하는거 더 적극적으로 활용할 수 있는 방법 찾아보자".

Governing rules: `.claude/rules/mod.md` (never required, interactive only, guards fail open, the mod
reads files and never holds the truth), `.claude/rules/compat-claude.md` (a gate never depends on a
mod; every status has a non-mod way to read it), and the Floor section of
`2026-10-16-mod-detail-and-parallel-runs.md` ("a glance, not a read").

## 1. Today: workers talk only through files

| Who | How it runs | How it hands over |
|---|---|---|
| teams package driver (P1…Pn, QA) | its own `claude -p --output-format stream-json --plugin-dir <teams>` process, detached, stdin closed (`teams/mcp/taskmanager.mjs` `driverArgv`, spawn ~l.2762) | its child graph run writes `.teams_output/broker/ledger.jsonl` and a report; the manager folds the gate verdict and report into the EPIC on `tm_submit` |
| judge / manager nodes | `claude -p` from `teams/mcp/daemon.mjs` (~l.94, l.205) | payload returned, recorded by `tm_submit` |
| EPIC record | `~/.harness/tasks/<task_id>/` (`taskstate.mjs` `tasksRoot`) | `task.json`, `ledger.jsonl`, `drivers/<node>.stream.jsonl` |
| a question for the person | `ask` card, run parked `waiting_human` | `tm_inbox` lists it, `tm_submit({key, payload})` answers |
| a question for another package | none live; an **upstream fix** filed against the package it depends on (`upstream_fix_rounds`) | through the manager, after the asking package ends |
| shared knowledge | the project wiki (`wiki_write`) | read by later nodes |

So: no worker can ask another while both run; a rejected try learns why only in its next process;
the person's session sees a worker only by polling files (`view.mjs --once`). The Floor plan already
notes the drivers are `claude -p` children the person's `$.agent.list()` cannot show.

## 2. What is available

Source of the API: `harness/.claude-plugin/types/claude-code/index.d.ts` (same file in graph, trophy).

| Surface | What it does | Status |
|---|---|---|
| `$.session.send({ to, text })` | plain-text message to `{ sessionId }` (one of the person's sessions on this machine, running now), `{ agentId }` (a subagent or teammate of this session; a finished subagent is resumed with it), or a SendMessage name. Resolves `isDelivered` / `reason`; "delivered" means queued, not read | verified (types); used by `session/hooks/mod.tsx:403` (tell peers main moved) and `session/hooks/compact.tsx` (`/handoff`) |
| `session.send` hook | sees every outgoing message (model's SendMessage or a plugin's), may rewrite, readdress or refuse; carries the sending loop's `agentId` | verified (types) |
| `session.receive` hook | sees every incoming one with `origin.kind` (`peer`, `peer-send-message`, coordinator, channel…) and `origin.plugin`; may rewrite or consume it | verified (types) |
| `$.agent.list()` | this session's subagents and teammates: `id`, `status` (pending/running/waiting/idle/completed/failed/killed), `parentAgentId`, `name`, `description` | verified (types); used by `session/hooks/agents.tsx` |
| `$.agent.spawn`, `agent.spawn` hook, `turn.complete` with `agentId` | start a subagent from a mod and get its answer | verified (types) |
| `$.session.append` | add a user-role row the model reads | verified (types) |
| SendMessage and ListAgents tools inside a teams driver | the driver's stream `init` lists `Task`, `ListAgents`, `SendMessage`; its `session_id` is on every stream event | verified (one driver log, `~/.harness/tasks/69f230a3…/drivers/dispatch_P2_1.stream.jsonl`); none of 1 log used SendMessage |
| a headless `claude -p` driver is reachable by `{ sessionId }` while it runs | would let one driver, or the person's session, message a running driver | **assumed** — the types say "one of the person's own sessions… on this machine"; not tried against `-p` |
| a message reaching a `-p` driver mid-turn is read before its turn ends | needed for "QA tells a builder now" | **assumed** — "the receiver's turn is its own" |
| the teams mod loads in the driver child and its `session.receive` / `session.send` hooks fire there | drivers get `--plugin-dir <teams>`, and headless runs load the plugin (mod.md rule 2) | **assumed** for these two events |
| a driver knows the person's session id | nothing passes it today; would be an env var from `tm_open`'s caller | not built |

## 3. Options

Each option keeps the rule: the engine writes the record, the mod draws it, the flow works with
`modules` removed.

**A. Floor shows the messages that already happen (file-first).**
`view.mjs` reads SendMessage / `Task` tool calls and their results from `drivers/*.stream.jsonl`
into the `floor` block's hand-off feed (`P2 → sub  "check schema.ts for currency"`), one icon per
line. The mod only draws it. Works headless through `view.mjs --once`.
- Gains: zero new behaviour; the person sees who talks to whom; needs no assumed capability.
- Risk: low. Shows only in-driver talk (a driver and its subagents) until B or C exists.

**B. A question goes to the person through the band, live.**
When a run opens an `ask` card (engine, as today), the driver also sends one line to the person's
session (`TEAMS_PARENT_SESSION`, set by `tm_open`). In the person's session the teams mod's
`session.receive` hook consumes that message and turns it into the band's `⚑ P2 asks you: "…"
[answer]`; answering still calls `tm_submit`. Without the mod the message reads as plain text in the
conversation and the card is still in `tm_inbox`.
- Gains: the person learns of a wait in seconds, not at the next poll; no question lost in chat.
- Risk: depends on the two assumptions (reaching the session, the driver knowing its id). The
  message is a nudge only; the card stays the truth, so a lost message costs time, not a decision.

**C. A STORY asks the PLAN author, or another STORY, before guessing.**
A driver unsure of the plan sends its question to the manager (the person's session or the daemon),
which answers from the plan and wiki, or forwards it to a running sibling driver by `session_id`.
The question and answer are written to the EPIC `ledger.jsonl` (`asked` / `answered` events) by an
MCP tool, not by the mod.
- Gains: fewer wrong guesses and fewer upstream-fix rounds; the Floor feed shows
  `P3 → P1  "is amount in cents?"` / `P1 → P3  "yes, cents"`.
- Risk: the PLAN author is a finished process — "asking the author" really means asking a fresh
  agent with the plan, which is what an ask to the manager already is. Answers that change work
  must land in the ledger or the run stops being replayable. Medium build cost.

**D. QA or the gate tells a running builder now.**
On a reject, or when an upstream contract changes, the engine sends the reason to the builder's
running `session_id` instead of waiting for its next try.
- Gains: saves a whole try (minutes and dollars) when the fix is small.
- Risk: highest. Needs both mid-turn assumptions; a message that changes a run in flight is a
  second, unrecorded instruction channel unless the engine also writes it. A gate verdict must
  still be decided and recorded by the engine; the message can only hasten what the ledger says.

What none of these do: no gate, deny or verdict lives in a `session.receive` / `session.send` hook;
every guard on these events fails open (`.catch(($, e, next) => next(e))`); timers, band and toasts
start only when `$.session.surfaces()` is non-empty.

## 4. Recommendation

1. **A now**, folded into the Floor card: it is file-first, needs no assumption, and gives the
   "see them hand work to each other" the Floor plan asked for.
2. **A one-hour spike** that settles the three assumptions: two `claude -p` sessions, one sends to
   the other by `session_id` mid-turn; does it deliver, is it read before that turn ends, does the
   teams mod's `session.receive` fire in the receiver.
3. **B next** if the spike delivers to the person's interactive session (the likeliest to work, since
   `session/hooks/mod.tsx` already sends between interactive sessions).
4. **C and D only after** B has run in a real EPIC, and only with the engine writing every message
   that changes work into `ledger.jsonl`.

## 5. Open questions for the user

1. Is A (show the talk that already happens) enough to start, or is the point that workers should
   talk more — i.e. go straight to C?
2. For C: may a running STORY driver message another running STORY, or must every question go
   through the manager so one place decides?
3. For D: is a mid-turn nudge to a builder acceptable, or should a reject always wait for a new try
   (cleaner record, slower)?
4. Should headless runs (no person watching) send anything at all, or should B–D switch off
   when nobody is attached?
5. Mod rule 2 lists timers, panes, bands, toasts as interactive-only; does a driver-side
   `session.send` count as surface (interactive-only) or as engine work (allowed headless)?

## 6. Decisions (user, 2026-10-17)

"그니까 Agent 같 메시징 통로를 적극적으로 사용할 수 있게 하는게 좋을거 같고 B(현재 teams 쓸 수 있으니까)
2. TeamLeader 통하면 더 좋고 3,4은 당신추천"

1. The point is that workers use the message channel actively, not only that the Floor shows it:
   B is built now (teams is usable today), C follows, A comes with the Floor card as the view of it.
2. C goes through the TeamLeader: a STORY driver asks the manager, never a sibling directly; the
   manager answers from the plan and wiki or forwards, and the engine writes `asked` / `answered`.
3. D is out: a reject waits for the next try (one recorded instruction channel).
4. Messages to the person (B) are off when no surface is attached; the ask card and `tm_inbox`
   still carry the question. A driver↔TeamLeader exchange (C) is engine work recorded in the
   ledger, so it runs headless too (answers question 5).

Order: spike (the three assumptions in §4.2) → B → C → A in the Floor card. A failed spike stops B
and C and comes back to the user with what was seen.
