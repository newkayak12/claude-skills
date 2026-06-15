# 11. Anti-patterns — Harness Failure Mode Catalog

Traps you fall into even when you *know* the rules. This document collects *every pattern that bypasses all the rules seen so far*. A self-audit tool.

## 11.1 Why an Anti-pattern Catalog is Needed

Rules define *what to do*. Anti-patterns show *the shape of what not to do*.

- When a rule is violated, an *explicit alarm* fires.
- But *violations that look similar* slip through as if no rule was broken.
- An anti-pattern catalog is a *pattern-recognition* tool — "isn't this that pattern?" — a self-invocation.

→ Read this document *each quarter* as a self-audit ([`SD-10`](./situational-rules/self-discipline.md#sd-10-quarterly-self-retrospective--rules-i-break)).

## 11.2 Anti-patterns in the Validation Phase

### AP-01: Validation theater
- **Symptom**: Interviewed 5 people but *the conclusion is identical to before*. "Hypothesis validated."
- **What broke**: Only the *form* of validation was followed; the *outcome was predetermined*. Confirmation bias reduces interviews to *evidence collection*.
- **Alarm**: "Mom Test" violation — more future-intent questions than past-behavior questions.
- **Response**: *Pre-register* hypotheses ([`08 §8.4`](./08-pass-criteria.md#84-hypothesis-pre-registration)) + lock the *rejection line* before the interviews.
- **Related**: [`C-01 Bias check`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit)

### AP-02: Persona drift
- **Symptom**: The *Persona quietly expands* during the cycle. "Women in their 20s" becomes "anyone who's interested."
- **What broke**: Non-Persona responses from interviews are classified as *valid data* → hypothesis validation is destabilized by *redefining the population*.
- **Alarm**: Gate 1 pass rate violation ([`08 §8.2`](./08-pass-criteria.md#82-gate-1--product-hypothesis-validation-criteria)) — "non-Persona statements < 30%".
- **Response**: *Explicitly define* the Persona and tag each interview raw note with *Persona match status*.

### AP-03: Hypothesis polyamory
- **Symptom**: Cycle starts with 5 hypotheses → after interviews, hypotheses have *proliferated to 15*. Priority collapses.
- **What broke**: New hypotheses are *added without removing existing ones*. [`SD-02`](./situational-rules/self-discipline.md#sd-02-max-5-hypotheses-per-cycle) violated.
- **Alarm**: Hypothesis count > 5.
- **Response**: When adding a new hypothesis, *remove 1 existing one + move it to the next-cycle queue*.

### AP-04: Negative-evidence amnesia
- **Symptom**: 4 out of 5 interviewees said "I probably wouldn't use it," but only *the 1 positive* is cited.
- **What broke**: Negative evidence is treated as an *exception*. The most dangerous form of confirmation bias.
- **Alarm**: Gate 1 pass report contains *no citation of negative responses*.
- **Response**: Write *negative responses first* in the retrospective — "4 out of 5 were negative for ~ reason."

## 11.3 Anti-patterns in the Deliverable / Gate Phase

### AP-05: Harness ceremony
- **Symptom**: Every phase deliverable is *formally* filled out, but *no decisions are recorded*. Documents multiply.
- **What broke**: Writing deliverables becomes the *goal*. No longer a *means* to validate and decide.
- **Alarm**: Deliverable volume per cycle > number of *decisions* per cycle.
- **Response**: Each deliverable must contain *at least 1 decision/exclusion* before moving to the next phase. [`R-PG02`](./06-rules.md).

### AP-06: Gate fudging
- **Symptom**: Gate pass criteria are *softened after seeing the results*. "This case was different..."
- **What broke**: [`08 §8.8`](./08-pass-criteria.md#88-threshold-adjustment-rules) violated. Pre-registration loses its meaning.
- **Alarm**: A numeric adjustment PR/ADR appears immediately before passing a gate.
- **Response**: Lock numbers *before the cycle starts* → any change requires an ADR + rationale + *record in retrospective*.

### AP-07: Document inflation
- **Symptom**: A decision that could end in a one-line ADR is inflated into a *10-page Design Doc*.
- **What broke**: Confusing the *weight of a decision* with the *weight of a document*.
- **Alarm**: The same decision has RFC + Design Doc + ADR *all present*, with identical decision content.
- **Response**: Check the document matrix in [`templates/README.md`](./templates/README.md) — write *only what that phase requires*.

### AP-08: Stale ADR
- **Symptom**: The system no longer uses PostgreSQL, but ADR-0007 "We use PostgreSQL" remains *Accepted*.
- **What broke**: When a decision *changes*, no new ADR + Superseded-by was written. ADR immutability rule violated.
- **Alarm**: During the quarterly retrospective, an ADR is found to be *false*.
- **Response**: *Audit Accepted ADRs* quarterly → mark items that differ from reality as Superseded.

### AP-32: Decision stamping (RFC as checklist)
- **Symptom**: Open questions are *auto-harvested* into a checklist and each item is mechanically stamped recommend → "ok" → *decided*. The RFC grows item-count (e.g. an RFC bloated to 12 Q-items), context ignored.
- **What broke**: A decision is treated as a *stamp* instead of the *product of discussion*. An RFC is a **coherent reasoning narrative on one narrow topic** — what to address emerges *from* discussing it, and Design *verifies* it. Harvest-and-stamp skips the reasoning.
- **Alarm**: An RFC is a list of `Q1…Qn` with a verdict pinned per line; decisions appear with no surrounding prose argument; one RFC spans many unrelated topics.
- **Response**: Write RFCs as **prose** on **one topic**. No question-harvesting into checklists. Discuss → let the decisions-to-make emerge → settle them in the prose, then verify in Design. One RFC = one narrow topic; if it widens, split (→ AP-33).

### AP-33: Deferred grab-bag
- **Symptom**: Unresolved items from a too-broad RFC are swept into a single `deferred-decisions` parking dump scattered across documents.
- **What broke**: A wide RFC spawns dozens of loose ends; instead of being **re-framed as a decision queue and split into topic-RFCs**, they are parked in a grab-bag that no flow ever drives to closure.
- **Alarm**: A document named `deferred`/`parking`/`misc` accumulates decisions; >1 topic's open items live in one file; the count grows cycle over cycle.
- **Response**: Re-frame deferred items as an **index/queue** (pointer, not parking), then spin each cluster into its own narrow topic-RFC. Decisions close *inside* a topic-RFC, never in a grab-bag.

## 11.4 Anti-patterns in the Loop / Progress Phase

### AP-09: Cycle chaining
- **Symptom**: A new cycle starts *immediately after one ends, without a retrospective*.
- **What broke**: [`SD-07`](./situational-rules/self-discipline.md#sd-07-cycle-end-is-explicit) violated. Learnings are *not absorbed into the next cycle*.
- **Alarm**: Gap between cycle end → new cycle start < 1 day.
- **Response**: Include the retrospective in *the definition of cycle completion*. Starting a new cycle without a retrospective is *prohibited*.

### AP-10: Sunk-cost rescue
- **Symptom**: Kill criteria are met but the cycle is *extended* with "we've come this far."
- **What broke**: [`C-06 Sunk cost`](./situational-rules/cognitive.md#c-06-sunk-cost--past-investment-does-not-affect-the-decision) violated. [`07 §7.5`](./07-looping-mechanics.md#75-loop-kill-criteria--when-to-kill-a-cycle) Kill bypassed.
- **Alarm**: An *extension decision* occurs after a Hard kill trigger fires, *without an ADR/retrospective record*.
- **Response**: Make kill triggers an *automatic* gate. Extension requires an *explicit ADR + resetting new kill criteria*.

### AP-11: Pivot avoidance
- **Symptom**: A hypothesis has been *falsified* but the cycle is circumvented by "rerunning a phase." No pivot.
- **What broke**: In the 4-branch decision tree at [`07 §7.2`](./07-looping-mechanics.md#meso--most-important), the *hardest decision* (pivot) is replaced by the *easiest decision* (re-run).
- **Alarm**: Gate not passed after re-running the same phase 2+ times.
- **Response**: 3 re-entries = automatic pivot decision ([`07 §7.3`](./07-looping-mechanics.md#73-loop-re-entry-decision-table)).

### AP-12: WIP explosion
- **Symptom**: 2–3 cycles in progress simultaneously. "We'll get there together."
- **What broke**: [`SD-03 WIP=1`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-limit) violated. None of them can be *completed*.
- **Alarm**: 2+ Cycle Cards are *simultaneously* active.
- **Response**: *Explicitly close the current cycle* before starting a new one. Operational incidents are the only exception.

### AP-13: Hill chart stagnation
- **Symptom**: A point on the hill chart remains *in the uphill zone for 3+ weeks*.
- **What broke**: The unknown (uphill) is *not decreasing* — exploration is *repeating without progress*.
- **Alarm**: Point position *unchanged* on weekly hill chart update.
- **Response**: Re-entry or kill candidate ([`07 §7.7`](./07-looping-mechanics.md#77-loop-visualization--hill-chart)).

## 11.5 Anti-patterns in the Technical / Implementation Phase

### AP-14: Premature scaling
- **Symptom**: *Microservices* architecture before even 100 users.
- **What broke**: Designed for *imagined load*, not current load.
- **Alarm**: *Actual load* measured at NFR ([`08 §8.6`](./08-pass-criteria.md#86-performance-budget-defaults)) < 10% of designed load.
- **Response**: First-principles ([`C-08`](./situational-rules/cognitive.md#c-08-first-principles-thinking--from-analogy-to-principle)) — design only for *current load + 6-month projection*.

### AP-15: Solution-shopping
- **Symptom**: "I want to try this technology" is the *real starting point* of the cycle.
- **What broke**: Solution → Problem (reversed order). [`09 §9.5`](./09-pre-cycle.md#95-pre-cycle-anti-patterns) not applied.
- **Alarm**: Problem statement *depends on a technology name* ("Let's use X to solve Y").
- **Response**: *Rewrite the problem statement* — without the technology name, describe only the problem. Does that technology *actually* fit that problem?

### AP-16: NFR omission
- **Symptom**: The NFR section of the Design Doc is *empty* or filled with "fast and stable."
- **What broke**: NFRs without numbers are *not agreed upon* ([`O-02`](./situational-rules/operations.md#o-02-performance-budget--set-numbers-in-advance)).
- **Alarm**: Design Doc NFR contains *no numbers*.
- **Response**: Start from [`08 §8.6`](./08-pass-criteria.md#86-performance-budget-defaults) baseline + adjust per cycle.

### AP-17: Observability afterthought
- **Symptom**: *Logs/Metrics/Traces* are added immediately before launch.
- **What broke**: [`O-01 Three Pillars`](./situational-rules/operations.md#o-01-three-pillars--required-before-release) not recognized as *part of the DoD*.
- **Alarm**: Observability work begins *1 week before launch*.
- **Response**: Write observability *at the same time* as the core feature — include it in the DoD.

### AP-18: Test theater
- **Symptom**: Tests exist but are *written to pass*. Real dependencies are bypassed with mocks.
- **What broke**: Tests become a *mirror of the code* — built on the same assumptions.
- **Alarm**: Tests *always change in lockstep* with code changes (without failures).
- **Response**: *Integration tests* for core paths — minimize mocks. [`R-TST02`](./06-rules.md).

## 11.6 Anti-patterns in the Self-control / Psychology Phase

### AP-19: Discovery escape
- **Symptom**: Starting to write *code* during the validation phase. "Building it seems faster than validating."
- **What broke**: [`SD-06`](./situational-rules/self-discipline.md#sd-06-writing-code-instead-of-validating--self-check) violated. Avoiding uncertainty.
- **Alarm**: Time spent writing code > time spent on interviews and validation.
- **Response**: Self-audit — "Does writing code right now reduce *the biggest risk*?"

### AP-20: Ship paralysis
- **Symptom**: "Just a bit more polish" loops infinitely. Launch date has been pushed *5 times*.
- **What broke**: [`SD-04 80% ship rule`](./situational-rules/self-discipline.md#sd-04-80-ship-rule), [`SD-08`](./situational-rules/self-discipline.md#sd-08-check-the-real-reason-for-postponing-release) violated. Fear of criticism disguised as *technical justification*.
- **Alarm**: Launch pushed *3 times*.
- **Response**: Launch with limited beta users ([`R-SC04`](./06-rules.md)) to reduce *psychological exposure*.

### AP-21: Rule exemptionism ("my case is different")
- **Symptom**: Every time a rule applies, it is avoided with "our case is different."
- **What broke**: [`SD-11`](./situational-rules/self-discipline.md#sd-11-check-im-different), [`C-11 Outside view`](./situational-rules/cognitive.md#c-11-outside-view--base-rate-of-similar-attempts) violated. Inside view overconfidence.
- **Alarm**: "Different" claim appears 3+ times per quarter.
- **Response**: *Directly find* the base rate of similar attempts. Verify whether the difference is *real*.

### AP-22: Retrospective skip
- **Symptom**: Retrospective is replaced by a *brief note*. No carryover generated for the next cycle.
- **What broke**: [`R-KP01`](./06-rules.md), [`SD-07`](./situational-rules/self-discipline.md#sd-07-cycle-end-is-explicit) violated. Learnings are trapped in *tacit knowledge*.
- **Alarm**: Retrospective output < 1 page.
- **Response**: Invoke `think:retrospective` skill + enforce [`templates/retro.md`](./templates/retro.md) format.

## 11.7 Anti-patterns in the Operational / Post-launch Phase

### AP-23: Endless polish (post-launch)
- **Symptom**: *Polishing the same product for 6 months* after launch.
- **What broke**: [`10 §10.8`](./10-post-launch.md#108-post-launch-anti-patterns) — no new hypothesis validation.
- **Alarm**: *0 new Macro loops* after launch.
- **Response**: Quarterly meta-retrospective → force identification of next Macro loop candidates ([`10 §10.4`](./10-post-launch.md#104-triggers-for-a-new-macro-loop)).

### AP-24: Feature creep without hypothesis
- **Symptom**: 1 user's request → *implemented immediately* without a hypothesis.
- **What broke**: 1 person's statement generalized as *universal demand*.
- **Alarm**: New feature has no pre-registered hypothesis.
- **Response**: New features also require [`08 §8.4`](./08-pass-criteria.md#84-hypothesis-pre-registration) pre-registration.

### AP-25: Sunset avoidance
- **Symptom**: Claiming *"it can be saved"* for a product that is clearly dying.
- **What broke**: [`C-06 Sunk cost`](./situational-rules/cognitive.md#c-06-sunk-cost--past-investment-does-not-affect-the-decision). Sunset triggers ignored.
- **Alarm**: *Re-evaluation avoided* after sunset trigger fires.
- **Response**: *Recalculate* sunset triggers in the quarterly retrospective. Force automatic re-evaluation when triggered.

## 11.8 Self-audit — Quarterly Anti-pattern Retrospective

Read this document *each quarter* and check the following.

- [ ] Identify anti-patterns *violated* in the last 3 cycles
- [ ] For the 1–2 most frequently violated — *why* were they violated? (unrealistic rule vs. personal lapse)
- [ ] Add avoidance tools (time-box / alarm / external call, etc.)
- [ ] If a new anti-pattern is discovered, add it to this document

→ This document must stay *alive*. Newly discovered traps should be *registered immediately*.

## 11.9 Anti-pattern × Rule Cross-reference

| Anti-pattern | Core rule violated |
|---|---|
| AP-01 Validation theater | C-01, SD-06 |
| AP-02 Persona drift | R-PG01, 08 §8.2 |
| AP-03 Hypothesis polyamory | SD-02 |
| AP-04 Negative-evidence amnesia | C-01, C-03 |
| AP-05 Harness ceremony | R-PG02 |
| AP-06 Gate fudging | 08 §8.4, 08 §8.8 |
| AP-07 Document inflation | templates/README |
| AP-08 Stale ADR | ADR rules |
| AP-09 Cycle chaining | SD-07, R-KP01 |
| AP-10 Sunk-cost rescue | C-06, 07 §7.5 |
| AP-11 Pivot avoidance | 07 §7.2, 07 §7.3 |
| AP-12 WIP explosion | SD-03 |
| AP-13 Hill chart stagnation | 07 §7.7 |
| AP-14 Premature scaling | C-08 |
| AP-15 Solution-shopping | 09 §9.5 |
| AP-16 NFR omission | O-02, 08 §8.6 |
| AP-17 Observability afterthought | O-01 |
| AP-18 Test theater | R-TST02 |
| AP-19 Discovery escape | SD-06 |
| AP-20 Ship paralysis | SD-04, SD-08 |
| AP-21 Rule exemptionism | SD-11, C-11 |
| AP-22 Retrospective skip | R-KP01, SD-07 |
| AP-23 Endless polish | 10 §10.8 |
| AP-24 Feature creep | 08 §8.4 |
| AP-25 Sunset avoidance | C-06, 10 §10.6 |

## Related Skills
- `cognition:bias-auditor` — quarterly anti-pattern retrospective
- `cognition:assumption-extractor` — surface avoided assumptions
- `think:devils-advocate` — counter-pressure for self-diagnosis
- `think:retrospective` — pattern-analysis of anti-patterns
- `self:examined-life` — thinking through *why the same patterns repeat*
