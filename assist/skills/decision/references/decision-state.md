# Decision State Contract

Use this state as working memory shared across routed skills. It is not a mandatory user-facing
template. Keep only fields that help the current decision, but do not discard provenance,
conflicts, uncertainty, or authorization boundaries to make the state look complete.

```yaml
contract:
  decision: ""
  owner: ""
  deadline: null
  success: []
  constraints: []
  stakes: low | medium | high
  reversibility: reversible | costly-to-reverse | one-way-door
  domain: technical | product | work | career | leadership | personal | mixed

mode: quick | deliberate | review
stage: intake | grounded | framed | options-ready | challenged | decided | handed-off

criteria:
  - id: ""
    description: ""
    kind: hard-constraint | preference | risk-tolerance | success-measure
    importance: high | medium | low
    source: user | evidence | inference

options:
  - id: ""
    description: ""
    status: viable | infeasible | dominated | needs-evidence
    benefits: []
    costs: []
    risks: []
    evidence_refs: []
    assumption_refs: []

evidence:
  - id: "E1"
    claim: ""
    direction: supports | contradicts | contextual
    option_refs: []
    source_ref: "stable path, record id, or URL"
    source_kind: user-provided | repository | knowledge-corpus | external | general-knowledge
    observed_at: null
    confidence: high | moderate | low
    limitation: ""

assumptions:
  - id: "A1"
    claim: ""
    load: load-bearing | significant | peripheral
    status: untested | supported | contradicted
    evidence_refs: []

conflicts:
  - id: "C1"
    kind: fact | constraint | value | forecast
    positions: []
    resolution: unresolved | evidence-preferred | owner-choice
    recommendation_impact: none | could-change | blocks

tradeoffs:
  - criterion_ref: ""
    option_impacts: {}
    distribution: "who receives the benefit or bears the cost"

challenge:
  strongest_objection: ""
  affected_option: ""
  status: unresolved | mitigated | accepted
  disconfirming_evidence_refs: []

recommendation:
  disposition: choose | experiment | defer | reject | null
  option_ref: null
  rationale: []
  confidence: high | moderate | low | null
  what_would_change_it: []

unresolved_questions: []
next_step: null

routing:
  - skill: "plugin:skill"
    reason: "missing state or risk signal that justified the call"
    inputs: []
    outputs: []

authorization:
  requested_scope: advice | review | documentation | planning | implementation
  external_action_authorized: false
```

## State Rules

1. Treat the decision contract and hard constraints as owner-controlled. A routed skill may
   identify contradictions or missing detail, but it may not silently rewrite them.
2. Add evidence as addressable items. Never replace contradictory evidence with a blended
   summary; record the conflict and whether resolving it can change the recommendation.
3. Label model-derived statements as inference or general knowledge. Stable source references
   are required for repository, knowledge-corpus, and external evidence.
4. A routed skill updates only the fields it can support. Its prose is not automatically a
   verdict, and its confidence does not become recommendation confidence without comparison.
5. Record each routed call and the gap it was meant to close. Do not repeat a call unless new
   evidence or an unresolved finding materially changes its inputs.
6. Preserve `authorization`. Advice, review, documentation, and planning do not authorize
   implementation, purchase, publication, contact, or mutation of an external system.

## Transition Gate

| Transition | Minimum observable state |
|---|---|
| `intake → grounded` | decision, owner, success, constraints, stakes, reversibility, and material evidence gaps are explicit |
| `grounded → framed` | the decision question is usable; false binaries or proxy goals are resolved or recorded |
| `framed → options-ready` | at least two viable paths exist, or the state explains why only one/status quo remains |
| `options-ready → challenged` | load-bearing assumptions and a meaningful disconfirmation attempt are recorded when stakes require them |
| `challenged → decided` | disposition, rationale, costs, confidence, strongest objection, and change conditions are explicit |
| `decided → handed-off` | the next artifact/action was requested and stays within `authorization.requested_scope` |

Stages may be compressed or skipped when their minimum state already exists. A blocked fact
becomes an unresolved question; it blocks a recommendation only when the state marks its
recommendation impact as `blocks`. For a cheap reversible test, prefer `experiment` with a
named success threshold over manufacturing confidence.
