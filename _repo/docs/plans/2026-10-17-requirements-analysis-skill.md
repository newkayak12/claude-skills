# Requirements analysis and split — design draft

Status: draft for the user's choice. No code. Backlog card 47.

User, 2026-10-17: "요건을 분석하고 분할하는 스킬도 하나 backlog에" (after "요건을 decompose 하는 스킬 우리 있나?").

## 1. What exists and the gap

Wanted: input a raw requirement or 기획서; output analysed requirements (actors, rules, open
questions) split into independently deliverable items, each with acceptance.

| Skill | What it does today | Mounted by teams? | Gap against the job |
|---|---|---|---|
| `write:plans` | implementation plan / tickets (vertical-slice tasks, pass bar per step); PRD and other docs via `references/` | yes — `graph.mjs` `draft` / `template-fill` of the document and planning flows; `check-skeleton` lists it frozen | starts after the requirement is understood; tasks are code steps (files, tests), not requirement items; no actors/rules/open-question pass |
| `develop:spec-driven-development` (94 lines) | Specify (US-n, AC-n in Given/When/Then, `[확인 필요]`, unstated-criteria sweep) → gate → design → tasks → code → AC evidence | no | Step 1 is most of the analysis, but it is bound to the code flow that follows; no actor or rule list; stories are not grouped into independently deliverable items; no "stop after the spec" exit |
| `write:spec` (95 lines) | synthesises a settled conversation into a spec; open points marked | no | input is a conversation, not a 기획서; says "Not for: breaking a spec into tickets" |
| `agents:agent-task-decomposer` | splits a task into agent subtasks with file ownership | yes — `GRAPH_STAGE_SKILLS.plan`, `broker.mjs` | frozen; splits work for agents, not requirements for delivery |
| `teams:plan` | PRD through the graph (investigate → draft → revise → gate) | is teams | frozen; writes a PRD, needs the teams MCP |

The gap: nothing un-frozen takes a 기획서 and stops at "here is what it asks for, who, under which
rules, what is unknown, and in which independently shippable pieces". `spec-driven-development`
Step 1 does 70% of it, then carries on into design and code.

## 2. Options

**A. Extend `write:plans`** — a seventh purpose row "requirements analysis".
- + Already the "break into tickets" entry; one routing table.
- − Teams-mounted and frozen (`skill.md`: teams-mounted skills stay frozen until teams decides).
  A new purpose row also changes what the teams `draft` node may pick. Blocked unless teams decides.

**B. Extend `develop:spec-driven-development`** — Step 1 grows an analysis-and-split pass and an
exit after the spec gate.
- + Reuses what exists: `[확인 필요]`, the unstated-criteria sweep, US/AC traceability, the gate
  (`repo.md`: no new skill when one can be extended). Not mounted, free to edit.
- + Items carry AC-n, so a later full run (design → code) and `write:plans` consume them unchanged.
- − Description trigger changes → behaviour change, needs a routing probe besides the real run.
- − Grows ~94 → ~115 lines; lives in `develop`, so a non-code 기획서 user may not look there.
- − Two entries (analyse only / spec→code) in one skill; must stay one Process, not two.

**C. New skill (e.g. `write:requirements`)**
- + Clean trigger ("요건 분석", "기획서 쪼개줘"); not tied to code; short.
- − Duplicates SDD Step 1 (US/AC, `[확인 필요]`, sweep) and `write:spec`'s open-point rules; two
  places to keep the same rules in sync. Against "no new skill when an existing one can be
  extended" unless B is shown not to fit.

## 3. Recommendation

**B.** Concretely (for the Sprint's plan stage to refine, not code here):
1. Step 1 "Specify" becomes "Analyse and split": from the 기획서 list actors, business rules
   (R-n, each with its source line), US-n, AC-n, `[확인 필요]`; then group stories into items I-n —
   each a vertical slice a user can see working alone, with its AC-n, `Blocked by`, and
   out-of-scope. The existing sweep stays.
2. Gate unchanged. New exit: if the request asked only for analysis/splitting, stop after the
   gate with the spec and the item table; otherwise continue to Step 2 as today.
3. Description adds the trigger ("요건 분석", "기획서 분할", "split these requirements") inside the
   250-char limit; Output Template gains the item table; Related Skills names `write:plans` as the
   next step for a plan per item.
`write:plans`, `agent-task-decomposer` and teams stay untouched.

## 4. Real-run plan

- Sample: a fictional, generic 기획서, ~1 page — "동네 공유 회의실 예약" (members book a room by the
  hour, cancel up to 2 h before, admins block rooms, no-show twice → 1 week ban, payment "추후 결정").
  Built to contain: 2+ actors, 3+ rules, one deliberately missing fact, one implied but unstated
  criterion (e.g. overlapping bookings), one item that depends on another.
- Run: `claude -p --plugin-dir ./develop` in a `$TMPDIR` workspace (`< /dev/null`), prompt
  "이 기획서 요건 분석하고 분할해줘" with the file. Plus a routing probe: the same prompt must load
  `develop:spec-driven-development`, and "spec first, then implement" must still run the full flow.
- Done when the output: lists every actor and rule with a source; marks payment as `[확인 필요]`
  (not guessed); has an AC for the overlap case; splits into items each with AC and `Blocked by`;
  stops at the gate (no design.md, no code). Each criterion reported met / partly / unmet.
- Checks: `validate_plugins.py`, `check-copies.mjs`, `check-skeleton.mjs`, counts reported.
  Output lives in `tmp/`, deleted after the Sprint report.

## 5. Open questions (recommended answer in brackets)

1. B (extend `spec-driven-development`) or C (new skill)? [B — rules favour extending; revisit
   only if the routing probe shows 기획서 requests miss it.]
2. Analysis-only by trigger, or always stop after the spec and ask before design? [By trigger:
   "spec first" keeps today's flow; "요건 분석/분할" stops at the gate.]
3. Item granularity: vertical slice (as `write:plans` step 3) or one item per story? [Vertical
   slice — an item must be demoable alone; a story may span two items or share one.]
4. Emit a teams `tm_open({requests})` array from the items? [Not now — nobody asked; the item
   table is enough to paste into a Sprint.]
