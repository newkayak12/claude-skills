# 07. Looping Mechanics

Previous documents only established the *existence* of loops. This document defines the four loop types, their entry/exit/re-entry rules, kill criteria, and pivot trigger mappings.

## 7.1 The four loops

The same word ("loop") refers to four distinct activities. Mixing them without explicit distinction blurs *cost and decision units*.

| Loop | Cadence | Cost unit | Key output |
|---|---|---|---|
| **Macro** | One cycle (weeks to months) | Entire cycle | Shipped product + retrospective |
| **Meso** | One phase re-run (days to weeks) | Phase + gate time | Revised phase deliverable |
| **Micro** | TDD red-green-refactor (minutes to hours) | One function/feature | Passing tests + code |
| **Post-launch** | Continuous after launch (permanent) | Operational cost | Metrics + next cycle candidates |

### Macro
- **Start**: Pre-cycle gate passed ([09-pre-cycle.md](./09-pre-cycle.md))
- **End**: Launch or kill decision
- **Retrospective**: Call `think:retrospective` at cycle end ([R-KP01](./06-rules.md))

### Meso
- **Start**: Gate failure or obvious defect in a phase deliverable
- **End**: Updated deliverable can pass the next gate
- **Retrospective**: Short retro at phase end — "what did we miss?"

### Micro
- **Start**: Begin a small unit of work (1-3h)
- **End**: red → green → refactor + DoD met
- **Retrospective**: None (the code itself is the deliverable)

### Post-launch
- **Start**: Immediately after launch
- **End**: Permanent until product sunset ([10-post-launch.md](./10-post-launch.md))
- **Retrospective**: Quarterly meta-retro + new Macro loop triggered on specific events

## 7.2 Loop entry / exit / re-entry rules

### Macro
- **No re-entry**. A cycle lives once and dies once. The next is a new cycle.

### Meso — most important
Four-way decision on gate failure:

```
Gate failure
  │
  ├─ Hypothesis *disproved* (negative evidence)
  │    └─ Pivot (§7.6) — re-enter within the same cycle
  │
  ├─ Hypothesis *unconfirmed* (insufficient evidence)
  │    └─ Re-run current phase (gather more data)
  │
  ├─ *Premise* of the deliverable is wrong
  │    └─ Return to previous phase
  │
  └─ Cumulative re-entries exceed N → Kill (§7.5)
```

### Micro
- **Re-entry**: *Automatic* with the next work unit. No conscious decision needed.

### Post-launch
- **No end**. Permanent while the product is live.
- *New Macro loop trigger conditions*:
  - Core metric drops by X%
  - Repeating new signal from interviews
  - Structural defect exposed by an operational incident
  - Opportunity identified in quarterly meta-retrospective

## 7.3 Loop re-entry decision table

| Signal | Decision | Added cost |
|---|---|---|
| Hypothesis disproved (Loop 1) | Pivot, re-enter within same cycle | +30-50% of cycle |
| Hypothesis unconfirmed (insufficient data) | Re-run current phase (supplement interviews/experiments) | Phase time × 1.5 |
| Deliverable premise error | Return to previous phase | Previous phase time × 1.2 |
| *Formal* defect in deliverable | Partial fix in same phase (not a re-entry) | Phase time × 0.3 |
| 3 cumulative re-entries | Kill | Cycle ends |

## 7.4 Inter-loop carryover — what survives and what gets discarded

Re-entry does not mean discarding everything. **Preserve learning, question conclusions, discard code.**

### Preserve
- Interview raw notes (can be reinterpreted)
- Rejected hypotheses + reasons for rejection (starting point for the next cycle)
- Measurement metrics and threshold rationale
- Technical learnings (benchmark numbers, dependency limits)

### Question
- Hypothesis *conclusions* — can change with data reinterpretation
- Persona priorities — reorder as interviews accumulate
- MVP scope — redesign wholesale on a pivot

### Discard
- *Prototype code* that was never shipped (preserve learning, discard code)
- Deliverables based on unvalidated assumptions (e.g., a UJM built on an unverified persona)

→ At retrospective, *explicitly classify* items as preserve / question / discard and record them in [`templates/retro.md`](./templates/retro.md).

## 7.5 Loop kill criteria — when to *kill* a cycle

Codifies [`C-06 Sunk cost`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다). Set kill criteria *in advance*.

