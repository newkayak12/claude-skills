# planning

**English** · [한국어](KOR.md)

Two skills for the moment a plan exists but nothing has been executed yet — at two very different
altitudes. `executing-plans` is the pre-flight gate on an implementation plan: review it as an
adversary, stamp an observable pass bar on every step, then route it to an executor without
running a single step itself. `roadmap-planning` works a quarter or two above that, turning
competing initiatives into a sequenced, stakeholder-ready roadmap. Both refuse to move forward on
an unexamined assumption — one about a plan's preconditions, the other about capacity and
dependencies.

## Install & Uninstall

```bash
/plugin install planning@newkayak12-claude-skills
/plugin uninstall planning@newkayak12-claude-skills
```

## Which skill do I want?

| I want to… | Skill |
|---|---|
| Check a written implementation plan is sound and hand it to the right executor | `executing-plans` |
| Turn goals and competing initiatives into a sequenced quarterly roadmap | `roadmap-planning` |

## Skills

### `executing-plans`

The gate between a plan and its execution. It reads the plan in full, reviews it adversarially,
attaches a pass bar to each step, and routes the work — it never edits code itself. Reach for it
whenever a plan is about to be run, especially one written earlier or by someone else. Its iron
law: **no hand-off without a clean plan and a stated pass bar per step**.

```
docs/plans/billing-retry.md was written last week. Check it still holds against the
current code, set a pass bar per step, and hand it to whichever executor fits.
```

The gate is `0. LOAD → 1. REVIEW → 2. GATE → 3. HAND-OFF`. Three review defects block hand-off:

| Defect | Symptom | Action |
|---|---|---|
| Gap | Step N needs something no earlier step produces | STOP — the plan is incomplete |
| Ambiguity | You couldn't dispatch the step to a stranger without guessing | STOP — pin the intent first |
| Drift | The plan assumes a file, API, or schema that changed | STOP — the plan is stale |

Routing at hand-off: independent steps → `agents:dispatching-parallel-agents`; sequential or
dependent steps → `agents:subagent-driven-development`. Default when unsure is sequential — a
wrong parallel call costs more than running in order. Each step's done-verdict is settled against
its step-2 bar by `completion:verification-before-completion`, not the executor's word.

**Harness-aware dual mode.** This skill is written to run two ways: standalone as above, and as an
executor the harness's SetGoal stage can optionally map onto a subgoal (`harness:harness` →
"Optional skill integrations"). It describes itself as the harness *SetGoal + QualityGate* brought
down to a single session — where the six-stage engine derives acceptance criteria and gates on
them automatically, here you do it by hand before dispatch. Nothing is pre-wired; each side runs
without the other.

### `roadmap-planning`

A five-phase workflow, roughly 1–2 weeks of elapsed time with 45–90 minutes of active facilitation
a day, that turns business goals, customer problems, technical constraints, and stakeholder
requests into a sequenced roadmap and the deck that explains it. Use it for annual or quarterly
planning, after a strategy session, or to reframe a feature list as outcomes. Not for sprint
planning, not when the strategy itself is still unclear, and not when stakeholders are expecting
date commitments — address that expectation first.

```
15개 initiatives competing for Q2 across three teams. Build the roadmap: epic
hypotheses, RICE scoring, dependency-ordered quarters, and the exec deck.
```

| Phase | Days | Output |
|---|---|---|
| 1. Gather inputs | 1–2 | 3–5 business outcomes, 3–5 validated problems, tech investments, stakeholder requests |
| 2. Define initiatives | 3–4 | 10–15 epics with hypothesis, success metric, T-shirt effort |
| 3. Prioritize | 5 | Ranked backlog, top 10 epics |
| 4. Sequence | 6–7 | Now/Next/Later or quarterly roadmap, dependency map, capacity check |
| 5. Communicate | Week 2 | 30–45 min deck, stakeholder alignment, published roadmap v1.0 |

Standing mandates: always map dependencies between epics before sequencing; always separate
committed from aspirational; never build a roadmap without the team's real capacity constraints;
never sequence without stakeholder alignment on top-level outcomes. Supporting files:
`template.md` (fill-in structure), `examples/sample.md`, `references/roadmap-types.md`,
`references/anti-patterns.md`, and `agents/roadmap-coordinator.md` for guided facilitation.

## Related plugins

- `write:writing-plans` — produces the plan `executing-plans` gates.
- `agents:*` — the executors `executing-plans` routes to.
- `completion:verification-before-completion` — closes out each step against its bar.

---
