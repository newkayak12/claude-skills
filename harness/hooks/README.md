# Harness Plugin — Hooks

> Implements the **Sensor** (observe and block after action) component of the Böckeler framework as Claude Code hooks.
> While `scripts/` must be *called explicitly* to work, hooks fire *automatically without being called*.

## Current implementation (Computational Sensor)

### `hypothesis-immutability.py` — PreToolUse

| | |
|---|---|
| **Event** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) |
| **Role** | **Blocks** (exit 2) direct edit attempts on `hypotheses.jsonl`, `bar.jsonl`, `review.jsonl`, `phase.jsonl` |
| **What it blocks** | Direct edits to the above append-only chains (AP-06 gate fudging + #006 bar lowering + #007 review forgery + **H1 phase transition forgery**) |
| **Legitimate path** | `scripts/hypothesis-register.py` / `bar-register.py` / `review-register.py` / `phase-advance.py` (append + hash chain) are not blocked |
| **fail-open** | If input JSON parsing fails → *pass through* — the hook must not block legitimate work |

This is the first actual wiring of `13-operational-layer.md §3·§4`'s *"enforce with code (Computational)"*.
It defends against `CV-1` (author=enforcer=target) *physically*, not just through *narrative*.

### `stage-inject.py` — PreToolUse

| | |
|---|---|
| **Event** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) — start of code writing = entering `code-writing` stage |
| **Role** | At the moment of stage entry, **injects the rules for that stage** (`rules-merge effective --stage code-writing` = R-CD coding rules etc.) into context |
| **Injection method** | stdout JSON `hookSpecificOutput.additionalContext` (+ `permissionDecision: allow`). Plain stdout in PreToolUse is not visible to the model, so JSON is the *only* injection path (confirmed in official docs). additionalContext is injected *alongside the tool result* (= at the moment of the tool call) |
| **What it fills** | CA-10 (review/2026-06-03): rule-inject(SessionStart) fires only once *at the boundary* → rules scroll out or get compacted during long flows. This hook extends the defense *into the flow interior* — coding rules re-reach the model *when coding actually starts* |
| **Feature preservation** | The basis on which rule-inject can become slim (`--dynamic` = invariant+L1). The missing static defaults (R-CD etc.) are re-injected per stage by this hook → all coding rules still reach the model |
| **de-dup** | Once per session per stage. Marker at `$HARNESS_HOME/stage-inject/<sid>/code-writing.injected`. If marker exists → plain allow (no injection) — prevents spam on every Edit |
| **Not a blocker** | `permissionDecision=allow` — does not block the tool. *Injection ≠ enforcement* (Principle 1, same boundary as rule-inject) |
| **fail-open** | Missing merge engine / effective=0 / JSON parse failure / marker IO failure → plain allow with no injection, tool not blocked |

