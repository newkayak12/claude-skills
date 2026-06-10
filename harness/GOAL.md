# Harness Engineering — Goal

This document declares the *final usage goal* of `_draft/harness-engineering/`. All design decisions, counter-argument reviews, and next-step work are evaluated against this goal. All subsequent user interactions proceed on the premise of this goal.

## §1. Goal Statement

> **Marketplace install → `harness:~ install` → interactively define user-rules with the user → run planning-development-testing cycles using the defined rules to develop the product.**

That is, the harness is not a *document to be read* but an *installable plugin that executes*. On first run it sets up the environment through *conversation* with the user, then is *applied* in every subsequent cycle.

## §2. Operational Flow

```
[1] Search and install from Marketplace
        │
        ▼
[2] harness:install  (or equivalent command)
        │  - Vendors + scaffolds hooks + settings.json + CLAUDE.md into target project .claude/ (§2.1)
        │  - The global plugin acts only as installer/generator
        ▼
[3] Interactive user-rule definition       ← once on first run
        │  - Code style (tool pointer)
        │  - Preferred language/stack
        │  - WIP, cycle length, and other default overrides
        │  - Generates L1 user-rules.md
        ▼
[4] Agree on project-rules at project start   ← once per project
        │  - Generates L2 project-rules.md
        │  - Confirms L0 Core invariants
        ▼
[5] Cycle entry                        ← every cycle
        │  - Pre-cycle gate (09)
        │  - Scaffold folders with cycle-init.py
        │  - Hypothesis registration (hash chain)
        ▼
[6] Planning → Development → Testing                ← inside the cycle
        │  - Write SRS / Design Doc / ADR (interaction required)
        │  - Confirm Gate 1·2 pass
        │  - Monitor Kill criteria
        ▼
[7] Retrospective → carryover → next cycle
```

### §2.1 Delivery Model — install = project `.claude/` scaffold = ambient governance

The harness's delivery unit is not *a single global plugin bundle* but **the target project's `.claude/`**.
`harness:install` (`project-install.py`) vendors and scaffolds hook payloads +
`settings.json` (hook wiring, referencing `$CLAUDE_PROJECT_DIR/.claude/harness`) + `CLAUDE.md`
(cycle discipline governance) into the target repo's `.claude/` (idempotent, preserves existing files). The `.claude/` auto-load solves two problems simultaneously:

- **Per-project targeting** — each repo gets its own version (not locked to a single global version).
- **Ambient governance** — "in that repo, the AI automatically operates under the harness" (cycles are not locked behind opt-in calls).

Role separation (anti-drift principle):
- **Enforcement** (invariant · plan-before-code) is handled deterministically by **hooks** — not skills (AI discretion).
- **Guidance** is ambient via the scaffolded **CLAUDE.md**.
- **Skills** are only the conversational entry points (`install`/`cycle`).
- `cycles/` and `.harness/` are already project-local.

The global plugin is reduced to *installer/generator*, and actual discipline lives project-locally. Do not revert to
(single global version · explicit-call-only cycles) — delivery that satisfies the "install → applied" spirit of §1 is *the only* path through this model.

## §3. Constraints This Goal Imposes on Design

Given this goal, the following *must be satisfied*:

1. **Installability** — the harness must be a plugin distributable via marketplace. Not a mere collection of markdown files.
2. **Interactive initialization** — L1 user-rules are created through conversation with the user on first run. Having users manually write files is *not the default path*.
3. **AI operating mechanism specified** — after installation, it must be defined *when the AI loads what* (devils-advocate `CA-1`).
4. **Per-phase application points** — there must be a mapping of *which hooks, skills, and documents are active* at each phase of planning/development/testing.
5. **Cycle-unit value proof** — a user who completes the first cycle must be able to say "this harness helped." Value must not be deferred until the second cycle.
6. **Per-project ambient delivery** — install scaffolds into the target project's `.claude/` so it *automatically* applies within that repo (§2.1). Do not revert to global single-version · explicit-call-only.

## §4. What This Goal Is *Not* (Boundaries)

Stated explicitly to prevent misunderstanding:

- **Not a team collaboration tool** — solo dev only. Multi-author conflicts are not addressed.
- **Not a CI/CD system** — build/deploy/test infrastructure is delegated to external tools (pre-commit, GitHub Actions, etc.). The harness only verifies *config existence* (`12-rule-layering.md §5`).
- **Not a project management tool** — not a Jira/Linear replacement. Covers only the *methodology* and *deliverable classification* inside a cycle.
- **Not a general framework applicable to all projects** — specialized for a solo dev's *single product cycle* (concept-validation-launch). Over-engineering for simple maintenance or bug fixes.

## §5. When Changes Are Made to This Document

The §1 Goal Statement of this document is *not changed lightly*. When changing:
- One line in §6 Change log stating the reason
- Archive the prior statement
- Re-examine impacted design decisions (especially whether the CA/PF items in `devils-advocate.md` remain valid)

## §6. Change Log

- 2026-05-28 — Initial draft. Source: user's explicit statement ("marketplace install → harness:~ install → interactive user-rule → planning-development-testing cycle").
- 2026-06-08 — Added §2.1: formalized delivery model ("install = project `.claude/` scaffold = ambient governance") + reflected in §2 step [2] and §3.6. Reason: delivery model redesign (P0 #014/#014b) was not reflected in the GOAL body, creating drift recurrence risk (TODO P0 ⓒ).

## §7. Related Documents

- `README.md` — document index reflecting the Goal
- `00-overview.md` — conceptual definition (background for the *what* of this document)
- `05-plugin-mapping.md` — plugin mapping (elaborates §2 step 6 of this Goal)
- `12-rule-layering.md` — L1 User / L2 Project / L3 Cycle (deliverable structure for Goal §2 steps 3–5)
- `devils-advocate.md` — accumulated vulnerability analysis of progress toward this Goal (especially `CA-1`, `CA-2`, `PF-1`, which directly connect to §3.3 and §3.4)
