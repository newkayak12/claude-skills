# 10. Post-launch — The *Permanent* Post-launch Loop

The Macro/Meso/Micro loops do not end at *launch*. The fourth loop defined in [`07 §7.1`](./07-looping-mechanics.md#71-the-four-loops) — the **Post-launch loop** — runs *permanently as long as the product is alive*. This document covers post-launch operations, discovery, and sunset.

## 10.1 Four Burdens of the Post-launch Loop

Launch is not an *end* — it is the *beginning of new burdens*.

1. **Operational burden** — incident response, user support, infrastructure cost
2. **Discovery burden** — Continuous Discovery, finding candidates for the next cycle
3. **Improvement burden** — paying down debt, incremental quality improvement
4. **Sunset burden** — deciding *when to stop* (the sunset point)

→ If you do not secure *capacity for these four burdens* before launch, the Post-launch loop will *cannibalize every subsequent cycle*.

## 10.2 Cadence — Rhythm and Deliverables

### Daily (handled via automation)
- Core metrics dashboard check ([`O-04`](./situational-rules/operations.md#o-04-alarms-with-thresholds--metrics-without-alarms-are-useless))
- Alarm handling (only when triggered)
- Cost tracking ([`O-11`](./situational-rules/operations.md#o-11-cost-monitoring--cost-is-a-metric))

### Weekly
- Continuous Discovery interviews — *at least 1* (Teresa Torres)
- User feedback triage (which signals matter)
- Metrics trend review (vs. previous week)

### Monthly
- Operational incident retrospective (blameless, when applicable — [`O-07`](./situational-rules/operations.md#o-07-blameless-postmortem--the-system-not-the-person))
- Debt register review ([`R-TD01`](./06-rules.md))
- Feature flag cleanup ([`O-06`](./situational-rules/operations.md#o-06-feature-flag-for-risky-changes))

### Quarterly
- **Meta-retrospective** — *condensing the learnings* of the past quarter
- Re-prioritize the next-cycle candidate queue
- Re-evaluate sunset conditions (§10.6)
- Rule self-audit — patterns of *violated rules* ([`SD-10`](./situational-rules/self-discipline.md#sd-10-quarterly-self-retrospective--rules-i-break))

## 10.3 Continuous Discovery — Interviews Continue After Launch

> *Launching does not mean interviews are over.* — Teresa Torres

### Principles
- **Weekly cadence** — frequency matters. Interviewing 5 people in one month is weaker for signal accumulation than *1 person per week for 8 weeks*.
- **Current users + churned users + non-users** — all three segments.
- **Update the Opportunity Solution Tree** — when a new opportunity is discovered, add it to the tree. Not every opportunity becomes a cycle.

### Outputs
- Raw interview notes (a *living resource* for the next cycle)
- Updated Opportunity tree
- Identification of *recurring signals* → candidates to trigger the next Macro loop

## 10.4 Triggers for a New Macro Loop

The Post-launch loop must *itself* generate the next Macro loop.

### Quantitative triggers
- Core metric drops by X% (e.g., WAU down 20%)
- Cost metric exceeds threshold (e.g., infrastructure cost per user > $Y)
- SLO error budget *repeatedly* exhausted

### Qualitative triggers
- *Recurring signal* in Continuous Discovery (same opportunity surfaced by 3+ different interviews)
- Operational incident reveals a *structural flaw*
- Competitive or market shift — external signal

### Self-triggered (danger)
- "I'm bored and want to build a new feature" — requires self-audit ([`SD-06`](./situational-rules/self-discipline.md#sd-06-writing-code-instead-of-validating--self-check), [`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit))
- "A better technology came out" — Solution-shopping anti-pattern ([`09 §9.5`](./09-pre-cycle.md#95-pre-cycle-anti-patterns))

→ When a trigger fires → pass through [`09-pre-cycle.md`](./09-pre-cycle.md) gate → enter new Macro loop.

## 10.5 Debt vs. New Features — Pay-down Ratio

The post-launch period is a tug-of-war between *debt repayment* and *new features*.

### Recommended Ratios (solo developer baseline)
- **New cycle**: new features 70% / debt 30%
- **Mature cycle**: new features 50% / debt 50%
- **First 1–3 cycles after launch**: new features 50% / debt + observation 50% (stabilization focus)
- **After an operational incident**: new features 30% / debt 70% (resolve structural causes)

### Debt Register
- [`R-TD01`](./06-rules.md) — maintain a *conscious* list
- Per item: date incurred / cause / impact / repayment cost / repayment trigger
- *Re-evaluate quarterly* — some debt does not need to be repaid (if product direction changes)

## 10.6 Sunset — Deciding *When to Stop*

Stopping is not *failure*. Delaying the stop is *failure*.

### Sunset Triggers
- **Users**: WAU/MAU below threshold for N consecutive months
- **Business**: operating cost > revenue (or revenue potential)
- **Strategy**: transferring *capacity* to another cycle yields more value
- **Maintenance cost**: each cycle consumed only by debt repayment

### Sunset Decision Matrix
- Shutdown cost (migration / user notification / data retention) < maintenance cost → proceed with shutdown
- Are there N core users and *somewhere to migrate them to*? → migration plan
- *No destination for migration*? → sufficient advance notice + data export

### Sunset Deliverables
- Shutdown timeline (T-90d notice → T-30d new signups closed → T-0 service shutdown → T+30d data retention ends)
- Migration guide (if applicable)
- Data export / deletion procedure
- *Sunset retrospective* — what was learned, what to carry over to the next cycle

→ The sunset retrospective is *the product's final learning resource*. It is the starting point of the next Macro loop.

## 10.7 Post-launch Metrics Baseline

Metrics to define *before* launch. Defining them after launch causes *interpretation contamination* ([`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit)).

### Product Metrics
- DAU / WAU / MAU
- Retention curve (D1 / D7 / D30)
- Activation rate (percentage achieving the defined core event)
- Core task completion rate
- NPS or equivalent satisfaction indicator

### Operational Metrics (RED + USE — [`O-01`](./situational-rules/operations.md#o-01-three-pillars--required-before-release))
- P95/P99 latency
- Error rate
- Throughput
- Utilization / Saturation

### Business Metrics
- Revenue / cost per user
- CAC / LTV (where applicable)
- Churn rate

### Sunset Trigger Metrics (must be pre-defined)
- WAU < ___ for N consecutive months
- Cost per user > $___
- N cycles consumed by debt repayment alone

## 10.8 Post-launch Anti-patterns

### Endless polish
- Symptom: *polishing the same product for 6 months* after launch
- Risk: learning stops — no new hypothesis validation
- Response: apply [`SD-04 80% ship rule`](./situational-rules/self-discipline.md#sd-04-80-ship-rule) *post-launch too*

### Feature creep without hypothesis
- Symptom: "a user asked for X" → implemented immediately without a hypothesis
- Risk: mistaking one person's request for *universal demand*
- Response: new features also require *pre-registration of a hypothesis* ([`08 §8.4`](./08-pass-criteria.md#84-hypothesis-pre-registration))

### Sunset avoidance
- Symptom: claiming *"it can be saved"* for a product that is clearly dying
- Risk: sunk cost ([`C-06`](./situational-rules/cognitive.md#c-06-sunk-cost--past-investment-does-not-affect-the-decision))
- Response: pre-defined sunset trigger fires → automatic re-evaluation

### Discovery skip
- Symptom: making new feature decisions with *0 interviews* after launch
- Risk: not knowing the *real patterns* of current users
- Response: lock a weekly interview cadence *in the calendar*

### Operational drowning
- Symptom: can't start the *next cycle* because of incident response and support load
- Risk: permanent operations mode — no discovery, no improvement
- Response: separate the operations automation cycle as an explicit Macro loop

## 10.9 Sunset → Next Macro Loop Carryover

Apply the keep / suspect / discard framework from [`07 §7.4`](./07-looping-mechanics.md#74-inter-loop-carryover--what-survives-and-what-gets-discarded) to sunset as well.

### Keep (carry to the next product)
- Accumulated raw interview notes
- User segment learning — *who* found value
- Operational learning — *which decisions* created which costs
- Technical learning — which dependencies revealed which constraints

### Suspect (needs reinterpretation)
- *Why* did this product die — no quick answer; look at the data again
- Vague learnings like "we'll do better next time"

### Discard
- *Code* from the dead product
- Unvalidated speculative interpretations
- Inside-view narratives like "our case was special" ([`C-11`](./situational-rules/cognitive.md#c-11-outside-view--base-rate-of-similar-attempts))

## 10.10 Post-launch Checklist

### Immediately *before* launch
- [ ] Pre-define post-launch metrics baseline (§10.7)
- [ ] Schedule Continuous Discovery cadence (§10.3)
- [ ] Pre-define sunset triggers (§10.6)
- [ ] Initialize debt register (§10.5)
- [ ] Pass operational baseline ([`operations.md`](./situational-rules/operations.md))

### *Every quarter* after launch
- [ ] Synthesize metrics trends (§10.7)
- [ ] Discovery signal retrospective (§10.3)
- [ ] Re-evaluate sunset conditions (§10.6)
- [ ] Debt ratio check (§10.5)
- [ ] Next Macro loop trigger check (§10.4)

## Related Rules
- [`R-TD01`](./06-rules.md) — debt register
- [`SD-04`](./situational-rules/self-discipline.md#sd-04-80-ship-rule), [`SD-10`](./situational-rules/self-discipline.md#sd-10-quarterly-self-retrospective--rules-i-break) — launch / self-retrospective
- [`C-06`, `C-11`](./situational-rules/cognitive.md) — Sunk cost / Outside view
- [`O-01~11`](./situational-rules/operations.md) — full operational baseline

## Related Skills
- `pm:hypothesis-driven-dev` — register hypotheses post-launch too
- `develop:operations-workflow` — operations cadence
- `develop:sre-engineer` — SLO / error budget operations
- `think:retrospective` — quarterly meta-retrospective
- `cognition:second-order-thinker` — second-order effects of sunset
- `pm:shape-up` — appetite for the next cycle
