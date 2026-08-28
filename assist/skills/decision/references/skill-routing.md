# Skill Routing Contract

Read this reference after mode and domain are known. Select the smallest route that changes a
material state field. The tables are a capability map, not a required procession.

## Route by Missing State

| Missing state or signal | Route | Expected state contribution | Do not route when |
|---|---|---|---|
| Relevant facts may already exist in a local knowledge corpus | `knowledge:knowledge-query` | evidence with provenance and limitations | no relevant corpus exists or the decision only needs the user's stated preferences |
| Problem may be a symptom or the choice solves the wrong problem | `think:problem-reframer` | repaired decision, success, constraints | the frame is already explicit and uncontested |
| False binary, proxy metric, or underspecified question | `cognition:question-upgrader` | decision, criteria, unresolved questions | only factual retrieval is missing |
| Inherited assumptions are treated as laws | `think:first-principles` | assumptions, alternative constraints | domain rules are verified hard constraints |
| Fewer than two viable paths or alternatives share one premise | `think:brainstorming` | viable options | options are already sufficient for the requested review |
| Hidden premises carry the recommendation | `cognition:assumption-extractor` | ranked assumptions | premises are already explicit and tested |
| Confidence or forecast strength exceeds the evidence | `cognition:epistemic-reasoner` | calibrated evidence and confidence | the uncertainty is a value choice rather than a factual claim |
| A consequential option needs its strongest opposition | `think:devils-advocate` | challenge and strongest objection | the choice is trivial, cheap, and reversible with no meaningful downside |
| Context suggests motivated reasoning or judgment distortion | `cognition:bias-auditor` | bias finding and remedy | the request merely asks for ordinary comparison |
| An explicit argument may be invalid | `cognition:fallacy-detector` | reasoning defect and affected claim | no argument chain was presented |
| Effects propagate across people, incentives, systems, or time | `cognition:second-order-thinker` | downstream risks and tradeoffs | consequences are local and immediate |
| Costs are described vaguely or borne by different parties | `cognition:tradeoff-articulator` | comparable costs, opportunity costs, distribution | a hard constraint already eliminates the option |
| Broad high-stakes reasoning has several unresolved evaluation gaps | `cognition:critical-thinking-workflow` | integrated assumptions, evidence, logic, and confidence | component routes already cover the gaps; never duplicate them by default |

## Mode Defaults

### Quick

Use the existing contract and evidence, repair the frame only if needed, compare viable
options, and recommend. Add a challenge route only when a preference became a conclusion
without testing or a hidden consequence makes the decision less reversible than it appeared.

### Deliberate

Ground material claims, repair the frame, ensure real alternatives, challenge load-bearing
assumptions, inspect downstream consequences, articulate tradeoffs, and calibrate the verdict.
This describes required coverage, not required skill count. One umbrella workflow may replace
overlapping component routes.

### Review

Reconstruct the proposal's intended outcome and evidence before attacking it. Seek
disconfirmation, expose unmet constraints, then return `approve`, `approve with conditions`,
`revise`, or `reject`. The proposal author and the decision owner may be different people.

## Domain Routes

Route a domain skill only when its specialist constraints could change feasibility, risk, or
the recommendation. Ask it for a bounded contribution; do not ask it to decide on the user's
behalf.

| Domain signal | Candidate routes | Contribution |
|---|---|---|
| Architecture or production design | `develop:architecture-workflow`, `develop:architecture-designer`, or the narrow relevant `develop` specialist | feasibility, boundaries, operability, failure modes |
| Product direction or prioritization | `pm:product-discovery`, `pm:feature-prioritization`, `pm:competitive-analysis` | user problem, strategic fit, option value |
| Pricing or go-to-market | `pm:pricing-monetization-strategy`, `pm:go-to-market-planning` | market constraints, packaging, adoption and revenue risks |
| Stakeholder or organizational decision | `pm:stakeholder-management`, `leadership:leadership-workflow` | incentives, alignment, people impact |
| Career application or interview decision | `portfolio:job-application-workflow`, `portfolio:interview-prep` | role fit, evidence, opportunity cost |
| Personal values or motivation conflict | `self:values-explorer`, `self:motivation-explorer`, `self:fear-inventory` | owner preferences, values, internal constraints |

Do not turn a practical choice into therapy. Personal skills clarify the user's values and
patterns; they do not diagnose mental health conditions or override professional advice.

## Handoff Routes

| User asks for | Route after the recommendation |
|---|---|
| Durable technical decision record | `technique-write:adr-writer` |
| Proposal still needing review | `technique-write:design-review-writer` |
| Concrete implementation plan | `write:writing-plans` |
| Sequenced strategic roadmap | `planning:roadmap-planning` |
| Execution of an existing plan | `planning:executing-plans` in a separate authorized task |

Handoffs are conditional. A decision request does not itself authorize file edits,
execution, publication, purchases, messages, or changes to external systems.

## Anti-Routes

- Do not call both an umbrella workflow and every component it already contains.
- Do not use `devils-advocate` merely to decorate a trivial reversible choice.
- Do not use knowledge retrieval when the corpus is unrelated to the decision.
- Do not use a domain persona to confirm a preferred answer; ask it to test feasibility or expose constraints.
- Do not route to planning before a recommendation or bounded experiment has been selected.