→ rule-inject(SessionStart, always-on invariant+L1) + stage-inject(stage entry, per-stage static defaults) are *paired*: auto-injection is split into two time points to reduce session-start tokens AND extend defense from boundary into flow interior (#012 follow-up, PF-10).

### `phase-echo.py` — UserPromptSubmit

| | |
|---|---|
| **Event** | `UserPromptSubmit` (no matcher) — fires before each user turn |
| **Role** | When an active cycle exists, re-injects the current phase (`metrics.json current_phase`), its gate type (solo/collaborative), what's required to leave it (evidence file / collaborative `--confirm-user`+note), the next phase, and the "**propose the next phase yourself**" nudge |
| **Injection method** | Plain stdout (exit 0) — UserPromptSubmit/SessionStart plain stdout *is* injected as context (unlike PreToolUse, which needs JSON) |
| **What it fills** | real-use #4·#7 (feedback 2026-06-23): phase-tracking/transition machinery existed (`phase-advance.py`, `phase_gates`) but the AI lost phase-awareness mid-flow and advanced only when the user said "just keep going". The SKILL body scrolls out of context on long flows; this re-reaches phase-awareness *in-flow* |
| **de-dup** | **Fires only when the phase changed** since last injection. Marker at `$HARNESS_HOME/phase-echo/<sid>/last-phase` stores the *phase value* (not mere existence) — same value → no-op. One echo per transition, not per turn |
| **Not a blocker** | Plain reminder. *Injection ≠ enforcement* — the real evidence/confirm gate is `phase-advance.py` |
| **fail-open** | No active cycle / no metrics / same phase / JSON parse failure / marker IO failure → no output, exit 0 |

→ Pairs with `phase-advance.py`(the enforcing gate) the way stage-inject pairs with the coding gates: the gate enforces, the echo keeps the *human-loop behavior* (track phase, propose next) from silently degrading mid-flow.

### `phase-guard.py` — PreToolUse

| | |
|---|---|
| **Event** | `PreToolUse` (matcher: `Edit\|Write\|MultiEdit\|NotebookEdit`) |
| **Role** | **Blocks** (exit 2) attempts to edit/create *code files* (.py/.kt/.js/… source extensions) when: no active cycle exists (based on verified `phase.jsonl` chain), `current_phase` ∉ {implementation,validation}, or pre-code gate evidence/confirm requirements are unmet. Blocks all code and tech-doc edits when the chain is corrupted or forged. |
| **What it blocks** | Code work outside the harness + violation of R-PG01 "No code before design" — writing code first without advancing cycle/phase. rule-inject *injects* R-PG01, but the model still breaks it (real-usage feedback) → made a *physical gate* via a blocking hook (injection≠enforcement, Principle 2) |
| **Passes through** | Non-code files (.md analysis notes, design docs, ADRs, .json/.yaml configs) / implementation or validation phase → exit 0. Does not block writing analysis and design documents |
| **Friction logging** | On block, records the event in `.claude/.feedback/feedback.jsonl` via `feedbacklib` (raw material for beta reports). Recording failure does not affect the block exit2 (fail-soft) |
| **Legitimate path** | Phase advance via `scripts/phase-advance.py` (adjacent order + evidence + collaborative `--confirm-user`+`--confirmation-note`(H2) required, --force=blackbox). Advances are recorded in the `phase.jsonl` hash-chain and the hook re-validates *this chain* as authoritative source |
| **Trust anchor (H1)** | phase-guard derives phase and gates from tamper-evident `phase.jsonl` chain, not from metrics.json → **directly editing `metrics.json` `current_phase`/`phase_gates` cannot bypass the gate** (resolves previous #013b H3 limitation). Chain direct edits are defended by immutability(Edit)+verify_chain(Bash)+absence→block(deletion) |
| **Honest limitations** | Same as bars and hypotheses: cannot block a determined attack that constructs a valid hash chain wholesale via Bash (outside the solo-dev threat model). Bash file creation only catches common patterns (`>`, `tee`, `touch`, `cp`, `mv`, `sed -i`) |
| **fail-open / block** | Non-code target / stdin JSON parse failure → exit 0 (tool not blocked). No active cycle / chain corrupted / pre-code gate unmet + code/tech-doc → block (exit 2) |

→ The third blocking Sensor that physically locks *stage order*, following `hypothesis-immutability`(data) and `active-symlink-guard`(closure). `phase-advance.py`(artifact evidence + user confirmation gate) + `phase-guard`(code block before implementation) are *paired* (#013b).

### `active-symlink-guard.py` — PreToolUse

| | |
|---|---|
| **Event** | `PreToolUse` (matcher: `Bash`) |
| **Role** | **Blocks** (exit 2) attempts to directly remove the `cycles/active` symlink via Bash (`rm`/`unlink`) |
| **What it blocks** | Bypassing quality gates by manually running `rm cycles/active` to close a cycle (#007 Full Computational) |
| **Legitimate path** | `scripts/close-cycle.py` — when the gate (all bars locked to hash-chained pass reviews) is passed, it removes the symlink *in-process* and is not subject to this hook |
| **Symmetry** | Just as `hypothesis-immutability` protects *data* (bars, reviews), this hook forces *the closure act* (symlink removal) through the legitimate script only |
| **Honest limitations** | Only catches `rm`/`unlink` on `cycles/active` *itself* (not sub-paths). `mv`, Python `os.unlink`, `find -delete`, trailing slash are not caught |
| **fail-open** | Non-Bash tool / JSON parse failure → pass through |

→ `close-cycle.py`(gate-embedded closure) + `active-symlink-guard`(manual bypass block) are *paired*: the sole legitimate path for closure is nailed in code (#007 ②).

### `active-cycle-verify.py` — SessionStart

| | |
|---|---|
| **Event** | `SessionStart` |
| **Role** | Verifies the hypothesis, bar, and review chains of the active cycle → on tamper detection, **warns** (stdout = context injection) (#007 F5: bar/review extension) |
| **What it fills** | PreToolUse blind spot — edits made *outside the session* (directly in an editor) are not tool calls and cannot be blocked. Augmented with *detection* at the start of the next session (cycle-002 F2) |
| **Not a blocker** | SessionStart has no block concept. intact → brief confirmation, tampered → warning. Both are exit 0 (session is not blocked) |
| **fail-open** | No active cycle / script not found → silent pass-through |

→ Two Sensors are *paired*: PreToolUse (in-session blocking) + SessionStart (out-of-session detection). Neither alone is complete (cycle-002 retro lesson).

### `session-counter.py` — SessionStart

| | |
|---|---|
| **Event** | `SessionStart` (only `startup` source is counted — resume/compact/clear are continuous sessions, not incremented) |
| **Role** | Increments `metrics.json:session_count` by +1 for each new session (measures *work sessions* elapsed in the cycle) |
| **Why** | For a solo developer, the unit is *work sessions*, not *wall-clock time*. Wall-clock produces false readings when a cycle sits idle ("200% time used"), but session count does not (cycle-004) |
| **Not a blocker** | Only updates metrics. exit 0. metrics.json is not protected by hypothesis-immutability (protection covers the 4 `hypotheses/bar/review/phase.jsonl` chains) → free to update. Phase authority SSOT is the protected `phase.jsonl` (H1), so free metrics updates cannot destabilize gates |
| **fail-open** | No active cycle / source not counted / broken metrics → silent pass-through |

→ Originally the trigger for making `kill-check.py`'s time metrics *observable* (cycle-004), but **#015 retired the kill-check family** (0 fires), so `session_count` no longer has an automatic consumer — it now remains only as a *measurement* for retros and diagnostics. budget$ was *unobservable* and was dropped from the start. "Only enforce what can be measured" (converse: a metric that is only measured but never enforced is a cost — whether to retire session_count itself is pending follow-up review, cross-referenced with metrics SPOF rank4).

### `rule-inject.py` — SessionStart

| | |
|---|---|
| **Event** | `SessionStart` |
| **Role** | Runs `rules-merge effective --dynamic` (invariant L0 + L1 user-rules) and **auto-injects into context** — always-on rules reach the model every session without a human manually running `rules-merge` |
| **Injection scope** | invariant (R-PG, R-DoD, R-DD, R-AI, etc.) + L1 overrides. Static defaults (R-CD coding rules) excluded (covered by stage-inject) |
| **Compression** | 1 line per rule lossless format (766 tokens → 384 as a reference; removes `_layer:` overhead) |
| **Injection ≠ enforcement** | Soft guidance (Principle 1 "guide"). Real enforcement is via gates and blocking PreToolUse hooks (Principle 2) |
| **fail-open** | HARNESS_HOME absent / rules-merge failed / effective=0 → exit 0, no spam |

→ Paired with `stage-inject` (PreToolUse, stage-specific rules): auto-injection is split into two time points to reduce session-start tokens AND extend defense from boundary into flow interior (#012).

> **Retired (#015, 2026-06-06)**: `deploy-kill-check.py` (UserPromptSubmit deployment block) and its engine
> `kill-check.py` were retired together. Reason: **0 fires and weakest effect** in real usage (roadmap rank6), plus the deploy-kill-check→kill-check→metrics **3-level dependency** only grew mechanism-count debt (ADR-0001 standing debt). Retirement improved count from 28→26 and ratchet floor from 27→26 monotonically. C-06 Sunk-cost defense now lives in *narrative* (retro's kill reason description) — per the *"only enforce what can be measured"* principle, a Sensor with 0 fires was a cost, not enforcement.

→ Currently **2-event Sensors**: PreToolUse (hypothesis/WIP/phase/stage blocking) · SessionStart (detection + session measurement + rule injection). Event type determines block authority (PreToolUse=can block, SessionStart=warning only).

## Wiring

The plugin declares the above hooks via [`hooks.json`](./hooks.json). Claude Code merges them on plugin install. For manual setup, add the same block to `settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [ { "type": "command",
                     "command": "python3 ${CLAUDE_PLUGIN_ROOT}/hooks/hypothesis-immutability.py" } ] }
    ]
  }
}
```

## Self-test

```bash
# Expect block (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/hypotheses.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# bar.jsonl — expect block (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/bar.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# review.jsonl — expect block (exit 2)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/review.jsonl"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# Expect pass (exit 0)
echo '{"tool_name":"Edit","tool_input":{"file_path":"x/cycle-card.md"}}' \
  | python3 hooks/hypothesis-immutability.py; echo $?
# active-symlink-guard: expect block on rm cycles/active (exit 2)
echo '{"tool_name":"Bash","tool_input":{"command":"rm cycles/active"}}' \
  | python3 hooks/active-symlink-guard.py; echo $?
# phase-echo + gate-map self-tests (run from repo root)
bash hooks/test-phase-echo.sh
bash scripts/test-gate-map.sh
```

## Backlog (next Sensor candidates)

> `deploy kill-check` went through the full lifecycle: candidate (spec) → #005 implemented → **#015 retired**. Retired due to 0 fires, weakest effect, and 3-level dependency debt (see retirement note above). Lesson: *implementing* a Sensor does not guarantee effect — if it is not validated by real fires, only mechanism-count debt remains (CA-11/PF-11 "adding without removing" anti-pattern vindicated).

- Concept catalog (spec): `../../../hooks/README.md` (16 hook designs, most unimplemented).
- `rule-inject`(SessionStart, always-on rules) · `stage-inject`(PreToolUse, per-stage rules) — auto-injection at 2 time points.
  New additions not in the catalog (#012 rule-auto-injection + stage-injection follow-up). Covered in the "Current implementation" section above (rule-inject has its own Sensor section; stage-inject is in the PreToolUse block above).
