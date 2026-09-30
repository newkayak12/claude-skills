# harness-beta

Side-by-side beta channel for the harness. The stable `harness` plugin remains unchanged.

Claude first asks a small read-only selector agent whether the request is better served by a
role-isolated Agent Team or Dynamic Workflow, announces the decision, and then runs exactly one
path. Mixed or weak evidence defaults to Agent Team. Explicit user choices and runtime
availability always override the classifier.

## Install

```text
/plugin install harness-beta@newkayak12-claude-skills
```

Invoke `harness-beta:harness`. It can be installed alongside `harness`; this beta contains no
install/remove hooks and does not modify stable project governance.

## Selection policy

| Prefer | Signals |
|---|---|
| Agent Team | independent work units, isolated roles, adaptive repository/tool exploration |
| Dynamic Workflow | strict ordering, repeatable/auditable flow, bounded retries, bespoke control flow |

Only disjoint dependency-ready Agent Team subgoals may run concurrently. Dynamic Workflow uses
the copied stable `pipeline.js`; the beta changes routing policy, not the six-stage quality bar.

## Status

- **0.1.0-beta.1** — initial side-by-side beta. Claude selects Agent Team or Dynamic Workflow;
  ambiguity defaults to Agent Team. Stable `harness` remains at its existing release and policy.
