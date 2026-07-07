# 13. Operational Layer

The preceding documents defined *what the rules are*. This document defines **how an installed harness actually operates in an AI session** — what it loads when, what it enforces in code, how violations are recorded, and how many tokens it consumes per turn.

This document closes `CA-1` (missing operating mechanism) from `devils-advocate.md` and satisfies [`GOAL.md`](./GOAL.md) §3.3 (AI operating mechanism must be specified). It is also *the work definition for the next step — token optimization* — this document establishes what needs to be optimized.

## §0. Core Principle: Don't Carry Rules Around

The moment harness rules are *loaded into context every turn*, two things break simultaneously:

1. **Tokens** — carrying 30–50 KB of rules throughout a cycle causes cost to explode per cycle
2. **Trust** — if rules exist only as *narrative*, the AI cannot interpret them consistently (`CA-1`), and there is no way to prevent user overrides (`CV-1`)

→ **The solution is a single arrow: move rules into code / schema / triggers.** This means (a) the AI doesn't carry them, (b) code physically enforces them, and (c) violations are recorded. Tokens and self-enforcement are purchased by *the same transition*.

```
Bad:   Per-turn context = [all 12 documents]           → expensive + drift
Good:  Per-turn context = [Tier A minimal core]
              + gates enforced by code (no need to carry)
              + Tier B/C loaded only when triggered
```

---

## §1. Loading Policy — 3-Tier

What enters per-turn context is divided into three tiers. Token budgets are *caps*; when exceeded, apply §6 eviction.

### Tier A — Always Loaded (≤ 2K tokens)

Resident in context throughout the session. *Only the minimal invariant core + current position*.

| Content | Source | Form |
|---|---|---|
| L0 Core invariant 5 items (summarized) | `12 §4` | 1 line each, compressed |
| Current cycle ID + phase | `cycles/active/cycle-card.md` | Header only |
| Active hypothesis 1 line + Kill threshold | `cycle-card.md` | Snapshot |
| Active L2/L3 rule *list* (not body) | `project-rules.md`, `exemptions.md` | ID + one line |

Injection method: `SessionStart` hook (`hook-cycle-context`) compiles and injects. The AI does *not read* documents — the hook delivers a *compressed version*.

### Tier B — Loaded on Trigger (≤ 5K tokens)

Only when entering a specific *phase* or *situation*.

| Trigger | Load | Hook |
|---|---|---|
| Phase keyword (`persona`/`srs`/`architecture`/`stack`/`db`/`deploy`) | Rules for that stage (`rules-load.py <stage>`) | `hook-stage-rules` |
| Situational keyword (`auth`/`PII`/`migration`/`SLO`) | Corresponding `situational-rules/*.md` | `hook-stage-rules` extension |
| Gate reached (`gate`/`validation`/`pass`) | Relevant section of `08-pass-criteria.md` | On-demand |
| 5 active AP categories | 1 category from `11-anti-patterns.md` | `PF-7` rotation |

### Tier C — Explicit Request Only (∞)

Full load only when *explicitly* called by user or AI.

- Full AP catalog (25–30 items)
- All `templates/*`
- Past cycle retros
- `04-unknowns.md` framework explanation

### Tier Assignment Rule

> **"Always needed?"** → Tier A. **"Needed only in this situation?"** → Tier B. **"Rare, called only intentionally?"** → Tier C.

When adding new rules/documents, *a tier must be declared*. Content without a tier defaults to Tier C (not auto-loaded).

---

## §2. Trigger → Load → Apply Pipeline

The core gap in `CA-1` — *what does the AI do differently after installation?* An explicit mapping of which part of the harness a user utterance/event activates.

```
[Event]                    [Trigger]              [Load]                  [Apply]
────────────────────────────────────────────────────────────────────────────────
Session start          SessionStart hook      Inject Tier A core      Recognize current position
"I'll work on persona"  UserPromptSubmit       Tier B: persona rules   Respond with that phase's rules
                        keyword match          + relevant section of 01-product-track
File modified           PreToolUse             Hash verification       Block if tampered (§3)
(hypothesis file)
Tool call (WIP         PreToolUse             Check active symlink    Warn + record if WIP > 1
violation)
Cycle ends             Stop                   Present retro template  Guide carryover classification
Rule violation         PostToolUse            Black box append (§4)  Don't block, only record
```

### Application Priority (on conflict)

1. **L0 Core invariant violation** → block unconditionally (cannot be overridden)
2. **L3 > L2 > L1 > L0 Default** → `12 §2` layer priority
3. **Same-layer conflict** → ask user to decide (no auto-interpretation = AP-26)

### AI Behavior Contract

- *Cite the source* of the applied rule: "Applying tab per L2 `R-PROJ-FMT01`"
- If a rule not in Tier A is needed, *declare the load* and fetch it: "This phase requires DB rules — loading `rules-load.py db`"
- Do not apply rules *from memory*. Always apply from *currently loaded content*.

