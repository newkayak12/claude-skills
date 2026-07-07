# 06. Rules — Always-on rules (selective loading by phase)

This document is a catalog of rules the harness *always* depends on, collected in one place. You do not need to apply all rules simultaneously at every phase — look at the **`Stage` tag** on each rule and pull it out when entering that phase.

Rules that appear only in specific situations (security, data, operations, cognitive, self-discipline baselines) are cataloged separately in [`situational-rules/`](./situational-rules/).

## 0. How to read this document

Each rule is expressed as:

- **ID**: `R-CCNN` (CC = category abbreviation, NN = sequence number)
- **Stage**: when it applies
- **Rule**: one-line imperative
- **Why**: what breaks if ignored
- **How to apply**: practical application

## 0.1 Stage list (selective loading keys)

| Stage key | Meaning |
|---|---|
| `cycle-start` | Cycle start (just before entering the product track) |
| `product-track` | During product track execution |
| `mvp-scope` | MVP scope definition phase |
| `gate-1` | Validation gate 1 (product hypothesis) |
| `tech-track` | Entering the tech track |
| `architecture` | Architecture design phase |
| `decision` | Immediately before a major decision (stack, DB, API, etc.) |
| `code-writing` | Code writing phase |
| `gate-2` | Validation gate 2 (technical hypothesis) |
| `task-done` | When judging task completion |
| `cycle-end` | Cycle end (retrospective) |
| `always` | Throughout the entire cycle |

---

## 1. Code / Design principles

**Loading point**: `code-writing`

### R-CD01: Keep SOLID in mind while writing code
- **Why**: Five principles for lowering the cost of change. Even when you can't apply them, you must *recognize* when you're violating them.
- **How**: SRP (Single Responsibility), OCP (Open/Closed), LSP (Liskov Substitution), ISP (Interface Segregation), DIP (Dependency Inversion). Check all five as the first pass during code review.

### R-CD02: KISS — simplicity is the default
- **Why**: Complexity is easy to add and hard to remove. The simpler solution is *always* the first candidate.
- **How**: When two solutions are equivalent, prefer the one with fewer lines, fewer dependencies, and fewer concepts.

### R-CD03: YAGNI — don't write code for hypothetical futures
- **Why**: Features that won't be used block future changes. Speculation belongs in *documentation*, not *code*.
- **How**: Limit code to currently validated requirements. Future extensions go in ADRs only.

### R-CD04: DRY — wait for the *Rule of Three*
- **Why**: Abstracting after two repetitions bakes in the *wrong* abstraction — WET (write everything twice) is often safer.
- **How**: Consider abstraction only when the same intent/domain appears a third time.

### R-CD05: Composition over Inheritance
- **Why**: Inheritance creates tight coupling. Expressing behavioral differences via *strategy/policy objects* is generally more flexible.
- **How**: When tempted to add new behavior, check composition possibilities *before* extending the inheritance tree.

### R-CD06: Tell, Don't Ask / Law of Demeter
- **Why**: Querying an object's internal state and branching externally breaks encapsulation.
- **How**: When you see the `a.b().c().d()` pattern, consider adding a delegation method instead. Exception: *Value Object chains*.

### R-CD07: Boy Scout Rule
- **Why**: *Leave code a little cleaner* than you found it. Aggregated improvements reduce technical debt.
- **How**: Within the scope of the change, clean up *names, duplication, and dead code* in the same PR. **Large unrelated refactors are prohibited**.

---

## 2. Architecture principles

**Loading point**: `architecture`, `tech-track`

### R-AR01: Separation of Concerns
- **Why**: When a module mixes multiple concerns, a single change can destabilize the entire module.
- **How**: When defining a module, you must be able to state the reason it changes in one sentence.

### R-AR02: Single Source of Truth
- **Why**: Storing the same fact in two places accumulates *consistency debt*.
- **How**: Identify the *owning system* for each core entity. Other locations hold *copies* — document *how they sync* in an ADR.

### R-AR03: Fail Fast, Fail Loud
- **Why**: Silent failures are debt that *defers discovery*. Once in production, they become impossible to debug.
- **How**: Invalid inputs and states are *rejected immediately* at the boundary, with a structured error log. Exception swallowing is prohibited.

### R-AR04: Idempotency by Default at System Boundaries
- **Why**: Distributed systems, retries, and duplicate calls *will* happen. Non-idempotent operations corrupt data.
- **How**: Accept an idempotency key for external mutating requests. Explicitly specify *at-least-once vs exactly-once* for internal messages.

