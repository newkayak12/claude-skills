# 08. Pass Criteria — Gate numeric thresholds

Where [`07-looping-mechanics.md`](./07-looping-mechanics.md) defined *when to stop looping and advance*, this document sets *the numeric thresholds for pass and fail*. A gate that passes on gut feel is not a gate.

## 8.1 Principles

1. **Numbers are decided *before* the cycle starts** — setting thresholds after seeing results is self-confirmation.
2. **Number + rationale** — don't just write "P95 < 300ms"; add *why* 300ms (competitor benchmark / user patience limit / comparison with existing system) in one line.
3. **Adjustable if needed, but *explicitly*** — mid-cycle changes must be recorded in an ADR.

## 8.2 Gate 1 — Product hypothesis validation criteria

Quantifies the pass conditions for Loop 1 from [`03-validation-loops.md`](./03-validation-loops.md).

### Quantitative criteria (solo developer baseline)

| Item | Threshold | Note |
|---|---|---|
| Target Persona interviews | ≥ 5 people | Minimum for pattern recognition (3 is coincidence, 5 is signal) |
| Hypothesis-matching responses per core hypothesis | ≥ 60% | Proportion responding "I have this problem" |
| Explicit willingness to pay / switch / spend time | ≥ 3 explicit yes | Not mere interest — *behavioral commitment* |
| Responses from outside target Persona | < 30% | Over 30% suggests the Persona segment needs revision |
| Interview raw note preservation | 100% | Learning carryover ([§7.4](./07-looping-mechanics.md#74-inter-loop-carryover--무엇이-살고-무엇이-버려지나)) |

### Qualitative criteria
- No "Mom Test" violations — *past behavior* questions outnumber *future intent* questions (Rob Fitzpatrick)
- Interviews are in *falsifiable* form — "what answer would reject the hypothesis?" is pre-defined
- *Rejection line* pre-specified per hypothesis (e.g., "reject if ≤ 2 of 5 answer yes")

### Pass signal classification
- **Strong pass**: All quantitative + qualitative criteria met
- **Conditional pass**: One quantitative item missed — proceed to next phase with *additional validation items*
- **Soft fail**: One qualitative violation — re-run interviews ([§7.2 Meso re-entry](./07-looping-mechanics.md#meso--가장-중요))
- **Hard fail**: Two or more quantitative items missed — Pivot or Kill ([§7.5](./07-looping-mechanics.md#75-loop-종료-kill-criteria--사이클을-죽이는-기준))

## 8.3 Gate 2 — Technical hypothesis validation criteria

Technical feasibility gate for Loop 2.

### Quantitative criteria

| Item | Threshold | Note |
|---|---|---|
| Core path P95 latency | < pre-defined budget | [See §8.6](#86-performance-budget-defaults) |
| Core path error rate | < 1% (under load test) | RED model |
| DB query N+1 / full-scan | 0 occurrences (core path) | Verified by EXPLAIN |
| Load test throughput | ≥ expected traffic × 3 | Headroom reserve |
| External dependency SLA aggregate | ≥ own SLO + buffer | Dependency math |
| Unit test coverage (core modules) | ≥ 70% | Not the overall average |

### Qualitative criteria
- At least 3 *failure modes* identified for the core path, each with a defined response
- ADR written for all *Reversibility*-high decisions ([`C-09`](./situational-rules/cognitive.md#c-09-decision의-reversibility-등급))
- Solo-operable — alert response + first-recovery procedure defined ([`O-04`, `O-05`](./situational-rules/operations.md))

### Pass signal classification
- **Strong pass**: Load test results show ≥ 30% headroom above baseline
- **Conditional pass**: One item missed — additional optimization cycle + launch possible
- **Hard fail**: Core path SLO missed — architecture review required ([§7.2 Meso re-entry](./07-looping-mechanics.md#meso--가장-중요))

## 8.4 Hypothesis pre-registration

Borrowed from academic research pre-registration to *prevent interpretation contamination*.

### Written at cycle start (ADR required for changes)

```
[Hypothesis ID]
Hypothesis: [specific, falsifiable statement]
Metric: [metric to measure — definition + measurement method]
Rejection line: [what number/response constitutes rejection]
Pass line: [what number/response constitutes passing]
Side metrics: [additional observations — must NOT be used for decisions]
```

### Why separate lines are needed
- Adjusting thresholds *after* seeing results means every hypothesis "passes"
- Pre-registered lines resist *confirmation bias* ([`C-01`](./situational-rules/cognitive.md#c-01-bias-check-before-strong-commit))

## 8.5 Risk Scoring Matrix

Systematically evaluates risk for each decision and deliverable.

### Axes
- **Impact**: Effect if wrong (Low / Medium / High / Critical)
- **Reversibility**: Cost to undo (Easy / Moderate / Hard / Irreversible)
- **Confidence**: Current confidence level (Low / Medium / High)

### Matrix (simplified)

| Impact × Reversibility | Low conf | Medium conf | High conf |
|---|---|---|---|
| Low × Easy | Just do | Just do | Just do |
| Medium × Moderate | Spike 1d | Just do | Just do |
| High × Hard | ADR + DA + PM | ADR + DA | ADR |
| Critical × Irreversible | **STOP** + spike | ADR + DA + PM | ADR + DA |

- **Spike**: Time-boxed exploration (1-3 days)
- **ADR**: Architecture Decision Record
- **DA**: Devil's Advocate ([`C-04`](./situational-rules/cognitive.md#c-04-devils-advocate-on-irreversible-decisions))
- **PM**: Pre-mortem ([`C-02`](./situational-rules/cognitive.md#c-02-pre-mortem-before-big-bet))
- **STOP**: Do not proceed; route around the decision until confidence is established

## 8.6 Performance Budget Defaults

Use this baseline when you can't define numbers from scratch. Adjust per cycle.

### Response time (Web Vitals — user-facing)
- **FCP** (First Contentful Paint) < 1.5s
- **LCP** (Largest Contentful Paint) < 2.5s
- **INP** (Interaction to Next Paint) < 200ms
- **CLS** (Cumulative Layout Shift) < 0.1
- **TTFB** (Time to First Byte) < 500ms

### Backend (RED — service-facing)
- **P50 latency** < 100ms (core path)
- **P95 latency** < 500ms
- **P99 latency** < 1s
- **Error rate** < 1% (5-minute window)
- **RPS capacity** ≥ expected traffic × 3

### Resources (USE — infrastructure-facing)
- **CPU utilization** < 70% (steady state), < 85% (peak)
- **Memory utilization** < 75%
- **Disk I/O saturation** < 60%
- **DB connection pool** < 80%

### Cost (solo developer addition)
- **Monthly cloud cost** < pre-defined budget
- **Cost per request** < $X (depends on monetization model)

## 8.7 DoD numbers — Definition of Done

Quantifies the DoD from [`06-rules.md`](./06-rules.md).

### Per-feature DoD
- [ ] Core path unit test pass rate 100%
- [ ] Integration test (golden path + 1 edge case) passes
- [ ] Core metrics (latency, error rate) within baseline
- [ ] Observability 3-pillars applied ([`O-01`](./situational-rules/operations.md#o-01-three-pillars--출시-전-필수))
- [ ] Feature flag applied where applicable ([`O-06`](./situational-rules/operations.md#o-06-feature-flag-for-risky-changes))

### Per-cycle DoD
- [ ] Gate 1 passed (§8.2)
- [ ] Gate 2 passed (§8.3)
- [ ] Performance budget met (§8.6)
- [ ] Operations baseline met ([`operations.md`](./situational-rules/operations.md))
- [ ] Retrospective output preserved ([`templates/retro.md`](./templates/retro.md))

## 8.8 Threshold adjustment rules

Thresholds are not *fixed*. However, *adjustment must follow a process* to remain meaningful.

### When adjustment is allowed
- *Before* the cycle starts — freely (state the rationale)
- *During* the cycle — ADR + stated reason required
- *After* the cycle ends — recorded in retrospective, reflected in next cycle baseline

### When adjustment is prohibited
- Relaxing numbers *immediately before a gate pass/fail judgment* — *self-deception* pattern
- Redefining thresholds *after* seeing results — invalidates pre-registration

## 8.9 Checklist at cycle start

- [ ] Gate 1 quantitative and qualitative criteria *recorded* (§8.2)
- [ ] Gate 2 quantitative and qualitative criteria *recorded* (§8.3)
- [ ] *Rejection/pass lines* pre-registered for all core hypotheses (§8.4)
- [ ] Risk Scoring applied to core decisions (§8.5)
- [ ] Performance budget numbers *fixed* (§8.6)
- [ ] DoD numbers confirmed (§8.7)

## Related rules
- [`R-PG01~05`](./06-rules.md) — Process Gates
- [`R-DoD01~04`](./06-rules.md) — Definition of Done
- [`R-NFR01~03`](./06-rules.md) — NFR quantification
- [`C-01`, `C-05`](./situational-rules/cognitive.md) — Bias / Assumption
- [`O-02`, `O-03`](./situational-rules/operations.md) — Performance budget / SLO

## Related skills
- `pm:hypothesis-driven-dev` — hypothesis pre-registration
- `develop:performance-profiling-optimization` — performance budget validation
- `cognition:assumption-extractor` — making qualitative criteria explicit
- `think:decision-maker` — applying the risk matrix
- `develop:sre-engineer` — SLO / Error budget