---

## §3. Rules-as-Code Boundary (= Computational vs Inferential)

What *code (hook/script) enforces* vs. what is left to *narrative (AI judgment)*. This boundary determines both tokens and trust simultaneously.

> **Vocabulary alignment (Böckeler)**: The two categories in this §3 are exactly her *execution modes* — "enforce with code" = **Computational** (deterministic, ms-latency, blockable), "narrative judgment" = **Inferential** (semantic, non-deterministic, rich). We arrived at this classification independently; her framework validates it. (See `00 §0.2b`)
>
> **Control direction (Guide/Sensor) is also tagged**: If a mechanism steers behavior *before* it happens → **Guide**; if it observes and corrects *after* → **Sensor**. For the harness to work *correctly*, both are required — Guide alone has no post-hoc correction; Sensor alone has no pre-emptive prevention.

### Enforced in Code (AI does not carry)

Only what is *objectively decidable* and *critical if violated*:

| Rule | Mechanism | Hook/Script | Guide/Sensor |
|---|---|---|---|
| Hypothesis immutability | SHA-256 hash chain + `PreToolUse` block | `hypothesis-register.py` + `hook-hypothesis-immutability` | **Sensor** (post-mutation detect + block) |
| WIP = 1 | Single-symlink check on `cycles/active` | `hook-cycle-wip` | **Guide** (pre-action block) |
| Close gate | Block cycle close if no reviewed, hash-bound pass exists | `close-cycle.py` + `active-symlink-guard` | **Sensor→Guard** (pre-close block) |
| Cross-cycle ratchet | Block cycle close if declared axis regresses below previous closed cycle watermark (monotonically non-decreasing) | `ratchet-check.py`/`ratchetlib.py` + `close-cycle.py` | **Sensor→Guard** (pre-close block) |
| L3 sunset expiry | Date comparison → invalidate expired exemption | `hook-l3-sunset-check` | **Guide** (validity before application) |
| Style / format | Delegated to toolchain (only checks config existence) | `hook-formatter-config-exists` | **Guide** (config enforcement) |

