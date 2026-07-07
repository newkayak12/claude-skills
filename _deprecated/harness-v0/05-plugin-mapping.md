# 05. Plugin / Skill Mapping

This document maps the plugins/skills in this repo to each harness phase. **Application is selective** — you do not need to call every skill at every phase. Calling just one skill targeting *the weakest area right now* yields the greatest effect.

## 5.1 Invocation Principles

1. **One primary skill per phase** + supporting skills as needed.
2. **Workflow skills are entry points** — call once at the start of a cycle; they branch into sub-skills internally.
3. **Use `think`-family skills immediately before a decision** — `decision-maker`, `devils-advocate`, `problem-reframer`.
4. **Use `verification` immediately before completion** — `verification-before-completion`.

## 5.2 Product Track Mapping

| Phase | Primary skill | Supporting skill |
|---|---|---|
| Cycle start (full cycle guide) | `pm:pm-strategy-workflow` | — |
| Persona / JTBD | `pm:customer-research-synthesis` | `pm:user-story` |
| Service Concept | `pm:hypothesis-driven-dev` | `pm:contagious` (virality check) |
| Requirements gathering | `pm:customer-research-synthesis` | `pm:product-discovery`, `pm:inspired-pm` |
| SRS / RFP writing | `write:doc-coauthoring` | `pm:prd-development` |
| User Journey Map | `pm:user-story-mapping` | `pm:user-story-mapping-workshop` (interactive) |
| MVP Scope definition | `pm:feature-prioritization` | `pm:shape-up`, `pm:user-story-splitting` |
| Validation gate 1 (Loop 1) | `pm:hypothesis-driven-dev` | `pm:metrics-interpretation` (result interpretation) |

### Supporting — Non-functional / Strategic areas

| Need | Skill |
|---|---|
| Competitive analysis | `pm:competitive-analysis` |
| Pricing strategy | `pm:pricing-monetization-strategy` |
| Launch planning | `pm:go-to-market-planning` |
| Post-launch retrospective | `pm:post-launch-retrospective` |
| Technical feasibility pre-check | `pm:technical-feasibility-assessment` |
| Story splitting | `pm:user-story-splitting` |

## 5.3 Tech Track Mapping

| Phase | Primary skill | Supporting skill |
|---|---|---|
| Cycle start (full dev cycle) | `develop:dev-quality-workflow` | — |
| Architecture design | `develop:architecture-designer` | `develop:architecture-workflow`, `develop:clean-architecture` |
| Domain modeling | `develop:domain-driven-design` | `develop:event-storming` |
| Service boundary finalization | `develop:service-boundary-validator` | — |
| Tech stack decision | `develop:architecture-designer` | `pm:technical-feasibility-assessment` |
| Design Doc writing | `technique-write:design-review-writer` | `write:doc-coauthoring` |
| ADR writing | `technique-write:adr-writer` | — |
| DB design | `develop:database-workflow` | `develop:sql-pro`, `develop:database-optimizer` |
| Transaction boundary review | `develop:transaction-boundary-reviewer` | — |
| Validation gate 2 (Loop 2) | `develop:test-driven-development` | `develop:chaos-engineer`, `develop:performance-profiling-optimization` |

### Supporting — Operations / Quality areas

| Need | Skill |
|---|---|
| Operations readiness | `develop:operations-workflow` |
| Microservices architecture | `develop:microservices-architect` |
| MSA circuit-breaker tuning | `develop:circuit-breaker-tuner` |
| DB connection pool tuning | `develop:connection-pool-tuner` |
| Docker optimization | `develop:dockerfile-optimizer` |
| Test strategy | `develop:testing-workflow`, `develop:test-master` |
| Flaky test analysis | `develop:flaky-test-analyzer` |
| Incident response | `develop:incident-response-playbook` |
| Code documentation | `develop:code-documenter`, `develop:documentation-strategy` |

## 5.4 Thinking / Decision skills (Cross-cutting)

Callable at any time. Deliberately insert them *immediately before a decision*.

| Situation | Skill |
|---|---|
| Unsure what to build — diverge | `think:brainstorming` |
| Questioning the problem definition itself | `think:problem-reframer` |
| Choosing between options | `think:decision-maker` |
| Strong pull toward one option — find weaknesses | `think:devils-advocate` |
| Cycle retrospective | `think:retrospective` |
| Clearing mental clutter | `think:thought-organizer` |
| Rethinking from scratch | `think:first-principles` |
| Deep thinking workflow | `think:deep-thinking-workflow` |
| UX micro-interaction design | `think:microinteractions` |
| Critical thinking cycle | `cognition:critical-thinking-workflow` |
| Bias check | `cognition:bias-auditor` |
| Assumption extraction | `cognition:assumption-extractor` |
| Trade-off clarification | `cognition:tradeoff-articulator` |
| Second-order thinking | `cognition:second-order-thinker` |
| Mental model application | `cognition:mental-model-toolkit` |
| Epistemic check | `cognition:epistemic-reasoner` |
| Logical fallacy check | `cognition:fallacy-detector` |
| Improving the question itself | `cognition:question-upgrader` |
| Thought clarity | `cognition:clarity-toolkit` |

## 5.5 Documentation / Writing support

| Situation | Skill |
|---|---|
| Document review / proofreading | `write:writer-verification` |
| Writing a new skill | `write:writing-skills` |
| Technical blog post | `write:technical-blog-writer` |
| Peer feedback writing (SBI) | `write:sbi-writer` |
| Plan document writing | `write:writing-plans` |
| Plan execution | `planning:executing-plans` |

## 5.6 Recommended invocation order at cycle start

When starting a new product/feature cycle:

```
1. think:brainstorming                       # diverge on what to build
2. pm:pm-strategy-workflow                   # enter full PM cycle
   ├─ pm:customer-research-synthesis         # Persona phase
   ├─ pm:hypothesis-driven-dev               # hypothesis writing
   ├─ pm:user-story-mapping                  # UJM
   └─ pm:feature-prioritization              # MVP scope
3. think:devils-advocate                     # pre-validation decision check
4. (Validation gate 1 passed)
5. develop:dev-quality-workflow              # enter Dev cycle
   ├─ develop:architecture-designer          # architecture
   ├─ technique-write:design-review-writer   # Design Doc
   ├─ technique-write:adr-writer             # ADR (iterative)
   ├─ develop:database-workflow              # DB
   └─ develop:test-driven-development        # validation gate 2
6. think:retrospective                       # after cycle ends
```

## 5.7 Top 5 most-forgotten skill calls

Empirically, these skill invocations are *most commonly missed* during a cycle:

1. **`cognition:bias-auditor`** — when one option looks overwhelmingly attractive
2. **`pm:user-story-splitting`** — when a story won't fit in a single sprint
3. **`develop:transaction-boundary-reviewer`** — when distributed transaction traces appear
4. **`develop:incident-response-playbook`** — one check *before* launch
5. **`think:retrospective`** — after cycle ends (most frequently skipped)

## 5.8 When NOT to invoke a skill

- Calling a divergence skill on a phase where decisions are *already finalized* → analysis paralysis
- Calling brainstorming *while writing code* → signal to return to the design phase
- Calling a workflow skill for *trivial work* → overkill, wasted time
- Calling 5+ skills in a single cycle → too many, signals lack of prioritization