### R-AR05: 12-Factor App compliance
- **Why**: *Minimum compatibility* for container/cloud environments. Violating any of the 12 factors equals operational burden.
- **How**: Verify all 12 as a checklist (Codebase, Dependencies, Config, Backing Services, Build/Release/Run, Processes, Port Binding, Concurrency, Disposability, Dev/Prod Parity, Logs, Admin Processes).

### R-AR06: Separate one-way vs two-way door decisions
- **Why**: Reversible decisions (two-way) should be made fast; irreversible decisions (one-way) should be made slowly and deeply. Treating both the same makes fast decisions heavy and heavy decisions light.
- **How**: Assign a *Reversibility* rating to each decision. One-way decisions require an ADR + mandatory devil's advocate.

---

## 3. Process gates (mandatory)

**Loading point**: `always` — enforced throughout the cycle

### R-PG01: No code before design
- **Why**: If you can't write the design document, your thinking isn't organized yet. Coding first wastes time solving the *wrong* problem.
- **How**: No code until brainstorming + Design Doc/ADR pass. Exception: 1-3 day spikes (whose output flows into an *ADR*, not code).

### R-PG02: No build before validation
- **Why**: Entering the build phase on an unvalidated hypothesis risks having to start over after the demo.
- **How**: Pass validation gate 1 before entering the tech track. Pass gate 2 before full-scale build.

### R-PG03: Small atomic commits
- **Why**: Large commits are impossible to review and impossible to roll back. *One commit = one intent*.
- **How**: Keep commits small enough to describe in a *complete sentence* in the commit message. No unrelated changes in one PR.

### R-PG04: Explicitly define the Branch / Merge policy
- **Why**: Without a policy, every decision is improvised. PR size, merge strategy, and release cutoffs become unpredictable.
- **How**: Define it in one sentence. Example: "trunk-based, feature branches ≤3 days short-lived, squash merge, semantic version."

### R-PG05: Document the reason for any skip
- **Why**: Skipping a phase is acceptable — but without recording *why*, the same mistake happens at the same point in the next cycle.
- **How**: One line in the cycle notes: "Skipped: [phase name] — Reason: [reason] — Risk accepted: [what]"

---

## 4. Definition of Done (mandatory)

**Loading point**: `task-done`

> **Trimmed**: Performance budget / Observability have been moved to [`situational-rules/operations.md`](./situational-rules/operations.md) as core operational concerns.

### R-DoD01: Tests pass + coverage threshold met
- **Why**: "Done" without tests is a *claim*, not a fact.
- **How**: Define coverage targets *numerically* at cycle start (line/branch). CI failure blocks merge.

### R-DoD02: Lint / Type-check pass
- **Why**: Static analysis is a free first-pass reviewer. Code that doesn't pass is *not read*.
- **How**: Pre-commit hook + CI. Disabling checks requires a *comment with justification*.

### R-DoD03: Core path manual verify
- **Why**: Tests verify *code correctness*; *feature behavior* is separate. Even when automated tests pass, a human must run it once.
- **How**: Manually run the happy path + 1-2 unhappy paths for core user stories, and record the results in the PR body.

### R-DoD04: Documentation updated (Design Doc / ADR / README)
- **Why**: When code changes and documentation diverge, documentation *inevitably* becomes a lie.
- **How**: Update affected Design Doc sections, ADRs, and READMEs *in the same PR*. Failure to do so blocks merge.

---

## 5. Decision / Documentation discipline (mandatory)

**Loading point**: `decision`, `architecture`, `tech-track`

### R-DD01: ADR for every significant decision
- **Why**: An undocumented decision is an *unmade* decision. The same debate restarts from scratch in the next cycle.
- **How**: Write an ADR if any of the following apply — vendor lock-in / cost impact / security implications / external interface / data model change.

### R-DD02: Standardize on MADR format
- **Why**: Inconsistent formats make *finding* decisions impossible. You'll be lost six months later.
- **How**: Use the template at [`templates/adr.md`](./templates/adr.md) as-is. Minimum three Considered Options.

### R-DD03: Immutable after Accepted
- **Why**: The decision itself is *history*. Post-hoc edits erase *why that decision was made at that moment*.
- **How**: To change a decision, write a **new ADR**. Mark the old ADR as `Superseded by ADR-XXXX` and preserve its body.