### Hard kill (automatic termination)
- **3 cumulative re-entries**: Same phase re-run 3 times without passing the gate
- **Time exceeds 200%**: More than double the cycle budget
- **Budget exceeds 100%**: Defined cost limit exceeded

### Soft kill (re-evaluation trigger)
- Cycle time reaches 150% → conscious decision: *continue vs end vs pivot*
- All core hypotheses unconfirmed + cost of re-experimentation > cost of a new hypothesis

### Kill outputs
- One-page *kill reason* (using [`templates/retro.md`](./templates/retro.md) format)
- Preserved learnings stored separately
- *Avoidance patterns* registered as candidates for the next cycle

## 7.6 Pivot trigger → Pivot type mapping

Attaches *trigger signals* to the 10 pivot types from [`03-validation-loops.md`](./03-validation-loops.md).

| Trigger signal | Pivot type | Note |
|---|---|---|
| Persona is right but *proposed solution* is ignored | Zoom-in / Zoom-out | Keep one feature only / expand to a larger problem |
| *Different* Persona shows strong interest in the same feature | Customer Segment | Replace the target segment |
| Customer is right but *problem* is weak | Customer Need | Switch to a different problem for the same customer |
| Value is recognized but *willingness to pay* is weak | Business Architecture / Value Capture | B2C↔B2B or monetization model change |
| Technical *implementation cost* >> value | Technology / Channel | Different implementation or different channel |
| Growth *loop* isn't working | Engine of Growth | Switch between viral/paid/sticky |
| Everything works but *too small* | Platform | Single product → platform |

→ A pivot is *not the end of the Macro loop*. It is a re-entry within the same cycle.

## 7.7 Loop visualization — Hill Chart

Shape Up's Hill Chart shows a task's *current position* in two stages.

```
                    ⛰
       Uphill              Downhill
   (explore/diverge)   (execute/converge)
   unknown ↑            remaining work ↓
```

- **Uphill**: Exploring problems, hypotheses, and options. High *unknowns*.
- **Downhill**: Executing the chosen direction. *Remaining work* is clear.

### Usage
- Plot current-phase work as *points* on the hill
- Update point positions weekly
- A point *stalled on uphill* is a signal → re-entry or kill candidate
- Even for solo developers, *3+ points simultaneously on uphill* means WIP is over limit ([`SD-03`](./situational-rules/self-discipline.md#sd-03-wip--1-work-in-progress-한도))

## 7.8 Alternate loop patterns — when to use them

| Pattern | Best fit | Role in the harness |
|---|---|---|
| **Build-Measure-Learn** (Ries) | Hypothesis-centric validation | Default for Loop 1 and Loop 2 |
| **PDCA** (Deming) | Incremental quality improvement | Post-launch loop |
| **OODA** (Boyd) | High-speed, high-uncertainty response | Operational incidents / pivot decisions |
| **DMAIC** (Six Sigma) | Quantitative quality management | When performance budget is missed |
| **Continuous Discovery** (Torres) | Sustained interview cadence | Post-launch + next cycle candidate discovery |

→ BML is the default. Other patterns are adopted *explicitly*.

## 7.9 Loop setup checklist at cycle start

Fix the operating parameters for each loop when entering a cycle.

- [ ] Macro loop time budget ___ weeks
- [ ] Meso loop re-entry limit ___ times
- [ ] Micro loop DoD ([R-DoD01~04](./06-rules.md))
- [ ] Post-launch loop metric ___ + trigger threshold ___
- [ ] Kill criteria defined (Hard + Soft, §7.5)
- [ ] Pivot trigger signals *pre-defined* (§7.6)

## Related rules
- [`R-PG01~05`](./06-rules.md) — Process Gates
- [`R-SC01~04`](./06-rules.md) — Scope management
- [`SD-01`](./situational-rules/self-discipline.md#sd-01-time-box-validation-loops--7-14일) — Time-box
- [`C-06`](./situational-rules/cognitive.md#c-06-sunk-cost--과거-투입은-결정에-영향-주지-않는다) — Sunk cost
- [`C-09`](./situational-rules/cognitive.md#c-09-decision의-reversibility-등급) — Reversibility

## Related skills
- `think:retrospective` — cycle/loop retrospective
- `think:decision-maker` — pivot / kill decision
- `pm:hypothesis-driven-dev` — hypothesis redesign
- `pm:shape-up` — appetite + hill chart
- `cognition:second-order-thinker` — second-order consequences of a pivot