All 6 are **Computational** (deterministic) and *absent from narrative*. The AI does not carry them in context — code handles them.
(The *Kill criteria deploy gate* from `kill-check.py`+`hook-deploy-kill-check` previously appeared here but was **retired in #015** — zero activations, weakest effect, 3-layer dependency debt. C-06 Sunk-cost defense remains in narrative via retro kill rationale.)

### Kept in Narrative (AI judgment)

What is *context-dependent* and *requires interpretation to decide*:

- Persona quality, SRS completeness, hypothesis falsifiability
- Design Doc/ADR logic, fairness of trade-offs
- Judgments like "can this phase be skipped?"

These are in Tier B — *loaded on trigger* for AI judgment. Cannot be enforced in code.

### Boundary Decision Rule

> **Machine can decide yes/no + violation is critical** → code. **Requires interpretation + context-dependent** → narrative.

When in doubt, narrative. Expanding code gates itself risks `AP-05` (harness ceremony).

---

## §4. Black Box — Record, Don't Block

The most robust response to `CV-1` (author = enforcer = target). Blocking (hook block) is neutralized *if the hook is disabled*. But *recording* is hard to disable, and confronting the record retrospectively breaks self-deception.

### Principle

> A solo dev's motivation for breaking rules is not to pass an external audit — it is **self-persuasion**. Self-persuasion breaks when confronted with the *original record* in a retro. Like a flight recorder.

### What Is Recorded

`cycles/active/blackbox.jsonl` — append-only:

```jsonl
{"ts":"2026-05-31T14:02Z","event":"rule_override","rule":"R-LP01","layer":"L0-default","reason":"emergency fix","via":"L3 exemption"}
{"ts":"2026-05-31T15:40Z","event":"gate_soft_fail","gate":"kill-check","detail":"time 160% — soft","action":"chose to continue"}
{"ts":"2026-05-31T16:20Z","event":"stage_skip","stage":"design-doc","reason":"small scope, skipped this time"}
```

What gets recorded: rule overrides, continuing after soft-fail, phase skips, hypothesis reinterpretation attempts, WIP exceeded.

### Block vs. Record Distinction

| Event | Handling |
|---|---|
| L0 Core invariant violation | **Block** (§3) — also recorded |
| L0 Default / L1 / L2 override | **Record only** — proceed allowed |
| Continuing after soft kill | **Record only** |
| Phase skip | **Record only** |

Specifically: *only invariants are blocked; everything else is freely violated but recorded in the black box*. The reason freedom doesn't kill self-enforcement is in §4.4.

### Confrontation in Retro (Forced Loop)

The `Stop` hook (`hook-retro-on-stop`) presents the *entire* `blackbox.jsonl` at the front of the retro when the cycle closes:

> "There were 7 overrides/skips this cycle. Was each justified? Is there a pattern?"

This confrontation changes behavior in *the next cycle*. The black box is not punishment — it is raw material for *learning carryover* (connected to the keep/suspect/discard framework in `07`).

---

## §5. Prompt Caching Alignment

Buying tokens for nearly free. Opus's prompt caching reuses *stable prefixes* — same content on every turn gets a cache hit.

### Design

```
[Cached stable prefix]  ← changes rarely → cache hit
├─ Harness Tier A core (L0 Core 5 + AI behavior contract)
├─ Current cycle cycle-card snapshot (stable within a cycle)
└─ Active L2 project-rules list

[Uncached variable suffix]  ← changes every turn
├─ User utterance
├─ Tier B trigger loads (different per phase)
└─ Currently edited file contents
```

### Rules

- Tier A goes in the *prefix* — changes rarely within a cycle, maximizing cache hits
- When the cycle-card snapshot changes (phase transition), accept 1 cache invalidation — phase transitions are infrequent
- Tier B/C goes in the *suffix* — inherently variable, not a caching target
- Black box appends are *file writes*, not context, so they don't affect the cache

### Effect

When Tier A (~2K) is cached throughout the cycle, that much is not reprocessed every turn. With 5–6 phases and tens to hundreds of turns, cumulative savings are significant.

---

## §6. Token Budget per Turn

The *cap* on harness context per turn and the policy when exceeded.

### Budget

| Tier | Cap | If exceeded |
|---|---|---|
| A (always) | 2K | Compress harder — remove rule body, keep ID+1 line only |
| B (trigger) | 5K | Evict least-used stage rules first |
| C (on-demand) | Unlimited | Drop immediately after use (not carried to next turn) |
| **Total / turn** | **~7K** | Eviction below |

### Eviction Policy (LRU variant)

Eviction order when budget is exceeded:

1. **Tier C first** — on-demand content lives for *that turn only* and is discarded
2. **Unused Tier B** — stage rules unrelated to the current phase
3. **Tier A last** — never discarded wholesale. When budget is exceeded, *compress* (body → ID)

### Measurement

`scripts/` will include `context-budget.py` (planned) — estimates per-tier token count for currently loaded tiers and warns on budget overrun. Implementation after the first live cycle.

---

## §7. Next Steps for Token Optimization (Work Defined by This Document)

`CA-3`'s observation — *"the problem is structure, not compression"*. Now that structure is established by this document, the *subsequent* optimization work can finally be defined:

| Order | Task | Basis in this document |
|---|---|---|
| 1 | Produce a *compiled artifact* compressing Tier A core to ≤2K | §1 Tier A |
| 2 | Extend `rules-load.py` to filter by Stage + Layer + Tier | §1 Tier B |
| 3 | Actually implement the 5 code-enforcement hooks | §3 |
| 4 | Implement `blackbox.jsonl` + `hook-retro-on-stop` | §4 |
| 5 | Align caching with prefix/suffix separation | §5 |
| 6 | `context-budget.py` measurement tool | §6 |

*Compression happens only inside step 1* — §1–6 come first so we do not compress a broken structure.

---

## §8. What Claude Does / What You Do

### Claude

- Operates with only Tier A loaded at session start — does not read full documents
- *Declares Tier B load* and fetches when entering a phase/situation
- *States source (layer + ID)* when applying a rule
- Blocks invariant violations; for all other violations, *records in the black box and allows continuation*
- Presents the full black box at the front of the retro when the cycle closes

### You

- *Declare a tier* when adding new rules/documents (absent = Tier C = not auto-loaded)
- Actually implement the 5 code-enforcement hooks (in priority order after the first live cycle)
- *Actually confront* the black box in the retro — skipping it renders all of §4 inert
- Overrides are free, but be aware they are recorded

## §9. Anti-pattern Connections

| What this document prevents | AP |
|---|---|
| Carrying rules every turn → token explosion | `AP-05` Harness ceremony |
| Applying rules from memory (drift) | `CA-1` (DA log) |
| Invariant override attempts | `AP-27` |
| Avoiding black box confrontation | New — `AP-31` Black box avoidance (needs to be added to `11`) |

## §10. Related Documents and Tools

- `GOAL.md` §3.3 — the condition this document satisfies
- `devils-advocate.md` `CA-1`/`CA-3`/`CV-1`/`PF-1`/`PF-3` — items this document closes
- `12-rule-layering.md` — layer priority (basis for §2 application priority), tool-pointer (§3)
- `06-rules.md` — needs Tier/Scope/Layer metadata attached
- `07-looping-mechanics.md` — black box → carryover connection (§4.4)
- `hooks/README.md` — actual hook catalog for §2–§4
- `scripts/rules-load.py` — Tier filter extension target (§7-2)
- `scripts/` — `context-budget.py` (new, §6)