### R-DD04: Design Doc per major feature
- **Why**: Without a single place for the key decision bundle, the system picture lives only in someone's head.
- **How**: One Design Doc per major feature. Small changes are covered by an ADR. Template: [`templates/design-doc.md`](./templates/design-doc.md).

### R-DD05: Living docs — monthly staleness check
- **Why**: A document written once and never revisited *becomes a source of lies*.
- **How**: On the 1st of each month — pick 5 key documents and check the gap between *last update* and *last code change*. Gaps over one month are suspect.

---

## 11. Knowledge preservation

**Loading point**: `cycle-end`, `always`

### R-KP01: Retro after every cycle
- **Why**: A cycle without a retrospective is a cycle with *no learning*. The same mistakes repeat.
- **How**: Auto-call `think:retrospective` at cycle end. Three items: *what surprised you* / *what was uncomfortable* / *what to change next time*.

### R-KP02: Maintain Ubiquitous Language / Glossary
- **Why**: When domain terminology drifts, code, documentation, and conversation all carry *slightly different meanings*.
- **How**: Add a one-line Glossary entry when a new domain term appears. Unify code, documentation, and UI to use the *same term*.

### R-KP03: TIL / Learning notes
- **Why**: Surprises from interviews, spikes, and incidents are forgotten by cycle end.
- **How**: Note *counterintuitive findings* from the cycle in 1-2 lines. Store in a separate file or within the cycle folder.

### R-KP04: Future-me as audience
- **Why**: For solo developers, the *most frequent collaborator* is yourself six months later.
- **How**: Write documentation, commit messages, and code comments assuming *your future self* has no context.

---

## 12. Scope discipline

**Loading point**: `mvp-scope`, `product-track`

### R-SC01: Explicitly list MoSCoW Won'ts
- **Why**: Without listing what you *won't* do, everything looks like it *will* be done. This is the primary cause of scope creep.
- **How**: At MVP definition, put at least five items in the Won't category — more is better.

### R-SC02: Scope hammering, not appetite stretching (Shape Up)
- **Why**: Extending the timeline makes it perpetually extensible. Time is fixed; scope is what gets cut.
- **How**: When time is short, the first reaction should be "what can we cut?" not "give us more time." Imagine a *reduced version* of every feature.

### R-SC03: Appetite-based, not estimate-based
- **Why**: "How long will it take?" is unknowable. "How much is it worth spending?" is answerable.
- **How**: Fix the *budget* (time) at the start. Decide scope to fit within it.

### R-SC04: Intentionally limit beta user count
- **Why**: Too many beta users = feedback noise + operational burden + scope expansion pressure.
- **How**: First release targets *very few* (5-20 people). Expand after learning is complete.

---

## 13. Technical debt management

**Loading point**: `tech-track`, `cycle-end`

### R-TD01: Debt register — consciously catalog it
- **Why**: Unconscious accumulation causes a *simultaneous explosion* one day. Conscious accumulation is *controllable*.
- **How**: Track in `_draft/debt.md` or a GH issue label. Per item: *what · why accepted · trigger (when to pay it off)*.

### R-TD02: Conscious accept vs unconscious accumulate
- **Why**: Without recording the *why* and *cost* of "moving fast this time," the next decision-maker (your future self) won't understand.
- **How**: PRs that accept debt must include in the body: "Tech debt accepted: [what] / Reason: [why] / Trigger: [condition for re-evaluation]"

### R-TD03: Pay-down ratio per cycle
- **Why**: Without *explicitly allocating* time to pay down debt, it never gets paid.
- **How**: Fix a portion of cycle capacity (e.g., 15-20%) for debt repayment. At cycle start, select *which items* to pay down.

### R-TD04: Trigger-based re-evaluation
- **Why**: Debt becomes relevant when *circumstances change*, not on a timer — review it when a *specific event* occurs.
- **How**: Register a trigger for each debt item (e.g., "when DAU hits 10k", "when external dependency is deprecated"). Auto-revisit when trigger fires.

---

## 14. AI / Skill invocation discipline (mandatory)

**Loading point**: `always`

### R-AI01: Auto-call the *designated entry skill* when entering a phase
- **Why**: Improvising skill selection at each phase causes omissions. *Routine* is the key.
- **How**: Entry skills per phase are specified in [`05-plugin-mapping.md`](./05-plugin-mapping.md). *Call the designated skill first* when entering a phase.

