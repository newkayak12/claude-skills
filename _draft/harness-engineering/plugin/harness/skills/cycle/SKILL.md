---
name: cycle
description: >-
  Use when starting a new product/dev cycle and you need the pre-cycle entry
  gate before committing time. Triggers on: "새 사이클 시작", "이거 만들어도 될까",
  "사이클 시작해줘", "pre-cycle 게이트", "start a cycle", "should I build this",
  "cycle 돌리자", "하네스 사이클". Runs problem-first gate, declares cycle type,
  scaffolds artifacts, enforces WIP=1.
scenarios:
  - "이 아이디어로 새 사이클 시작해도 될까?"
  - "사이클 하나 돌려보자"
  - "Should I commit to building this? Run the gate"
  - "새 프로젝트 시작 전에 점검해줘"
  - "harness 사이클 시작"
compatibility:
  optional:
    - think-tool          # surfaces hidden motives / second-order effects in self-check
    - sequential-thinking # for stepping through the 5 gate groups
  remote_mcp_note: >-
    think-tool이 있으면 E 자기 점검(진짜 동기·6개월 후 후회)을 더 체계적으로 캘 수 있습니다.
    Claude 설정 → MCP Servers에서 remote SSE 엔드포인트를 추가하세요.
related:
  - hypothesis-driven-dev
  - decision-maker
  - bias-auditor
---

# Harness Cycle — Pre-cycle Entry Gate

Check by conversation whether you're *qualified to start* a new cycle, and scaffold artifacts only if it passes. **A cycle started wrong cannot be finished well.**

This skill makes the `09-pre-cycle.md` gate *executable*. Instead of reading the five markdown files directly, this skill asks one group at a time and renders a verdict.

## The Gate

**The gate must pass before scaffolding artifacts.** Even for "simple" ideas. The gate's cost is low; the cost of a cycle started wrong (sunk cost + pressure to finish) is high.

## Step 0: Confirm WIP=1 (first)

If `cycles/active` already exists, **STOP**. You must *explicitly close* the current cycle before starting a new one (SD-03, AP-12).

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/cycle-init.py --check-wip
```

If an active cycle exists, show it and ask the user "close the current cycle now / hold this start?" Forcing through may be an escape-cycle anti-pattern, so confirm once more.

## Step 1: Declare the cycle type

Decide the type first — the gate adapts to it (`09 §9.1b`).

| Type | Definition | Gate adaptation |
|---|---|---|
| **Product** | Product/feature for external users | Full gate as-is. 5 interviews · Gate 1 product hypothesis applies |
| **Dev-tool / Self** | Tool/automation you use yourself | "5 interviews" → self-dogfooding. Gate 1 → "tool usefulness" |
| **Exploration / Spike** | Learning/validation is the goal | "problem statement" → learning question. Short time Kill |

Ask in one question. Default is Product (the strictest).

## Step 2: The 5 gate groups — by conversation (one group at a time OR all at once)

Two entry modes depending on the user's state:

- **User without a plan in mind** → ask each group *one at a time*. Get an answer, then move on. Don't dump everything at once.
- **User who already has a plan (context-dump shortcut)** → when the user dumps context all at once, the AI **auto-maps** it onto items A~E and asks only for the *missing items*. Don't re-ask what's already filled — interrogating an experienced user group-by-group is friction (real-use feedback).
  - Show the mapping result briefly ("A problem statement ✓ / C Kill criteria ✗ missing") and ask only for what's missing.
  - "Meta input" welcome: if the user gives all 5 groups in one paragraph, accept it and decompose.

### A. Idea — problem first, solution later
- Is there a problem statement? *(form: "users cannot do X" — not "I want to build Y")*
- Whose problem is it? At least 1 concrete Persona
- Frequency × intensity?
- Current alternatives?
- Are you over-attached to the solution? (bias self-check)

> **If it starts with "I want to build Y", stop** — solution-shopping. Return to the problem statement.

### B. Strategic fit
- Does it align with prior cycle learnings?
- Does it leverage current strengths? (or is it a deliberately new area)
- Does it conflict with a product in operation? (WIP=1)

### C. Cost · time — *STOP risk point*
- Is a time budget set?
- Is a money budget set?
- Can it be finished with current capacity?
- Are Kill criteria predefined?
  - **Exploration type allows defer**: domain Kill is often concretized mid-cycle. If the user says "I'll work out the Kill during the cycle", don't force a commitment (formalism). Keep only the session-based Hard/Soft Kill (template defaults) and mark the domain Kill as `TBD` with a TODO on the cycle-card. **But it must be finalized before the close gate.**
  - Product/Dev-tool cannot defer — finalize now.

### D. Verifiability (adapts per type)
- Is there a chance of passing Gate 1?
- Is the validation target accessible? (Product: 5 interviews / Dev-tool: self / Exploration: learning possible)
- Is the hypothesis in a falsifiable form?

### E. Self-check
- What is the real motive for this cycle? (curiosity? escape? external pressure? market opportunity?)
- What's the 6-months-later regret scenario?
- What gets worse if you *don't* run this cycle? (if weak, the qualification is weak)

If `think-tool` is available, call it at E — to dig out hidden motives.

## Step 3: Decision matrix

| Condition | Decision |
|---|---|
| A + D all yes | Can proceed |
| 1 or more no in C | **STOP** — budget shortfall (if time/Kill undecided, decide now and re-judge) |
| *Only Kill* is no in C + type=Exploration | Can proceed — defer the domain Kill as `TBD`, TODO on cycle-card. Finalize before close (time budget still required) |
| B all no | Re-examine — *why* do this now |
| E real motive is escape/external pressure | **STOP** — seek a different solution |

Don't let a decision pass *without a record*:
- **Go** → Step 4 scaffold
- **No-go** → 1-line reason + which queue (re-examine/discard/hand off)
- **Defer** → state the hold condition (which signal triggers a restart)

## Step 4: If Go — scaffold

Run only when the gate passes:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/cycle-init.py "<cycle name>" --type <product|dev-tool|exploration>
```

Generates: cycle-card · pre-mortem · gate-criteria · retro · findings · hypotheses.jsonl · blackbox.jsonl · metrics.json under `cycles/<id>/`. Links the `cycles/active` symlink.

Then *fill it in by conversation* (the blanks, together with the user):
1. cycle-card — hypotheses (with falsification conditions) · Persona · Kill criteria
2. pre-mortem — 5 failures + mitigations for the top 2
3. Register each hypothesis tamper-evident (fix kill/pass lines *at registration time*):
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/hypothesis-register.py register \
     --cycle <id> --id H1 \
     --hypothesis "..." \
     --kill-line "reject if this condition" \
     --pass-line "pass if this condition"
   ```
4. *Lock* each quality bar (lowering it is detected as a hash mismatch at verify):
   ```bash
   python3 ${CLAUDE_PLUGIN_ROOT}/scripts/bar-register.py register \
     --cycle <id> --id B1 --stage test \
     --criterion "pass criterion" --measure "how it is measured"
   ```

## Step 5: The AI structures the roadmap — don't dump it on the user

If the user lists steps raw, *copying them straight into a table is an AI failure* (real-use feedback). The AI's job is to structure:

- raw input → optimize order via **dependency analysis**
- identify **parallelizable steps**
- **propose missing steps** (e.g. event storming, prototyping, load testing)
- **move high-risk steps forward** (fail-fast)
- set **milestones · checkpoints**
- **page against the time budget** (e.g. for 3 months, allocate by month)

The order is: the user gives *direction · context* → **the AI presents a structured roadmap draft** → the user adjusts. Not the reverse.
Leave the roadmap as a *file* under `docs/**`, based on the cycle-card Phase table (don't end with just a chat table — P8).

## Step 6: In-cycle Phase progression — track · transition · verify artifacts

Don't just start a cycle and then progress the actual work manually *outside* the harness. Track the Phase (cycle-card Phase table + metrics.json `current_phase` = SSOT).

**Phase: Analysis → Design → Planning → Implementation → Validation**

What the AI must observe at each phase:
1. **Confirm the current phase before acting** — read `current_phase`, work only on that phase. No skipping/mixing phases (P9).
2. **Artifacts as files** — leave them as *files* at the designated storage location (cycle-card Phase table). A chat table = not an artifact (P8).
3. **Verify phase completion** — move to the next phase only after confirming "the artifact exists as a file at the designated location". Pass `--evidence <path>` to `phase-advance.py`. A collaborative phase requires `--confirm-user` after user confirmation, plus **`--confirmation-note "<what the user agreed to>"`** (H2 — audit record in the tamper-evident chain). The advance is pinned into the `phase.jsonl` hash-chain, and phase-guard reads *this chain*, not metrics, as the authoritative source (H1). Update the cycle-card status to `✅ done`.
4. **Auto-propose the next phase** — on completion, *the AI proposes* the transition with "Next is the Design phase. Shall we move on?". A structure where progress happens only if the user says "just keep going" is an AI failure.

### Collaborative artifact gate (R-PG01 enforced)

**Collaborative artifacts** like Design Doc · ADR · roadmap are **a blind spot of "injection ≠ enforcement"**. Even with the rule in context, the AI prioritizes speed and writes them alone. So apply an *explicit STOP*:

- **Collaborative artifacts enforce `draft → review → finalize`.** The AI does not write a finished version alone.
- **"Just keep going" ≠ "write everything without confirmation".** Don't break the flow, but *stop at points that require a decision.*
- **Enforce order dependency**: do not write the ADR *before* the Design Doc is agreed with the user through iteration. The ADR builds on the agreed Design Doc.
- A collaborative phase does not advance `current_phase` until it passes the user confirmation gate.

> Artifact types: **solo** (Analysis · Implementation — AI proceeds then reports) vs **collaborative** (Design · Planning — draft→review→finalize required). See the "type" column of the cycle-card Phase table.

### Design-phase doc-flow: RFC → Design Doc → ADR (drive it, don't make the user)

When the design phase produces decision docs, **the AI runs this flow** — the user shouldn't have to micromanage RFC structure (real-use failure: the AI dumped a too-wide RFC, stamped decisions, and parked the rest in a grab-bag until the user hand-corrected all of it).

- **One RFC = one narrow topic.** An RFC is a **coherent prose argument**, not a checklist. What needs deciding *emerges from discussing the topic*; you don't pre-harvest open questions into `Q1…Qn` and stamp a verdict per line. If a topic keeps widening, **split it into more topic-RFCs** — never grow one RFC's item count. (AP-32)
- **Decisions are the product of discussion, not stamps.** Discuss the topic in prose → the decision falls out of the reasoning → *then* it's recorded. Don't insert decisions the discussion didn't earn ("박는다"). Design *verifies* what the RFC reasoned to.
- **No deferred grab-bag.** Unresolved items are **re-framed as a decision queue/index** (a pointer), then each cluster spun into its own narrow topic-RFC. They never get parked in a `deferred`/`misc` dump. (AP-33)
- **Cadence, one RFC at a time**: discuss the topic (prose) → modify the files that RFC touches → derive Design Doc / ADR for what the discussion settled → next RFC. Don't open the next RFC until the current one's loop closes.
- **Document weight ≠ decision weight** (AP-07): a one-line decision ends in a one-line ADR, not a 10-page doc. Don't emit Design Doc + ADR with identical content.

The AI states this flow when the design phase starts (so the gate rule surfaces *at entry*, not only when a write is blocked).

Example of a legitimate phase advance:

```bash
# The Analysis artifact file must exist to advance to Design
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/phase-advance.py design \
  --evidence docs/v2/analysis.md

# Advance to Planning only after the Design Doc has gone through user review/finalize
# Leaving a collaborative phase → --confirm-user + --confirmation-note required (H2)
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/phase-advance.py planning \
  --evidence docs/v2/design-doc.md \
  --confirm-user --confirmation-note "user approved design-doc v2 API contract & data model"
```

## Closing (close gate)

When closing after building. **No self-scoring** — an independent reviewer (fresh subagent, doer≠reviewer) must score each bar before close opens.
```bash
# 1) Score each bar independently (close is blocked without review)
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/review-register.py register \
  --cycle <id> --id R1 --criterion-id B1 \
  --verdict pass --evidence "evidence observed against the bar's measure" --reviewer "subagent:..."
# 2) Close — operates on active, so no --cycle argument
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/close-cycle.py
```
> **Bypassing the gate**: if you must close while ignoring review/ratchet, `close-cycle.py --force --adr <existing document>` — bound to an ADR + a `force-close` record in blackbox (bypassing leaves a trace). If you legitimately need to *raise the ratchet axis* (a +1 that can't be subtracted, e.g. mechanism-count), use `bar-register --baseline-reset` rather than force — a first-class baseline declaration that is reviewed (accept-new-baseline).
> `cycles/` is created in the *project CWD*. Either commit the artifacts alongside the working repo, or add `cycles/` to `.gitignore` if you don't want that.

## What Claude Does
- Runs the gate by conversation — for a user without a plan, one group at a time; for a user with a plan, auto-maps the context-dump onto A~E and asks only for *what's missing*
- Catches "I want to build Y"-style entries and returns them to the problem statement
- Allows deferring the domain Kill criteria for Exploration type (TBD TODO), requires finalizing before close
- Judges the decision via the matrix and *records* it
- Runs scaffold only on Go, then fills artifacts together with the user
- **Has the AI structure the roadmap** (dependencies · parallelization · fail-fast · milestones) — doesn't copy a raw list verbatim
- **Tracks the Phase** (confirm current_phase → verify artifact file → auto-propose next phase)
- **Enforces draft→review→finalize for collaborative artifacts (Design Doc · ADR · roadmap)** — doesn't finish them alone
- **Drives the design-phase doc-flow** (RFC→Design Doc→ADR): one narrow topic per RFC written as prose, decisions emerge from discussion (no question-harvesting / decision-stamping — AP-32), no deferred grab-bag (re-frame as a decision queue, split into topic-RFCs — AP-33). States the flow at design entry

## What You Do
- Answer each group's questions honestly (especially E, the real motive)
- If you have a plan, you may dump it all at once (the AI decomposes it)
- Finalize the time budget *now* (for Exploration, the domain Kill can come mid-cycle)
- Give direction · context, receive the AI roadmap draft and adjust it
- Iterate on collaborative artifacts by reviewing the AI draft

## Related Skills
- `pm:hypothesis-driven-dev` — pre-register hypotheses
- `think:decision-maker` — Go/No-go/Defer
- `cognition:bias-auditor` — E self-check