### R-AI02: Call a `think`-family skill immediately before a decision
- **Why**: Decision moments are the most common time to fall into *confirmation bias*. External (skill) verification is needed.
- **How**: Before major decisions (architecture, stack, DB, API), call `think:decision-maker` or `think:devils-advocate`. If strongly drawn to one option, call `cognition:bias-auditor`.

### R-AI03: Skill output is a *starting point* — verification is your responsibility
- **Why**: AI output being *plausible* has no relation to being *correct*. Without your personal sign-off, accountability diffuses.
- **How**: ADRs, Design Docs, and code produced by a skill are adopted *under your name*. Rewrite key decisions *in your own words* to confirm.

### R-AI04: Record the reason for any Override
- **Why**: Not following a skill's recommendation is *perfectly valid*. But without recording the reason, the *same debate repeats* later.
- **How**: When ignoring a skill recommendation, add one line to the ADR body or cycle notes: "Skill suggested X, chose Y because Z"

### R-AI05: More than 5 skill calls in one cycle is a warning sign
- **Why**: Increasing skill calls signals *analysis paralysis* and blurring of priorities.
- **How**: Count skill calls in cycle notes. If more than 5, check *which phase is being overdone*.

### R-AI06: Do not accept *all* skill output
- **Why**: Skills are good at diverging but cannot carry your *specific project context*. Generalized recommendations get mixed in.
- **How**: Remove *items that don't fit the project* from skill output before adopting. Record what was trimmed.

---

## Appendix A — Stage → Rule Index (Selective Loading table)

When entering each phase, *look only at these rules*. Do not re-read the entire document every time.

### `cycle-start`
- R-AI01 — Confirm phase entry skill mapping

### `product-track`
- R-SC03 — appetite-based
- R-KP02 — Glossary update
- R-AI01 — Entry skill call

### `mvp-scope`
- R-SC01 — Won't list
- R-SC02 — Scope hammering
- R-SC03 — Appetite-based
- R-SC04 — Beta user limit

### `gate-1`
- R-PG02 — No next phase before validation passes
- R-AI02 — Call `think:devils-advocate`

### `tech-track`, `architecture`
- R-AR01 ~ R-AR06 — All architecture principles
- R-DD01 ~ R-DD05 — All decision/documentation discipline
- R-TD01 — Open debt register
- R-AI01, R-AI02

### `decision`
- R-AR06 — Reversibility
- R-DD01 ~ R-DD03 — ADR writing
- R-AI02 — `decision-maker` / `devils-advocate`

### `code-writing`
- R-CD01 ~ R-CD07 — All code/design principles
- R-PG03 — Small atomic commits
- R-DoD01 ~ R-DoD04 — DoD check

### `gate-2`
- R-PG02 — No build before validation passes
- R-AI02

### `task-done`
- R-DoD01 ~ R-DoD04 — Full DoD
- R-DD05 — Document staleness check

### `cycle-end`
- R-KP01 — Call Retro
- R-KP03 — TIL writeup
- R-TD03 — Pay-down follow-up decision
- R-AI05 — Skill call count check

### `always` (throughout the cycle)
- R-PG01 ~ R-PG05 — All process gates
- R-AI01, R-AI03, R-AI04, R-AI06

---

## Appendix B — When a rule is violated

Violating a rule is *permitted*. However, record the following:

```
Rule violated: [R-XXNN]
Stage: [when]
Reason: [why it was violated]
Risk accepted: [what risk is being taken on]
Re-evaluation trigger: [when to revisit]
```

→ This record itself becomes one line in the *debt register*.

---

## Appendix C — Situational Rules (separate reference)

The following areas are not applied throughout the entire cycle, but *must be referenced when those situations arise*. They are split into separate documents.

| Area | When to reference | File |
|---|---|---|
| **Security baseline** | When handling auth, authorization, or PII | [`situational-rules/security.md`](./situational-rules/security.md) |
| **Data discipline** | When handling DB schema, migrations, or backups | [`situational-rules/data.md`](./situational-rules/data.md) |
| **Operations / Observability baseline** | Before launch + during operations (incl. perf budget, three pillars) | [`situational-rules/operations.md`](./situational-rules/operations.md) |
| **Cognitive discipline** | Decision paralysis, strong pull toward one option, high-stakes bets | [`situational-rules/cognitive.md`](./situational-rules/cognitive.md) |
| **Self-discipline** | When cycles drag out or WIP grows | [`situational-rules/self-discipline.md`](./situational-rules/self-discipline.md) |
